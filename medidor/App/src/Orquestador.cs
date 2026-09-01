using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>
/// EL LATIDO del medidor: una vez por segundo junta lo que vieron la sonda de primer plano, los
/// ganchos y el hilo SAP, lo normaliza (aduana de privacidad), lo atribuye al encounter vigente y
/// lo deja caer en la cubeta correcta. También abre y cierra visitas SAP y cierra el turno por
/// inactividad o bloqueo prolongado.
///
/// Corre en el hilo de la ventana oculta; aquí solo está la lógica de un tick, para poder
/// razonarla sin la app. Todo el conteo de duración pasa por el Reloj: el orquestador nunca resta
/// DateTime.Now a mano.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class Orquestador
{
    private readonly SondaPrimerPlano _sonda;
    private readonly Ganchos _ganchos;
    private readonly HiloSap _sap;
    private readonly Sesionizador _sesion;
    private readonly Cubetas _cubetas;
    private readonly Func<Calidad> _calidad;
    private readonly Viaje _viaje;
    private readonly Reloj _reloj;
    private readonly Func<ConfigDeMedicion> _config;
    private readonly Func<byte[]?> _claveDelDia;
    private readonly Action<string, DateTimeOffset, Guid?, string?, IReadOnlyDictionary<string, object?>?> _emitirEvento;
    private readonly Action<Guid, Visita, string?> _emitirVisita;

    private string? _encounterVigente;
    private long? _inicioDeRoundtrip;
    private string? _claveContextoAnterior;
    private string? _ultimaSurfaceSap;
    private bool _pausado;
    private bool? _sapEnganchadoAntes;
    private string? _sapUserVisto;
    private long? _bloqueadoDesdeMono;

    public Orquestador(
        SondaPrimerPlano sonda, Ganchos ganchos, HiloSap sap, Sesionizador sesion,
        Cubetas cubetas, Func<Calidad> calidad, Viaje viaje,
        Func<ConfigDeMedicion> config, Func<byte[]?> claveDelDia,
        Action<string, DateTimeOffset, Guid?, string?, IReadOnlyDictionary<string, object?>?> emitirEvento,
        Action<Guid, Visita, string?> emitirVisita)
    {
        _sonda = sonda; _ganchos = ganchos; _sap = sap; _sesion = sesion;
        _cubetas = cubetas; _calidad = calidad; _viaje = viaje;
        _config = config; _claveDelDia = claveDelDia;
        _emitirEvento = emitirEvento; _emitirVisita = emitirVisita;
        _reloj = new Reloj(Environment.TickCount64, DateTimeOffset.UtcNow);
    }

    public bool Pausado => _pausado;
    public string? EncounterVigente => _encounterVigente;

    /// <summary>Hace cuánto hubo input, según el último tick. Programa lo usa para reabrir un turno
    /// solo cuando alguien vuelve a usar el PC.</summary>
    public long UltimoInputHaceMs { get; private set; } = long.MaxValue;

    /// <summary>El último usuario SAP visto (session.Info.User). Es el login del médico, no del
    /// paciente: sirve para asignar el turno solo y para validar el selector.</summary>
    public string? SapUserVisto => _sapUserVisto;

    /// <summary>Se dispara cuando el usuario SAP cambia (o aparece por primera vez).</summary>
    public event Action<string>? SapUserCambio;

    public void Pausar()
    {
        if (_pausado) return;
        _pausado = true;
        _emitirEvento("pausa_usuario", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null, null);
    }

    public void Reanudar()
    {
        if (!_pausado) return;
        _pausado = false;
        _emitirEvento("reanudar_usuario", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null, null);
    }

    /// <summary>Al bloquear/desbloquear la sesión: el sesionizador cuenta cuánto lleva bloqueado.</summary>
    public void Bloqueado(bool bloqueado)
    {
        if (!bloqueado) _bloqueadoDesdeMono = null;
        else _bloqueadoDesdeMono ??= Environment.TickCount64;
    }

    /// <summary>Un tick. Devuelve el cierre de turno si lo hubo (el que llama emite el turno cerrado).</summary>
    public CierreDeTurno? Tick()
    {
        // Reloj monotónico COMPARTIDO con el hilo SAP (Environment.TickCount64): los StartRequest/
        // EndRequest llegan con ese mismo reloj, y restar instantes de relojes distintos no significa nada.
        var ahoraMono = Environment.TickCount64;
        var pared = DateTimeOffset.Now; // LOCAL: el día operativo y las cubetas se anclan a la hora del hospital
        var tic = _reloj.Avanzar(ahoraMono, DateTimeOffset.UtcNow);
        var calidad = _calidad();
        if (tic.HuecoMs > 0) calidad.Hueco(tic.HuecoMs);
        if (tic.DesfaseRelojMs != 0)
        {
            calidad.SaltoDeReloj();
            _emitirEvento("clock_jump", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null,
                new Dictionary<string, object?> { ["ms"] = tic.DesfaseRelojMs });
        }

        // ¿SAP se enganchó o se soltó desde el tick anterior?
        var enganchado = _sap.Enganchado;
        if (_sapEnganchadoAntes != enganchado)
        {
            if (_sapEnganchadoAntes != null)
                _emitirEvento(enganchado ? "sap_attach" : "sap_detach", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null, null);
            _sapEnganchadoAntes = enganchado;
        }

        // El sesionizador puede cerrar el turno por inactividad o bloqueo prolongado.
        var input = _ganchos.Cosechar();
        UltimoInputHaceMs = input.UltimoInputHaceMs;
        var estadoPc = new EstadoDelPc(
            UltimoInputHaceMs: input.UltimoInputHaceMs,
            BloqueadoHaceMs: _bloqueadoDesdeMono is long desde ? ahoraMono - desde : null);
        var cierre = _sesion.Avanzar(pared, estadoPc);
        if (cierre != null) { _encounterVigente = null; _ultimaSurfaceSap = null; }

        if (_pausado || _sesion.Abierto == null || _bloqueadoDesdeMono != null)
        {
            _claveContextoAnterior = null; // al reanudar, el primer cambio no cuenta como «cambio de contexto»
            return cierre;
        }

        if (_ganchos.Degradado && !calidad.Degradados)
        {
            calidad.GanchosDegradados();
            _emitirEvento("hooks_degradados", DateTimeOffset.UtcNow, _sesion.Abierto.ShiftId, null, null);
        }

        var cfg = _config();
        var vistaSap = _sap.Ultima;

        // Los round-trips de SAP que llegaron desde el tick anterior: al Viaje (espera y time-to-ready
        // de la visita en curso) y a la cubeta (espera y round-trips de este tick).
        int roundtripsTick = 0; long esperaTick = 0;
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
            _emitirEvento("sap_user_seen", DateTimeOffset.UtcNow, _sesion.Abierto.ShiftId, null,
                new Dictionary<string, object?> { ["user"] = _sapUserVisto });
            SapUserCambio?.Invoke(_sapUserVisto!);
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

        Superficie superficie;
        if (surfaceSap != null)
        {
            _ultimaSurfaceSap = surfaceSap;
            superficie = new Superficie(Normalizador.AppSap, Normalizador.SinVista(surfaceSap));
            if (!vistaSap.EstabaOcupado) ActualizarEncounter(surfaceSap, vistaSap.TituloSap, cfg);
            if (!cfg.SoloForeground)
            {
                var visitaCerrada = _viaje.AlCambiarSuperficie(ahoraMono, pared, surfaceSap);
                if (visitaCerrada != null) _emitirVisita(_sesion.Abierto.ShiftId, visitaCerrada, _encounterVigente);
            }
        }
        else
        {
            _ultimaSurfaceSap = null;
            var vp = _sonda.Mirar();
            if (vp == null) return cierre;
            superficie = Normalizador.Normalizar(new EntradaDeSuperficie(vp.Proceso, null, vp.UrlNavegador, null), cfg.ParaNormalizar());
            // Salió de SAP: cerrar la visita en curso, si la había.
            var visitaCerrada = _viaje.AlCambiarSuperficie(ahoraMono, pared, null);
            if (visitaCerrada != null) _emitirVisita(_sesion.Abierto.ShiftId, visitaCerrada, _encounterVigente);
        }

        // ¿Cambió el contexto respecto al tick anterior?
        var claveContexto = superficie.App + "|" + (superficie.Surface ?? "") + "|" + (_encounterVigente ?? "");
        int cambios = _claveContextoAnterior != null && _claveContextoAnterior != claveContexto ? 1 : 0;
        _claveContextoAnterior = claveContexto;

        // Actividad y escritura del tick. La actividad se decide con el «hace cuánto» relativo,
        // que es comparable en cualquier reloj (los ganchos y este orquestador no comparten el suyo).
        bool activo = input.UltimoInputHaceMs <= Actividad.UmbralInactividadMs;
        int typingMs = (int)Math.Min(tic.AporteMs, Escritura.MsDeRafagas(input.InstantesDeTecla));

        _cubetas.Registrar(pared, superficie, _encounterVigente, new Aportes(
            ForegroundMs: tic.AporteMs,
            ActiveMs: activo ? tic.AporteMs : 0,
            TypingMs: typingMs,
            Teclas: input.InstantesDeTecla.Count,
            Clics: input.Clics,
            Scroll: input.Scroll,
            CambiosDeContexto: cambios,
            SapRoundtrips: roundtripsTick,
            SapEsperaMs: (int)Math.Min(esperaTick, int.MaxValue),
            Tabs: input.Tabs, Enters: input.Enters, Correcciones: input.Correcciones,
            Copias: input.Copias, Pegados: input.Pegados, Guardados: input.Guardados));
        return cierre;
    }

    private void ActualizarEncounter(string surface, string? tituloSap, ConfigDeMedicion cfg)
    {
        var partes = Normalizador.PartesSap(Normalizador.SinVista(surface));
        if (partes == null) return;

        var clave = _claveDelDia();
        if (clave == null) return; // sin secreto no hay huella; el tiempo SAP igual se mide, sin paciente

        // La extracción es por regla remota: título SAP con regex, o UN campo por selector. El
        // crudo entra a la regla, sale un grupo, se hashea y se suelta. No se guarda en ningún sitio.
        var extraido = ReglasDeIdentidad.Extraer(cfg.Reglas(), partes.Value.Tcode, _sap.LeerCampo, tituloSap);
        if (extraido == null) return; // sin paciente en esta pantalla: se conserva el encounter vigente

        var nuevo = Huella.DeIdentificador(clave, extraido.Value.IdNormalizado);
        if (nuevo == _encounterVigente) return;

        var shift = _sesion.Abierto!.ShiftId;
        if (_encounterVigente != null)
            _emitirEvento("encounter_exit", DateTimeOffset.UtcNow, shift, _encounterVigente, null);
        _encounterVigente = nuevo;
        _emitirEvento("encounter_enter", DateTimeOffset.UtcNow, shift, nuevo,
            new Dictionary<string, object?> { ["rule"] = extraido.Value.ReglaId });
    }

    /// <summary>Al cerrar el turno desde fuera (manual, apagado, turno nuevo): se olvida el
    /// encounter y se cierra la visita SAP pendiente.</summary>
    public Visita? OlvidarContexto(DateTimeOffset pared)
    {
        _encounterVigente = null;
        _ultimaSurfaceSap = null;
        _claveContextoAnterior = null;
        return _viaje.CerrarPendiente(Environment.TickCount64, pared);
    }
}
