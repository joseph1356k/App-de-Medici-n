using System.Runtime.Versioning;
using System.Text.Json;

namespace Medidor.App;

/// <summary>
/// LA RAÍZ DE COMPOSICIÓN del medidor. Arma las piezas, las cablea y las mueve con dos relojes de
/// la ventana oculta: el latido de medición (1 s) y el latido de subida (1 min). Mutex de
/// instancia única: dos medidores sobre el mismo PC contarían doble.
///
/// Todo el estado con contenido (título SAP, id de paciente crudo) vive dentro de un tick y muere
/// ahí; lo que cruza a las cubetas y al spool ya pasó por la aduana del Normalizador y de Cable.
///
/// El hilo principal NO SE BLOQUEA nunca después de instalar los ganchos: Windows quita un gancho
/// de bajo nivel cuyo hilo tarde en contestar (LowLevelHooksTimeout), y sin ganchos no hay clics
/// ni tecleo. Por eso la red va en hilos de fondo y el registro inicial ocurre ANTES de enganchar.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class Programa
{
    [STAThread]
    public static int Main()
    {
        using var mutex = new Mutex(true, "Local\\Medidor-instancia-unica", out bool primera);
        if (!primera) return 0; // ya hay un medidor corriendo en esta sesión

        Registro.Anota("medidor", $"arrancando v{VersionApp()} en {Environment.MachineName}");
        Registro.Podar(30);
        try { return new Programa().Correr(); }
        catch (Exception e)
        {
            Registro.Excepcion("fatal", e);
            Win32.MessageBoxW(IntPtr.Zero,
                "El medidor no pudo arrancar.\n\nRevisa el log en %LOCALAPPDATA%\\Medidor\\logs.\n\n" + e.Message,
                "Medidor", Win32.MB_OK | Win32.MB_ICONERROR | Win32.MB_TOPMOST);
            return 1;
        }
    }

    private Ajustes _ajustes = null!;
    private ClienteServidor _cliente = null!;
    private VentanaOculta _ventana = null!;
    private Bandeja _bandeja = null!;
    private SpoolCompartido _spool = null!;

    private Identidad? _identidad;
    private ConfigDeMedicion _config = ConfigDeMedicion.PorDefecto();
    private IReadOnlyList<MedicoDelRoster> _roster = Array.Empty<MedicoDelRoster>();
    private byte[]? _secreto;
    private volatile bool _conectado;

    private SondaPrimerPlano _sonda = null!;
    private Ganchos _ganchos = null!;
    private HiloSap _sap = null!;
    private Sesionizador _sesion = null!;
    private Cubetas _cubetas = null!;
    private Calidad _calidad = new();
    private Viaje _viaje = null!;
    private Orquestador _orquestador = null!;
    private Subidor _subidor = null!;

    private Turno? _turnoActual;
    private bool _bloqueado;
    private bool _apagando;
    private (Bandeja.EstadoUi, string?) _ultimoEstadoPintado = ((Bandeja.EstadoUi)(-1), null);

    private int Correr()
    {
        _ajustes = Ajustes.Cargar();
        if (!_ajustes.Completos)
        {
            Win32.MessageBoxW(IntPtr.Zero,
                "Falta la configuración de conexión del medidor.\n\n"
                + "Crea el archivo medidor.json con el servidor y la clave (instalar.ps1 lo hace solo):\n"
                + Rutas.ArchivoDeAjustes,
                "Medidor", Win32.MB_OK | Win32.MB_ICONERROR | Win32.MB_TOPMOST);
            return 2;
        }
        _cliente = new ClienteServidor(_ajustes.Servidor!, _ajustes.Clave!, VersionApp());
        _spool = new SpoolCompartido(new SpoolSqlite(Rutas.ArchivoDelSpool));

        CargarEstado();
        RegistrarAlArrancar(); // bloquea hasta 20 s, ANTES de los ganchos y de la ventana
        _secreto = Secreto.Cargar();

        _ventana = new VentanaOculta();
        _bandeja = new Bandeja(_ventana.Hwnd);

        _sonda = new SondaPrimerPlano();
        _ganchos = new Ganchos();
        _ganchos.Enganchar();
        _sap = new HiloSap(p => _config.EsProcesoSap(p), () => _config.SapIdentityMs);
        _sap.Arrancar();

        _sesion = new Sesionizador();
        _cubetas = new Cubetas();
        _viaje = new Viaje();
        _orquestador = new Orquestador(
            _sonda, _ganchos, _sap, _sesion, _cubetas, () => _calidad, _viaje,
            () => _config, ClaveDelDiaDelTurno, EmitirEvento, EmitirVisita);
        _orquestador.SapUserCambio += AsignarPorUsuarioSap;

        _subidor = new Subidor(_spool, _cliente, () => _identidad?.DeviceId, () => _calidad);
        _subidor.ConfigVersionNueva += cv => { if (cv > _config.Version) _ = RefrescarConfigAsync(); };
        _subidor.DevicePausado += () => _bandeja.Aviso("Medidor pausado", "Este equipo fue pausado desde el panel.", advertencia: true);
        _subidor.Conectado += ok => _conectado = ok;

        _ventana.Latido += Latido;
        _ventana.Subida += () => { if (_identidad == null) _ = RegistrarAsync(); _subidor.Latir(); };
        _ventana.MenuPedido += Menu;
        _ventana.Bloqueo += AlBloquear;
        _ventana.Suspende += () => EmitirEvento("suspend", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null, null);
        _ventana.Reanuda += () => EmitirEvento("resume", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null, null);
        _ventana.BarraRecreada += () => _bandeja.Mostrar();
        _ventana.Apagando += Apagar;

        // Abrir el turno del arranque (anónimo si nadie eligió). El baseline no se pierde por eso.
        AbrirTurno(null, null);
        EmitirEvento("medidor_start", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null,
            new Dictionary<string, object?> { ["version"] = VersionApp() });

        _ventana.ArmarRelojes(1000, 60_000);
        PintarEstado();
        _bandeja.Aviso("Medidor activo", _roster.Count > 0
            ? "Elige tu nombre desde el icono al empezar tu turno."
            : "Midiendo. Los nombres de los médicos se configuran en el panel web.");
        Registro.Anota("medidor", $"midiendo · registrado={_identidad != null} · roster={_roster.Count} · ganchos={(_ganchos.Degradado ? "degradados" : "ok")}");

        _ventana.Correr(); // bloquea hasta WM_QUIT
        Apagar();
        return 0;
    }

    // ── El latido ────────────────────────────────────────────────────────────

    private void Latido()
    {
        try
        {
            var cierre = _orquestador.Tick();
            if (cierre != null) CerrarTurno(cierre);

            // Sin turno abierto (se cerró por inactividad o a mano) y alguien vuelve a usar el PC:
            // abre uno anónimo. Solo con input reciente, para no encadenar turnos vacíos de 4 h.
            if (_sesion.Abierto == null && !_orquestador.Pausado && !_bloqueado
                && _orquestador.UltimoInputHaceMs < Actividad.UmbralInactividadMs)
                AbrirTurno(null, null);

            if (_sesion.Abierto != null) CosecharYEncolar(_sesion.Abierto.ShiftId, cerrarTodo: false);
            PintarEstado();
        }
        catch (Exception e) { Registro.Excepcion("tick", e); }
    }

    private void AlBloquear(bool bloqueado)
    {
        _bloqueado = bloqueado;
        _orquestador.Bloqueado(bloqueado);
        EmitirEvento(bloqueado ? "lock" : "unlock", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null, null);
        if (bloqueado && _sesion.Abierto != null) CosecharYEncolar(_sesion.Abierto.ShiftId, cerrarTodo: true);
        PintarEstado();
    }

    private string? MedicoActual => _sesion?.Abierto?.DoctorNombre;

    private void PintarEstado()
    {
        var estado = _orquestador.Pausado ? Bandeja.EstadoUi.Pausado
            : _identidad == null && !_conectado ? Bandeja.EstadoUi.Desconectado
            : MedicoActual == null ? Bandeja.EstadoUi.SinMedico
            : Bandeja.EstadoUi.Midiendo;
        var clave = (estado, MedicoActual);
        if (clave == _ultimoEstadoPintado) return;
        _ultimoEstadoPintado = clave;
        _bandeja.MostrarEstado(estado, MedicoActual);
    }

    // ── El menú ──────────────────────────────────────────────────────────────

    private void Menu()
    {
        var accion = _bandeja.Menu(_roster, _sesion.Abierto?.DoctorId, _orquestador.Pausado, _sesion.Abierto?.DoctorId != null);
        switch (accion)
        {
            case AccionDeMenu.ElegirMedico m:
                ElegirMedico(m.Medico, "menu");
                break;
            case AccionDeMenu.CerrarTurno:
                var c = _sesion.Cerrar(DateTimeOffset.Now, "manual");
                if (c != null) CerrarTurno(c);
                _bandeja.Aviso("Turno cerrado", "Gracias. El siguiente médico elige su nombre desde el icono.");
                break;
            case AccionDeMenu.Pausar:
                _orquestador.Pausar();
                if (_sesion.Abierto != null) CosecharYEncolar(_sesion.Abierto.ShiftId, cerrarTodo: true);
                break;
            case AccionDeMenu.Reanudar:
                _orquestador.Reanudar();
                break;
            case AccionDeMenu.QueSeMide:
                Bandeja.QueSeMide(_ventana.Hwnd);
                break;
            case AccionDeMenu.VerPanel:
                Win32.ShellExecuteW(IntPtr.Zero, "open", _ajustes.Servidor!, null, null, 1);
                break;
            case AccionDeMenu.Salir:
                if (Win32.MessageBoxW(_ventana.Hwnd, "¿Cerrar el medidor? Dejará de medir hasta que se vuelva a abrir.",
                        "Medidor", Win32.MB_YESNO | Win32.MB_ICONQUESTION | Win32.MB_TOPMOST) == Win32.IDYES)
                    _ventana.Cerrar();
                break;
        }
        PintarEstado();
    }

    private void ElegirMedico(MedicoDelRoster medico, string motivo)
    {
        if (_sesion.Abierto != null && _sesion.Abierto.DoctorId == medico.Id) return;

        // Turno abierto sin médico: se reasigna. Con otro médico: es un cambio de turno (cierra el
        // anterior y abre uno nuevo — dos médicos son dos turnos).
        if (_sesion.Abierto != null && _sesion.Abierto.DoctorId == null)
        {
            _sesion.Reasignar(medico.Id, medico.Nombre);
            _turnoActual = _sesion.Abierto;
            EmitirEvento("doctor_prompted", DateTimeOffset.UtcNow, _sesion.Abierto!.ShiftId, null,
                new Dictionary<string, object?> { ["reason"] = motivo });
            _spool.Encolar("turnos", Cable.Turno(_turnoActual!, null, _orquestador.SapUserVisto, _calidad));
        }
        else
        {
            AbrirTurno(medico.Id, medico.Nombre);
        }
        _bandeja.Aviso("Turno de " + medico.Nombre, motivo == "usuario_sap"
            ? "Asignado por tu usuario de SAP. Si no eres tú, elige tu nombre desde el icono."
            : "Midiendo tu turno. Puedes pausar desde el icono.");
        PintarEstado();
    }

    /// <summary>El usuario SAP (login del médico, no del paciente) asigna el turno solo si está en
    /// el roster. Así el selector deja de depender de que alguien se acuerde.</summary>
    private void AsignarPorUsuarioSap(string usuario)
    {
        var m = _roster.FirstOrDefault(r => r.UsuariosSap.Any(u => string.Equals(u, usuario, StringComparison.OrdinalIgnoreCase)));
        if (m == null) return;
        ElegirMedico(m, "usuario_sap");
    }

    // ── Turnos ───────────────────────────────────────────────────────────────

    private void AbrirTurno(string? doctorId, string? doctorNombre)
    {
        var anterior = _turnoActual;
        var (nuevo, cierreDelAnterior) = _sesion.Abrir(DateTimeOffset.Now, doctorId, doctorNombre, _identidad?.HmacVersion ?? 1);
        if (cierreDelAnterior != null && anterior != null) CerrarTurnoInterno(anterior, cierreDelAnterior);

        _turnoActual = nuevo;
        _calidad = new Calidad(); // la calidad es POR TURNO: un descarte de ayer no invalida el de hoy
        EmitirEvento("shift_start", nuevo.AbiertoEn, nuevo.ShiftId, null, null);
        _spool.Encolar("turnos", Cable.Turno(nuevo, null, null, _calidad));
        Registro.Anota("turno", $"abierto {nuevo.ShiftId} · médico={(doctorNombre == null ? "sin médico" : "sí")}");
    }

    /// <summary>Cierre que vino del sesionizador (inactividad, bloqueo) o del menú: el turno ya no
    /// está abierto, así que se usa el último conocido.</summary>
    private void CerrarTurno(CierreDeTurno cierre)
    {
        if (_turnoActual == null || _turnoActual.ShiftId != cierre.ShiftId) return;
        CerrarTurnoInterno(_turnoActual, cierre);
        _turnoActual = null;
    }

    private void CerrarTurnoInterno(Turno turno, CierreDeTurno cierre)
    {
        var visita = _orquestador.OlvidarContexto(DateTimeOffset.Now);
        if (visita != null) EmitirVisita(turno.ShiftId, visita, null);
        CosecharYEncolar(turno.ShiftId, cerrarTodo: true);
        EmitirEvento("shift_end", cierre.CerradoEn, cierre.ShiftId, null,
            new Dictionary<string, object?> { ["reason"] = cierre.Causa });
        _spool.Encolar("turnos", Cable.Turno(turno, cierre, _orquestador.SapUserVisto, _calidad));
        Registro.Anota("turno", $"cerrado {cierre.ShiftId} · causa={cierre.Causa}");
    }

    private byte[]? ClaveDelDiaDelTurno()
    {
        if (_secreto == null || _sesion.Abierto == null) return null;
        return Huella.ClaveDelDia(_secreto, _sesion.Abierto.DiaOperativo);
    }

    private void CosecharYEncolar(Guid shift, bool cerrarTodo)
    {
        var muestras = cerrarTodo ? _cubetas.CosecharTodo() : _cubetas.Cosechar(DateTimeOffset.Now);
        foreach (var m in muestras) _spool.Encolar("muestras", Cable.Muestra(shift, m));
    }

    private void EmitirEvento(string kind, DateTimeOffset cuando, Guid? shift, string? encounter, IReadOnlyDictionary<string, object?>? detail)
        => _spool.Encolar("eventos", Cable.Evento(kind, cuando, shift, encounter, detail));

    private void EmitirVisita(Guid shift, Visita v, string? encounter)
        => _spool.Encolar("visitas", Cable.Visita(shift, v, encounter));

    // ── Identidad y config ───────────────────────────────────────────────────

    private void CargarEstado()
    {
        try
        {
            if (!File.Exists(Rutas.ArchivoDeEstado)) return;
            var doc = JsonSerializer.Deserialize<EstadoEnDisco>(File.ReadAllText(Rutas.ArchivoDeEstado));
            if (doc?.Identidad != null && !string.IsNullOrWhiteSpace(doc.Identidad.DeviceId)) _identidad = doc.Identidad;
            if (doc?.Config != null) _config = doc.Config;
            if (doc?.Roster != null) _roster = doc.Roster;
        }
        catch (Exception e) { Registro.Excepcion("estado", e); }
    }

    private void RegistrarAlArrancar()
    {
        try { RegistrarAsync().GetAwaiter().GetResult(); }
        catch (Exception e) { Registro.Excepcion("registro", e); }
    }

    /// <summary>Se registra (o se vuelve a presentar) ante el servidor: devuelve identidad, secreto,
    /// config y roster. Si no hay red, se sigue con lo guardado y se reintenta cada minuto.</summary>
    private async Task RegistrarAsync()
    {
        try
        {
            using var doc = await _cliente.RegistrarAsync(_identidad?.DeviceId, Environment.MachineName,
                Environment.OSVersion.VersionString, VersionApp());
            if (doc == null) { _conectado = false; return; }
            AplicarRespuestaDelServidor(doc.RootElement, esRegistro: true);
            _conectado = true;
        }
        catch (Exception e) { Registro.Excepcion("registro", e); }
    }

    private async Task RefrescarConfigAsync()
    {
        try
        {
            if (_identidad == null) return;
            using var doc = await _cliente.ConfigAsync(_identidad.DeviceId, _config.Version, _identidad.HmacVersion);
            if (doc == null) return;
            var raiz = doc.RootElement;
            if (raiz.TryGetProperty("unchanged", out var un) && un.ValueKind == JsonValueKind.True) return;
            AplicarRespuestaDelServidor(raiz, esRegistro: false);
        }
        catch (Exception e) { Registro.Excepcion("config", e); }
    }

    private void AplicarRespuestaDelServidor(JsonElement raiz, bool esRegistro)
    {
        var id = _identidad ?? new Identidad();
        if (raiz.TryGetProperty("device_id", out var d) && d.ValueKind == JsonValueKind.String) id.DeviceId = d.GetString() ?? id.DeviceId;
        if (raiz.TryGetProperty("hospital", out var h) && h.ValueKind == JsonValueKind.String) id.Hospital = h.GetString() ?? "";
        if (raiz.TryGetProperty("config_version", out var cv) && cv.ValueKind == JsonValueKind.Number) id.ConfigVersion = cv.GetInt32();
        if (raiz.TryGetProperty("hmac", out var hm) && hm.ValueKind == JsonValueKind.Object)
        {
            if (hm.TryGetProperty("version", out var hv) && hv.ValueKind == JsonValueKind.Number) id.HmacVersion = hv.GetInt32();
            if (hm.TryGetProperty("secret", out var sec) && sec.ValueKind == JsonValueKind.String)
            {
                try
                {
                    Secreto.Guardar(Convert.FromBase64String(sec.GetString() ?? ""));
                    _secreto = Secreto.Cargar();
                }
                catch (Exception e) { Registro.Excepcion("secreto", e); }
            }
        }
        if (raiz.TryGetProperty("config", out var cfg) && cfg.ValueKind == JsonValueKind.Object)
        {
            var nueva = JsonSerializer.Deserialize<ConfigDeMedicion>(cfg.GetRawText());
            if (nueva != null && nueva.AppsPorProceso.Count > 0)
            {
                nueva.Version = id.ConfigVersion;
                _config = nueva;
            }
        }
        if (raiz.TryGetProperty("roster", out var r) && r.ValueKind == JsonValueKind.Array)
        {
            var lista = new List<MedicoDelRoster>();
            foreach (var m in r.EnumerateArray())
            {
                var usuarios = new List<string>();
                if (m.TryGetProperty("sap_users", out var su) && su.ValueKind == JsonValueKind.Array)
                    foreach (var u in su.EnumerateArray()) if (u.ValueKind == JsonValueKind.String) usuarios.Add(u.GetString() ?? "");
                lista.Add(new MedicoDelRoster(
                    m.GetProperty("id").GetString() ?? "",
                    m.GetProperty("display_name").GetString() ?? "",
                    usuarios));
            }
            _roster = lista;
        }
        if (string.IsNullOrWhiteSpace(id.DeviceId)) return;
        _identidad = id;
        GuardarEstado();
        Registro.Anota(esRegistro ? "registro" : "config", $"ok · config v{_config.Version} · roster {_roster.Count} · hmac v{id.HmacVersion}");
        if (_sesion != null)
            EmitirEvento("config_applied", DateTimeOffset.UtcNow, _sesion.Abierto?.ShiftId, null,
                new Dictionary<string, object?> { ["version"] = _config.Version });
    }

    private void GuardarEstado()
    {
        try
        {
            var estado = new EstadoEnDisco { Identidad = _identidad, Config = _config, Roster = _roster.ToList() };
            File.WriteAllText(Rutas.ArchivoDeEstado, JsonSerializer.Serialize(estado));
        }
        catch (Exception e) { Registro.Excepcion("estado", e); }
    }

    private static string VersionApp()
        => typeof(Programa).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    // ── Apagado ──────────────────────────────────────────────────────────────

    private void Apagar()
    {
        if (_apagando) return;
        _apagando = true;
        try
        {
            Registro.Anota("medidor", "apagando");
            var cierre = _sesion?.Cerrar(DateTimeOffset.Now, "apagado");
            if (cierre != null) CerrarTurno(cierre);
            EmitirEvento("medidor_stop", DateTimeOffset.UtcNow, null, null, null);
            // Un último intento de subida, acotado: si la red está, se va limpio; si no, el spool lo guarda.
            try { _subidor?.LatirAsync().Wait(TimeSpan.FromSeconds(8)); } catch (Exception e) { Registro.Excepcion("subida", e); }
            _sap?.Dispose();
            _ganchos?.Dispose();
            _bandeja?.Dispose();
            _spool?.Dispose();
        }
        catch (Exception e) { Registro.Excepcion("apagar", e); }
    }

    private sealed class EstadoEnDisco
    {
        public Identidad? Identidad { get; set; }
        public ConfigDeMedicion? Config { get; set; }
        public List<MedicoDelRoster>? Roster { get; set; }
    }
}
