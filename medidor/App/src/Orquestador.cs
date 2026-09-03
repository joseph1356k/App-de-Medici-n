using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>
/// EL LATIDO del medidor: una vez por segundo junta lo que vieron la sonda de primer plano, los
/// ganchos y el hilo SAP, lo normaliza (aduana de privacidad), lo atribuye al encounter vigente y
/// lo deja caer en la cubeta correcta. También abre y cierra visitas SAP y vigila la salud de los
/// ganchos.
///
/// SIN COMPUERTA: ningún tick se descarta. Bloqueado se graba como «bloqueado» (activo 0, sin
/// paciente ni usuario SAP), sin ventana delante como «otro» (ver Continuidad). Lo único que el
/// bloqueo apaga es la consulta a SAP y a la sonda: en la pantalla de bloqueo no hay nada que
/// preguntar. La compuerta de antes (pausado, sin turno, bloqueado ⇒ no grabar) era la causa de
/// las horas en blanco de la línea de tiempo.
///
/// Corre en el hilo de la ventana oculta; aquí solo está la lógica de un tick, para poder
/// razonarla sin la app. Todo el conteo de duración pasa por el Reloj: el orquestador nunca resta
/// DateTime.Now a mano.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class Orquestador
{
    private const int TicksEntreChequeosDeGanchos = 10;
    private const long ReintentoDeGanchosDegradadosMs = 10 * 60_000;
    private const long SapSinMotorAvisoMs = 60_000;
    private const long SapSinMotorLogMs = 60 * 60_000;

    private readonly SondaPrimerPlano _sonda;
    private readonly Ganchos _ganchos;
    private readonly HiloSap _sap;
    private readonly Cubetas _cubetas;
    private readonly Func<Calidad> _calidad;
    private readonly Viaje _viaje;
    private readonly Reloj _reloj;
    private readonly SaludDeGanchos _salud = new();
    private readonly Func<ConfigDeMedicion> _config;
    private readonly Func<DateTimeOffset, byte[]?> _claveDelDia;
    private readonly Action<string, DateTimeOffset, string?, IReadOnlyDictionary<string, object?>?> _emitirEvento;
    private readonly Action<Visita, string?, string?> _emitirVisita;

    private long _ticks;
    private bool _bloqueado;
    private string? _encounterVigente;
    private string? _encounterUnknownEmitidoEn;
    private long? _inicioDeRoundtrip;
    private string? _claveContextoAnterior;
    private string? _ultimaSurfaceSap;
    private bool? _sapEnganchadoAntes;
    private string? _sapUserVisto;
    private long _proximoReintentoDeGanchosMono;
    private long? _sapDelanteSinMotorDesdeMono;
    private bool _sinScriptingAvisadoEnJornada;
    private long _proximoLogSinScriptingMono;

    public Orquestador(
        SondaPrimerPlano sonda, Ganchos ganchos, HiloSap sap,
        Cubetas cubetas, Func<Calidad> calidad, Viaje viaje,
        Func<ConfigDeMedicion> config, Func<DateTimeOffset, byte[]?> claveDelDia,
        Action<string, DateTimeOffset, string?, IReadOnlyDictionary<string, object?>?> emitirEvento,
        Action<Visita, string?, string?> emitirVisita)
    {
        _sonda = sonda; _ganchos = ganchos; _sap = sap;
        _cubetas = cubetas; _calidad = calidad; _viaje = viaje;
        _config = config; _claveDelDia = claveDelDia;
        _emitirEvento = emitirEvento; _emitirVisita = emitirVisita;
        _reloj = new Reloj(Environment.TickCount64, DateTimeOffset.UtcNow);
        _proximoReintentoDeGanchosMono = Environment.TickCount64 + ReintentoDeGanchosDegradadosMs;
    }

    public bool EstaBloqueado => _bloqueado;
    public string? EncounterVigente => _encounterVigente;

    /// <summary>Hace cuánto hubo input según el último tick: el MENOR entre lo que vieron los
    /// ganchos y lo que dice el sistema (GetLastInputInfo), para que active_ms sobreviva a unos
    /// ganchos muertos.</summary>
    public long UltimoInputHaceMs { get; private set; } = long.MaxValue;

    /// <summary>El último usuario SAP visto (session.Info.User). Es el login del médico, no del
    /// paciente. Pegajoso mientras el motor está enganchado; se suelta con él. Viaja por cubeta.</summary>
    public string? SapUserVisto => _sapUserVisto;

    /// <summary>Al bloquear/desbloquear la sesión. No cosecha nada (contrato 6): las cubetas siguen
    /// llenándose como «bloqueado» hasta que se completen solas.</summary>
    public void Bloqueado(bool bloqueado)
    {
        _bloqueado = bloqueado;
        if (bloqueado) _claveContextoAnterior = null; // al desbloquear, el primer cambio no cuenta como «cambio de contexto»
    }

    /// <summary>Al cambiar el día operativo: los avisos «una vez por jornada» se rearman.</summary>
    public void NuevaJornada() => _sinScriptingAvisadoEnJornada = false;

    /// <summary>Un tick. <paramref name="pared"/> es la hora LOCAL del hospital: ancla la cubeta y el
    /// día operativo (la clave de la huella se deriva de ella en cada tick, promesa 30).</summary>
    public void Tick(DateTimeOffset pared)
    {
        // Reloj monotónico COMPARTIDO con el hilo SAP (Environment.TickCount64): los StartRequest/
        // EndRequest llegan con ese mismo reloj, y restar instantes de relojes distintos no significa nada.
        var ahoraMono = Environment.TickCount64;
        var tic = _reloj.Avanzar(ahoraMono, DateTimeOffset.UtcNow);
        var calidad = _calidad();
        _ticks++;
        if (tic.HuecoMs > 0) calidad.Hueco(tic.HuecoMs);
        if (tic.DesfaseRelojMs != 0)
        {
            calidad.SaltoDeReloj();
            _emitirEvento("clock_jump", pared, null, new Dictionary<string, object?> { ["ms"] = tic.DesfaseRelojMs });
        }

        // ¿SAP se enganchó o se soltó desde el tick anterior? La calidad recuerda si alguna vez entró.
        var enganchado = _sap.Enganchado;
        if (enganchado) calidad.SapEnganchado();
        if (_sap.EventosEnganchados) calidad.SapEventosEnganchados();
        if (_sapEnganchadoAntes != enganchado)
        {
            if (_sapEnganchadoAntes != null)
                _emitirEvento(enganchado ? "sap_attach" : "sap_detach", pared, null, null);
            if (!enganchado) _sapUserVisto = null;
            _sapEnganchadoAntes = enganchado;
        }

        // Input: los ganchos cuentan; GetLastInputInfo es el testigo independiente.
        var input = _ganchos.Cosechar();
        UltimoInputHaceMs = Math.Min(input.UltimoInputHaceMs, input.UltimoInputSistemaHaceMs);
        if (_ganchos.Degradado && !calidad.Degradados)
        {
            calidad.GanchosDegradados();
            _emitirEvento("hooks_degradados", pared, null, null);
        }
        if (_ticks % TicksEntreChequeosDeGanchos == 0) VigilarGanchos(input, ahoraMono, pared, calidad);

        Superficie? delante = null;
        int roundtripsTick = 0; long esperaTick = 0;
        if (_bloqueado)
        {
            // En la pantalla de bloqueo no se pregunta nada: ni COM a SAP ni ventana de primer plano.
            _sap.Drenar();
            _ultimaSurfaceSap = null;
            _encounterUnknownEmitidoEn = null;
            _sapDelanteSinMotorDesdeMono = null;
        }
        else
        {
            var cfg = _config();
            var vistaSap = _sap.Ultima;

            // Los round-trips de SAP que llegaron desde el tick anterior: al Viaje (espera y time-to-ready
            // de la visita en curso) y a la cubeta (espera y round-trips de este tick).
            foreach (var e in _sap.Drenar())
            {
                if (e.EsInicio)
                {
                    _viaje.AlStartRequest(e.MonoMs);
                    _inicioDeRoundtrip = e.MonoMs;
                }
                else
                {
                    _viaje.AlEndRequest(e.MonoMs, e.BusyDespues);
                    if (_inicioDeRoundtrip is long inicio && e.MonoMs >= inicio)
                    {
                        esperaTick += e.MonoMs - inicio;
                        roundtripsTick++;
                        _inicioDeRoundtrip = null;
                    }
                }
            }

            if (!string.IsNullOrWhiteSpace(vistaSap.SapUser) && vistaSap.SapUser != _sapUserVisto)
            {
                _sapUserVisto = vistaSap.SapUser;
                _emitirEvento("sap_user_seen", pared, null, new Dictionary<string, object?> { ["user"] = _sapUserVisto });
            }

            // ¿Dónde está el médico? SAP manda; si no hay SAP delante, la sonda de primer plano.
            string? surfaceSap = vistaSap.Surface;
            if (vistaSap.EstabaOcupado)
            {
                // Ocupado = a mitad de un round-trip. No se pregunta nada (colgaría) y se sostiene la
                // última pantalla conocida: entre dos pantallas no hay una tercera.
                calidad.TickSapSaltado();
                surfaceSap = _ultimaSurfaceSap;
            }

            if (surfaceSap != null)
            {
                _ultimaSurfaceSap = surfaceSap;
                _sapDelanteSinMotorDesdeMono = null;
                delante = new Superficie(Normalizador.AppSap, Normalizador.SinVista(surfaceSap));
                if (!vistaSap.EstabaOcupado) ActualizarEncounter(surfaceSap, vistaSap.TituloSap, cfg, pared);
                if (!cfg.SoloForeground)
                {
                    var visitaCerrada = _viaje.AlCambiarSuperficie(ahoraMono, pared, surfaceSap);
                    if (visitaCerrada != null) _emitirVisita(visitaCerrada, _encounterVigente, _sapUserVisto);
                }
            }
            else
            {
                _ultimaSurfaceSap = null;
                _encounterUnknownEmitidoEn = null;
                var vp = _sonda.Mirar(); // null (sin ventana delante) ya no corta el tick: es «otro»
                bool sapSinMotor = false;
                if (vp != null)
                {
                    delante = Normalizador.Normalizar(new EntradaDeSuperficie(vp.Proceso, null, vp.UrlNavegador, null), cfg.ParaNormalizar());
                    sapSinMotor = !enganchado && cfg.EsProcesoSap(vp.Proceso);
                }
                VigilarSapSinMotor(sapSinMotor, ahoraMono, pared, calidad);
                // Salió de SAP: cerrar la visita en curso, si la había.
                var visitaCerrada = _viaje.AlCambiarSuperficie(ahoraMono, pared, null);
                if (visitaCerrada != null) _emitirVisita(visitaCerrada, _encounterVigente, _sapUserVisto);
            }
        }

        // La atribución del tick es pura (Continuidad): bloqueado ⇒ «bloqueado» sin nada; si no, lo
        // que hay delante con el paciente y el usuario SAP vigentes. La actividad se decide con el
        // «hace cuánto» relativo, comparable en cualquier reloj.
        bool inputReciente = UltimoInputHaceMs <= Actividad.UmbralInactividadMs;
        var atribucion = Continuidad.Atribuir(_bloqueado, delante, _encounterVigente, _sapUserVisto, inputReciente);

        // ¿Cambió el contexto respecto al tick anterior?
        var claveContexto = atribucion.Superficie.App + "|" + (atribucion.Superficie.Surface ?? "") + "|" + (atribucion.EncounterKey ?? "");
        int cambios = _claveContextoAnterior != null && _claveContextoAnterior != claveContexto ? 1 : 0;
        _claveContextoAnterior = _bloqueado ? null : claveContexto;

        if (_bloqueado)
        {
            // Contrato 5: foreground_ms = transcurrido, active_ms = 0, y nada más (en la pantalla de
            // bloqueo los ganchos no ven el tecleo de la contraseña, y aunque vieran algo no es trabajo).
            _cubetas.Registrar(pared, atribucion.Superficie, null, new Aportes(tic.AporteMs, 0, 0, 0, 0, 0, 0, 0, 0), null);
            return;
        }

        int typingMs = (int)Math.Min(tic.AporteMs, Escritura.MsDeRafagas(input.InstantesDeTecla));
        _cubetas.Registrar(pared, atribucion.Superficie, atribucion.EncounterKey, new Aportes(
            ForegroundMs: tic.AporteMs,
            ActiveMs: atribucion.Activo ? tic.AporteMs : 0,
            TypingMs: typingMs,
            Teclas: input.InstantesDeTecla.Count,
            Clics: input.Clics,
            Scroll: input.Scroll,
            CambiosDeContexto: cambios,
            SapRoundtrips: roundtripsTick,
            SapEsperaMs: (int)Math.Min(esperaTick, int.MaxValue),
            Tabs: input.Tabs, Enters: input.Enters, Correcciones: input.Correcciones,
            Copias: input.Copias, Pegados: input.Pegados, Guardados: input.Guardados),
            atribucion.SapUser);
    }

    /// <summary>Cada 10 ticks. Ganchos que nunca entraron: reintento cada 10 min. Ganchos que
    /// entraron y se quedaron ciegos mientras el sistema ve input: SaludDeGanchos decide (3 chequeos).</summary>
    private void VigilarGanchos(ContadoresDeInput input, long ahoraMono, DateTimeOffset pared, Calidad calidad)
    {
        if (_ganchos.Degradado)
        {
            if (ahoraMono < _proximoReintentoDeGanchosMono) return;
            _proximoReintentoDeGanchosMono = ahoraMono + ReintentoDeGanchosDegradadosMs;
            Rearmar(pared, calidad);
            return;
        }
        if (_salud.Evaluar(input.UltimoInputSistemaHaceMs, input.UltimoInputHaceMs, _bloqueado)) Rearmar(pared, calidad);
    }

    private void Rearmar(DateTimeOffset pared, Calidad calidad)
    {
        var ok = _ganchos.Rearmar();
        calidad.GanchoRearmado();
        Registro.Anota("ganchos", $"rearmados ({_ganchos.Rearmados}) ok={ok}");
        _emitirEvento("hooks_rearmados", pared, null, new Dictionary<string, object?> { ["count"] = _ganchos.Rearmados });
    }

    /// <summary>SAP delante más de 60 s sin motor de scripting: se mide como app «sap» sin pantallas
    /// ni paciente, y hay que decirlo — un evento por jornada, un log por hora, y la calidad lo lleva.</summary>
    private void VigilarSapSinMotor(bool sapDelanteSinMotor, long ahoraMono, DateTimeOffset pared, Calidad calidad)
    {
        if (!sapDelanteSinMotor) { _sapDelanteSinMotorDesdeMono = null; return; }
        _sapDelanteSinMotorDesdeMono ??= ahoraMono;
        if (ahoraMono - _sapDelanteSinMotorDesdeMono.Value < SapSinMotorAvisoMs) return;

        calidad.SapSinScripting();
        if (!_sinScriptingAvisadoEnJornada)
        {
            _sinScriptingAvisadoEnJornada = true;
            _emitirEvento("sap_scripting_no_disponible", pared, null, null);
        }
        if (ahoraMono >= _proximoLogSinScriptingMono)
        {
            _proximoLogSinScriptingMono = ahoraMono + SapSinMotorLogMs;
            Registro.Anota("sap", "SAP delante más de 60 s sin motor de scripting: se mide como app, sin pantallas ni paciente (¿sapgui/user_scripting?)");
        }
    }

    private void ActualizarEncounter(string surface, string? tituloSap, ConfigDeMedicion cfg, DateTimeOffset pared)
    {
        var limpia = Normalizador.SinVista(surface);
        var partes = Normalizador.PartesSap(limpia);
        if (partes == null) return;

        var clave = _claveDelDia(pared);
        if (clave == null) { EncounterDesconocido(limpia, "sin_clave", null, pared); return; } // sin secreto no hay huella; el tiempo SAP igual se mide

        var reglas = cfg.Reglas();
        var aplicables = reglas.Where(r => r.Tcode == "*" || string.Equals(r.Tcode, partes.Value.Tcode, StringComparison.OrdinalIgnoreCase)).ToList();
        if (aplicables.Count == 0) { EncounterDesconocido(limpia, "sin_regla", null, pared); return; }

        // La extracción es por regla remota: título SAP con regex, o UN campo por selector. El
        // crudo entra a la regla, sale un grupo, se hashea y se suelta. No se guarda en ningún sitio.
        var extraido = ReglasDeIdentidad.Extraer(aplicables, partes.Value.Tcode, _sap.LeerCampo, tituloSap);
        if (extraido == null) { EncounterDesconocido(limpia, "sin_match", aplicables[0].Id, pared); return; } // sin paciente en esta pantalla: se conserva el encounter vigente

        var nuevo = Huella.DeIdentificador(clave, extraido.Value.IdNormalizado);
        if (nuevo == _encounterVigente) return;

        if (_encounterVigente != null)
            _emitirEvento("encounter_exit", pared, _encounterVigente, null);
        _encounterVigente = nuevo;
        _emitirEvento("encounter_enter", pared, nuevo,
            new Dictionary<string, object?> { ["rule"] = extraido.Value.ReglaId });
    }

    /// <summary>`encounter_unknown`: UNA vez por entrada a una pantalla SAP cuando no hay encounter
    /// vigente y la extracción falla. Dice por qué (sin_clave · sin_regla · sin_match) y con qué
    /// regla: es lo que permite afinar las reglas desde el panel sin ver ninguna pantalla.</summary>
    private void EncounterDesconocido(string surface, string reason, string? rule, DateTimeOffset pared)
    {
        if (_encounterVigente != null) return;
        if (_encounterUnknownEmitidoEn == surface) return;
        _encounterUnknownEmitidoEn = surface;
        _emitirEvento("encounter_unknown", pared, null, new Dictionary<string, object?> { ["reason"] = reason, ["rule"] = rule });
    }

    /// <summary>Se olvida el encounter (emite `encounter_exit` con el motivo): al cambiar de día la
    /// clave de la huella rota y la misma persona daría otra huella; al apagar, para cerrar limpio.</summary>
    public void OlvidarEncounter(DateTimeOffset pared, string reason)
    {
        if (_encounterVigente != null)
            _emitirEvento("encounter_exit", pared, _encounterVigente, new Dictionary<string, object?> { ["reason"] = reason });
        _encounterVigente = null;
        _encounterUnknownEmitidoEn = null;
        _claveContextoAnterior = null;
    }

    /// <summary>Cierra la visita SAP en curso, si la hay (apagado, volcado de un colapso).</summary>
    public void CerrarVisitaPendiente(DateTimeOffset pared)
    {
        var visita = _viaje.CerrarPendiente(Environment.TickCount64, pared);
        if (visita != null) _emitirVisita(visita, _encounterVigente, _sapUserVisto);
        _ultimaSurfaceSap = null;
    }
}
