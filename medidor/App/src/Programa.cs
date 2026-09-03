using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text.Json;

namespace Medidor.App;

/// <summary>
/// LA RAÍZ DE COMPOSICIÓN del medidor. Arma las piezas, las cablea y las mueve con dos relojes de
/// la ventana oculta: el latido de medición (1 s) y el latido de subida (1 min). Mutex de
/// instancia única: dos medidores sobre el mismo PC contarían doble.
///
/// NUNCA SE APAGA. Cuatro capas de supervivencia, de la más rápida a la más lenta: el manejador de
/// colapsos que vuelca lo medido y relanza (segundos) → RegisterApplicationRestart (WER, para
/// cuelgues y fallos nativos) → la tarea programada «Medidor-Vigilante» cada 5 min → la clave Run
/// al iniciar sesión. Y GRABA SIEMPRE: la unidad es la jornada (consultorio × día operativo, corte
/// 06:00), no el turno de un médico; bloqueado se graba como «bloqueado».
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
    private static Programa? _instancia;
    private static bool _vigilanteOk;

    /// <summary>Un GUID por arranque del .exe. Viaja en cada foto de la jornada: el servidor guarda
    /// una fila por (device, día, proceso) y SUMA los contadores entre procesos (contrato 1). Por
    /// eso los contadores de calidad viven en memoria y arrancan en cero: restaurarlos duplicaría.</summary>
    public static Guid ProcesoId { get; private set; }

    [STAThread]
    public static int Main(string[] args)
    {
        // Antes que nada: que ningún fallo termine en un diálogo de Windows que deje al proceso muerto
        // pero vivo (con el mutex tomado y sin medir). El colapso se anota, se vuelca y se relanza.
        AppDomain.CurrentDomain.UnhandledException += Colapso;
        TaskScheduler.UnobservedTaskException += (_, e) => { Registro.Excepcion("tarea", e.Exception); e.SetObserved(); };
        Win32.SetErrorMode(Win32.SEM_FAILCRITICALERRORS | Win32.SEM_NOGPFAULTERRORBOX | Win32.SEM_NOOPENFILEERRORBOX);

        // DOS PAPELES EN UN SOLO ARCHIVO. Si este .exe se abrió desde cualquier sitio que no sea
        // su carpeta de instalación —la carpeta de Descargas, el escritorio, una USB— hace de
        // INSTALADOR: se copia a su sitio, se registra para arrancar con Windows y como tarea
        // vigilante, lanza a la copia y se va. Si ya está en su carpeta, hace de MEDIDOR.
        //
        // Nace de tres intentos fallidos en el piloto del HGM (2026-09-02): un .exe que exige
        // correr un .ps1 al lado se instala mal, porque el gesto natural sobre un .exe es el doble
        // clic. instalar.ps1 sigue existiendo y sigue funcionando.
        var modo = Arranque.Desde(args);
        if (modo is Arranque.Normal && Instalador.HayQueInstalar()) return Instalador.InstalarYSalir();

        // Sin propiedad inicial: el relanzado tras un colapso debe ESPERAR a que el padre suelte el mutex.
        using var mutex = new Mutex(false, "Local\\Medidor-instancia-unica");
        if (!Vigilante.TomarInstancia(mutex, modo)) return 0; // ya hay un medidor midiendo en esta sesión

        Vigilante.Latir();
        ProcesoId = Guid.NewGuid();
        Registro.Anota("medidor", $"arrancando v{VersionApp()} pid={Environment.ProcessId} proceso={ProcesoId} modo={modo} en {Environment.MachineName}");
        Registro.Podar(30);

        // La tarea programada puede lanzar en BelowNormal; los ganchos de bajo nivel quieren Normal.
        try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.Normal; } catch { }
        // Tercera capa (WER): tras un cuelgue o un fallo nativo, Windows relanza con --relanzado.
        Win32.RegisterApplicationRestart("--relanzado", Win32.RESTART_NO_PATCH | Win32.RESTART_NO_REBOOT);

        if (!Instalador.SinInstalar)
        {
            Instalador.AsegurarArranqueConWindows();
            _vigilanteOk = Instalador.AsegurarVigilante();
        }

        try
        {
            _instancia = new Programa(modo);
            return _instancia.Correr();
        }
        catch (Exception e)
        {
            Registro.Excepcion("fatal", e);
            if (modo is Arranque.Normal) // sin modal si nadie mira: el vigilante y el relanzo no tienen a quién avisar
                Win32.MessageBoxW(IntPtr.Zero,
                    "El medidor no pudo arrancar.\n\nRevisa el log en %LOCALAPPDATA%\\Medidor\\logs.\n\n" + e.Message,
                    "Medidor", Win32.MB_OK | Win32.MB_ICONERROR | Win32.MB_TOPMOST);
            return 1;
        }
    }

    /// <summary>Una excepción que nadie atrapó, en cualquier hilo. Se anota la cadena entera, se
    /// vuelca lo medido (≤ 3 s), y se relanza —con guardia: 5 en 10 min, el sexto se lo deja al
    /// vigilante—. Environment.Exit(70) evita el diálogo de WER, que dejaría vivo al proceso muerto
    /// con el mutex tomado.</summary>
    private static void Colapso(object sender, UnhandledExceptionEventArgs e)
    {
        try
        {
            if (e.ExceptionObject is Exception ex) Registro.Excepcion("fatal", ex);
            else Registro.Anota("fatal", $"colapso: {e.ExceptionObject}");

            try { Task.Run(() => _instancia?.VolcarAntesDeMorir("colapso")).Wait(3000); }
            catch (Exception x) { Registro.Excepcion("fatal", x); }

            var (relanzar, historial) = GuardiaDeRelanzos.Evaluar(Vigilante.LeerRelanzos(), DateTimeOffset.Now);
            Vigilante.GuardarRelanzos(historial);
            if (relanzar && Environment.ProcessPath is string exe)
            {
                Process.Start(new ProcessStartInfo(exe, $"--relanzado={Environment.ProcessId}")
                { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) ?? "" });
                Registro.Anota("fatal", $"relanzado ({historial.Count} en {GuardiaDeRelanzos.VentanaMinutos} min)");
            }
            else
                Registro.Anota("fatal", $"{GuardiaDeRelanzos.Maximo} colapsos en {GuardiaDeRelanzos.VentanaMinutos} min: no se relanza; el vigilante reintenta en ≤ 5 min");
        }
        catch { /* ya no queda nada que hacer salvo salir */ }
        finally { Environment.Exit(70); }
    }

    private readonly Arranque _modo;

    private Ajustes _ajustes = null!;
    private ClienteServidor _cliente = null!;
    private VentanaOculta _ventana = null!;
    private Bandeja _bandeja = null!;
    private SpoolCompartido _spool = null!;

    private Identidad? _identidad;
    private ConfigDeMedicion _config = ConfigDeMedicion.PorDefecto();
    private byte[]? _secreto;
    private volatile bool _conectado;
    private readonly object _candadoEstado = new();

    private SondaPrimerPlano _sonda = null!;
    private Ganchos _ganchos = null!;
    private HiloSap _sap = null!;
    private Cubetas _cubetas = null!;
    private Calidad _calidad = new();
    private Viaje _viaje = null!;
    private Orquestador _orquestador = null!;
    private Subidor _subidor = null!;

    private readonly Jornadas _jornadas = new();
    private long _tick;
    private long _ultimoTickMono;
    private DateOnly? _diaDeLaClave;
    private byte[]? _claveDelDiaCache;
    private long _proximoIntentoDeSpoolMono;
    private bool _volcado;
    private bool _apagando;
    private (Bandeja.EstadoUi, string?) _ultimoEstadoPintado = ((Bandeja.EstadoUi)(-1), null);

#if DEBUG
    private long _soltarGanchosEnTick = -1, _colapsarEnTick = -1;
#endif

    private Programa(Arranque modo) => _modo = modo;

    private int Correr()
    {
        _ajustes = Ajustes.Cargar();
        if (!_ajustes.Completos)
        {
            // Con la clave horneada al compilar, esto ya no le pasa a quien use el .exe oficial de
            // la Release. Queda para el caso que sí puede darse: un .exe compilado desde el repo
            // sin -p:MedidorClavePorDefecto, donde a propósito no hay ninguna credencial. El
            // mensaje da las DOS salidas — decir solo «falta configuración» manda a la persona a
            // buscar un archivo que no sabe crear (pasó tres veces en el piloto del HGM).
            Registro.Anota("medidor", "falta la clave del servidor: no se mide");
            if (_modo is Arranque.Normal)
                Win32.MessageBoxW(IntPtr.Zero,
                    "A esta copia del medidor le falta la clave del servidor.\n\n"
                    + "Pasa cuando el programa se compila desde el código en vez de descargarse ya listo.\n\n"
                    + "Dos formas de arreglarlo:\n"
                    + "   1. Descarga el Medidor.exe oficial, que ya trae la clave dentro.\n"
                    + "   2. O corre instalar.ps1 pasándole el servidor y la clave.\n\n"
                    + $"Servidor: {_ajustes.Servidor ?? "(ninguno)"}\n"
                    + $"Configuración: {Rutas.ArchivoDeAjustes}",
                    "Medidor — falta la clave", Win32.MB_OK | Win32.MB_ICONERROR | Win32.MB_TOPMOST);
            return 2;
        }
        _cliente = new ClienteServidor(_ajustes.Servidor!, _ajustes.Clave!, VersionApp());

        // Un spool corrupto no tumba el arranque: se aparta con fecha y se recrea (promesa 27).
        var sqlite = new SpoolSqlite(Rutas.ArchivoDelSpool);
        _spool = new SpoolCompartido(sqlite);
        if (sqlite.ArchivoCorrupto != null) Registro.Anota("spool", $"corrupto al abrir: apartado como {Path.GetFileName(sqlite.ArchivoCorrupto)} y recreado vacío");
        if (sqlite.FilasV1Purgadas > 0) Registro.Anota("spool", $"formato 1 → 2: {sqlite.FilasV1Purgadas} filas viejas purgadas (llevaban shift_id)");

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

        _cubetas = new Cubetas();
        _viaje = new Viaje();
        _orquestador = new Orquestador(
            _sonda, _ganchos, _sap, _cubetas, () => _calidad, _viaje,
            () => _config, ClaveDelDia, EmitirEvento, EmitirVisita);

        _subidor = new Subidor(_spool, _cliente, () => _identidad?.DeviceId, () => _calidad, VersionApp);
        _subidor.ConfigVersionNueva += cv => { if (cv > _config.Version) _ = RefrescarConfigAsync(); };
        _subidor.DevicePausado += () => _bandeja.Aviso("Medidor pausado", "Este equipo fue pausado desde el panel.", advertencia: true);
        _subidor.Conectado += ok => _conectado = ok;
        _subidor.ConsultorioRecibido += AplicarConsultorio;

        _ventana.Latido += Latido;
        _ventana.Subida += () => { if (_identidad == null) _ = RegistrarAsync(); _subidor.Latir(); };
        _ventana.MenuPedido += Menu;
        _ventana.Bloqueo += AlBloquear;
        _ventana.Suspende += () => EmitirEvento("suspend", DateTimeOffset.Now, null, null);
        _ventana.Reanuda += () => { EmitirEvento("resume", DateTimeOffset.Now, null, null); Vigilante.Latir(); }; // que el vigilante no nos dé por muertos al despertar
        _ventana.BarraRecreada += () => _bandeja.Mostrar();
        _ventana.Apagando += Apagar;

        // La jornada del arranque. Lo que el spool tuvo que hacer al abrir se dice con eventos: el
        // panel tiene que poder explicar un hueco o un reinicio de cola sin abrir el log del PC.
        var pared = DateTimeOffset.Now;
        if (_modo is Arranque.Relanzado) _calidad.Relanzo();
        _jornadas.Avanzar(pared);
        if (sqlite.ArchivoCorrupto != null)
            EmitirEvento("spool_reset", pared, null, new Dictionary<string, object?> { ["reason"] = "corrupto_arranque" });
        if (sqlite.FilasV1Purgadas > 0)
            EmitirEvento("spool_drop", pared, null, new Dictionary<string, object?> { ["reason"] = "formato_v1", ["count"] = sqlite.FilasV1Purgadas });
        EmitirEvento("medidor_start", pared, null, new Dictionary<string, object?> { ["version"] = VersionApp(), ["reason"] = _modo.Motivo });
        EmitirEvento("jornada_inicio", pared, null, null);
        EmitirJornada(_jornadas.Actual!, _calidad);

#if DEBUG
        // Solo en Debug: provocar un colapso o soltar los ganchos para ver el relanzo y el rearme en vivo.
        if (Environment.GetEnvironmentVariable("MEDIDOR_PROBAR_COLAPSO") == "1") _colapsarEnTick = 20;
        if (Environment.GetEnvironmentVariable("MEDIDOR_PROBAR_GANCHOS") == "1") _soltarGanchosEnTick = 20;
#endif

        _ventana.ArmarRelojes(1000, 60_000);
        PintarEstado();
        if (_modo is Arranque.Normal)
            _bandeja.Aviso("Medidor activo", string.IsNullOrWhiteSpace(_identidad?.ConsultorioNombre)
                ? "Midiendo. El consultorio de este PC se asigna desde el panel (Dispositivos)."
                : $"Midiendo {_identidad!.ConsultorioNombre}.");
        Registro.Anota("medidor", $"midiendo · registrado={_identidad != null} · consultorio={_identidad?.ConsultorioNombre ?? "sin asignar"}"
            + $" · ganchos={(_ganchos.Degradado ? "degradados" : "ok")} · vigilante={SiNo(_vigilanteOk)}");

        _ventana.Correr(); // bloquea hasta WM_QUIT
        Apagar();
        return 0;
    }

    // ── El latido ────────────────────────────────────────────────────────────

    private void Latido()
    {
        try
        {
            var pared = DateTimeOffset.Now;
            _tick++;

            // Un hueco de más de un minuto entre ticks es una suspensión (o un cuelgue largo): se
            // renueva el latido ya, antes de que la tarea vigilante —que también despierta— lo lea viejo.
            var ahoraMono = Environment.TickCount64;
            if (_ultimoTickMono != 0 && ahoraMono - _ultimoTickMono > 60_000) Vigilante.Latir();
            _ultimoTickMono = ahoraMono;

            // A las 06:00 la jornada cambia sola: se cosecha TODO (las cubetas de ayer ya no reciben
            // nada), se emite la última foto de la cerrada, y la nueva arranca con calidad en cero.
            var cerrada = _jornadas.Avanzar(pared);
            if (cerrada != null)
            {
                CosecharYEncolar(todo: true);
                EmitirJornada(cerrada, _calidad);
                EmitirEvento("jornada_fin", cerrada.UltimaMuestra, null, null);
                _orquestador.OlvidarEncounter(pared, "dia_nuevo");
                _calidad = new Calidad();
                _orquestador.NuevaJornada();
                EmitirEvento("jornada_inicio", pared, null, null);
                Registro.Anota("jornada", $"{cerrada.Dia:yyyy-MM-dd} cerrada → {_jornadas.Actual!.Dia:yyyy-MM-dd} abierta");
            }

#if DEBUG
            if (_tick == _soltarGanchosEnTick) { _ganchos.Desenganchar(); Registro.Anota("ganchos", "PRUEBA: ganchos soltados (MEDIDOR_PROBAR_GANCHOS)"); }
            if (_tick == _colapsarEnTick) new Thread(() => throw new InvalidOperationException("colapso de prueba (MEDIDOR_PROBAR_COLAPSO)")).Start();
#endif

            _orquestador.Tick(pared);

            // Solo cubetas COMPLETAS cada 15 s (contrato 6): la clave única del servidor es
            // (device, bucket_start, seq) y una cubeta a medias chocaría con su versión completa.
            if (_tick % 15 == 0) CosecharYEncolar(todo: false);

            if (_tick % 300 == 0)
            {
                EmitirJornada(_jornadas.Actual!, _calidad);
                Heartbeat(pared);
                Vigilante.Latir();
                if (!_bandeja.Visible) _bandeja.Mostrar();
            }

            if (_spool.Corrupto && Environment.TickCount64 >= _proximoIntentoDeSpoolMono)
            {
                _proximoIntentoDeSpoolMono = Environment.TickCount64 + 60_000;
                var movido = _spool.Reabrir();
                Registro.Anota("spool", $"corrupto en marcha: apartado como {Path.GetFileName(movido)} y recreado vacío");
                EmitirEvento("spool_reset", pared, null, new Dictionary<string, object?> { ["reason"] = "corrupto_en_marcha" });
            }

            PintarEstado();
        }
        catch (Exception e) { Registro.Excepcion("tick", e); }
    }

    /// <summary>Solo el estado y el evento. SIN cosechar (contrato 6): la cubeta en curso se
    /// completa sola como «bloqueado» y sale con las demás.</summary>
    private void AlBloquear(bool bloqueado)
    {
        _orquestador.Bloqueado(bloqueado);
        EmitirEvento(bloqueado ? "lock" : "unlock", DateTimeOffset.Now, null, null);
        PintarEstado();
    }

    private void PintarEstado()
    {
        var consultorio = _identidad?.ConsultorioNombre;
        var estado = !_conectado ? Bandeja.EstadoUi.Desconectado
            : string.IsNullOrWhiteSpace(consultorio) ? Bandeja.EstadoUi.SinConsultorio
            : Bandeja.EstadoUi.Midiendo;
        var clave = (estado, consultorio);
        if (clave == _ultimoEstadoPintado) return;
        _ultimoEstadoPintado = clave;
        _bandeja.MostrarEstado(estado, consultorio);
    }

    /// <summary>La línea de latido del log, cada 5 min: lo que hace falta para diagnosticar un PC
    /// callado sin conectarse a él (A3). Solo etiquetas y conteos.</summary>
    private void Heartbeat(DateTimeOffset pared)
    {
        var ultimaSubida = _subidor.UltimaSubidaOk is DateTimeOffset u ? $"{(pared - u).TotalMinutes:F0}min" : "nunca";
        Registro.Anota("medidor",
            $"vivo · dia={_jornadas.Actual?.Dia:yyyy-MM-dd} · consultorio={_identidad?.ConsultorioNombre ?? "sin asignar"} · ticks={_tick}"
            + $" · bloqueado={SiNo(_orquestador.EstaBloqueado)} · ganchos={(_ganchos.Degradado ? "degradados" : "ok")}(rearmados {_ganchos.Rearmados})"
            + $" · sap=motor:{SiNo(_sap.Enganchado)} eventos:{SiNo(_sap.EventosEnganchados)}"
            + $" · spool={_spool.BytesAproximados / 1024}KB/{_spool.Filas}filas · ultima_subida_hace={ultimaSubida}"
            + $" · huecos_ms={_calidad.HuecosMs} · vigilante={SiNo(_vigilanteOk)}");
    }

    private static string SiNo(bool b) => b ? "si" : "no";

    // ── El menú ──────────────────────────────────────────────────────────────

    private void Menu()
    {
        switch (_bandeja.Menu())
        {
            case AccionDeMenu.QueSeMide:
                Bandeja.QueSeMide(_ventana.Hwnd, _identidad?.ConsultorioNombre);
                break;
            case AccionDeMenu.VerPanel:
                Win32.ShellExecuteW(IntPtr.Zero, "open", _ajustes.Servidor!, null, null, 1);
                break;
        }
        PintarEstado();
    }

    // ── Jornada, cubetas y eventos ───────────────────────────────────────────

    /// <summary>La clave de la huella se deriva POR TICK del día operativo de <paramref name="pared"/>
    /// (cacheada por día): a las 06:00 rota sola, sin input ni turno (promesa 30).</summary>
    private byte[]? ClaveDelDia(DateTimeOffset pared)
    {
        if (_secreto == null) return null;
        var dia = Huella.DiaOperativo(pared);
        if (_diaDeLaClave != dia)
        {
            _claveDelDiaCache = Huella.ClaveDelDia(_secreto, dia);
            _diaDeLaClave = dia;
        }
        return _claveDelDiaCache;
    }

    private void CosecharYEncolar(bool todo)
    {
        if (_cubetas == null || _spool == null) return;
        var muestras = todo ? _cubetas.CosecharTodo() : _cubetas.Cosechar(DateTimeOffset.Now);
        foreach (var m in muestras) _spool.Encolar("muestras", Cable.Muestra(m));
    }

    /// <summary>La foto de la jornada desde este proceso. Se encola la nueva y se compactan las
    /// anteriores no enviadas del mismo proceso y día: sin red, `jornadas` se queda en ≤ 1 fila
    /// pendiente por proceso en vez de crecer una por cada 5 min.</summary>
    private void EmitirJornada(Jornada jornada, Calidad calidad)
    {
        _spool.Encolar("jornadas", Cable.Jornada(jornada, calidad, VersionApp(), _identidad?.HmacVersion ?? 1, ProcesoId));
        _spool.Compactar("jornadas", jornada.Dia, ProcesoId);
    }

    private void EmitirEvento(string kind, DateTimeOffset cuandoLocal, string? encounter, IReadOnlyDictionary<string, object?>? detail)
        => _spool.Encolar("eventos", Cable.Evento(kind, cuandoLocal, encounter, detail));

    private void EmitirVisita(Visita v, string? encounter, string? sapUser)
        => _spool.Encolar("visitas", Cable.Visita(v, encounter, sapUser));

    // ── Identidad, config y consultorio ──────────────────────────────────────

    private void CargarEstado()
    {
        try
        {
            if (!File.Exists(Rutas.ArchivoDeEstado)) return;
            // Los estado.json de la v1 traen «Roster»: se ignora sin protestar.
            var doc = JsonSerializer.Deserialize<EstadoEnDisco>(File.ReadAllText(Rutas.ArchivoDeEstado));
            if (doc?.Identidad != null && !string.IsNullOrWhiteSpace(doc.Identidad.DeviceId)) _identidad = doc.Identidad;
            if (doc?.Config != null) _config = doc.Config;
        }
        catch (Exception e) { Registro.Excepcion("estado", e); }
    }

    private void RegistrarAlArrancar()
    {
        try { RegistrarAsync().GetAwaiter().GetResult(); }
        catch (Exception e) { Registro.Excepcion("registro", e); }
    }

    /// <summary>Se registra (o se vuelve a presentar) ante el servidor: devuelve identidad, secreto,
    /// config y consultorio. Si no hay red, se sigue con lo guardado y se reintenta cada minuto.</summary>
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
                    _diaDeLaClave = null; // secreto nuevo: la clave del día se vuelve a derivar
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
        // Consultorio: ausente → conservar; null → limpiar; objeto → asignar. El roster ya no se lee:
        // el médico dejó de ser la unidad (queda el usuario SAP por cubeta como anotación).
        if (raiz.TryGetProperty("consultorio", out var c))
        {
            if (c.ValueKind == JsonValueKind.Null) { id.ConsultorioId = null; id.ConsultorioNombre = null; }
            else if (ClienteServidor.LeerConsultorio(c) is ConsultorioDelServidor leido) { id.ConsultorioId = leido.Id; id.ConsultorioNombre = leido.Nombre; }
        }
        if (string.IsNullOrWhiteSpace(id.DeviceId)) return;
        _identidad = id;
        GuardarEstado();
        Registro.Anota(esRegistro ? "registro" : "config", $"ok · config v{_config.Version} · consultorio={id.ConsultorioNombre ?? "sin asignar"} · hmac v{id.HmacVersion}");
        if (_orquestador != null)
            EmitirEvento("config_applied", DateTimeOffset.Now, null, new Dictionary<string, object?> { ["version"] = _config.Version });
    }

    /// <summary>Llega con la respuesta de cada lote (hilo del subidor). Solo se anota y se guarda si
    /// cambió; el icono lo pinta el siguiente tick.</summary>
    private void AplicarConsultorio(ConsultorioDelServidor? consultorio)
    {
        var id = _identidad;
        if (id == null) return;
        if (id.ConsultorioId == consultorio?.Id && id.ConsultorioNombre == consultorio?.Nombre) return;
        id.ConsultorioId = consultorio?.Id;
        id.ConsultorioNombre = consultorio?.Nombre;
        GuardarEstado();
        Registro.Anota("consultorio", consultorio == null ? "desasignado desde el panel" : $"asignado desde el panel: {consultorio.Nombre}");
        if (consultorio != null) _bandeja?.Aviso("Consultorio asignado", $"Este PC mide {consultorio.Nombre}.");
    }

    private void GuardarEstado()
    {
        try
        {
            lock (_candadoEstado)
            {
                var estado = new EstadoEnDisco { Identidad = _identidad, Config = _config };
                File.WriteAllText(Rutas.ArchivoDeEstado, JsonSerializer.Serialize(estado));
            }
        }
        catch (Exception e) { Registro.Excepcion("estado", e); }
    }

    private static string VersionApp()
        => typeof(Programa).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    // ── Apagado y colapso ────────────────────────────────────────────────────

    /// <summary>Lo que no puede perderse aunque el proceso muera ya: la visita SAP en curso, TODAS las
    /// cubetas (incluida la que está a medias: no llegará ningún tick más), la última foto de la
    /// jornada y el `medidor_stop` con su motivo. Sin subir nada: el spool lo guarda y el siguiente
    /// proceso lo manda. Idempotente: el apagado y el colapso pueden coincidir.</summary>
    public void VolcarAntesDeMorir(string reason)
    {
        if (_volcado) return;
        _volcado = true;
        try
        {
            if (_spool == null) return;
            var pared = DateTimeOffset.Now;
            _orquestador?.CerrarVisitaPendiente(pared);
            _orquestador?.OlvidarEncounter(pared, reason);
            CosecharYEncolar(todo: true);
            if (_jornadas.Actual != null) EmitirJornada(_jornadas.Actual, _calidad);
            EmitirEvento("medidor_stop", pared, null, new Dictionary<string, object?> { ["reason"] = reason });
            Registro.Anota("medidor", $"volcado ({reason})");
        }
        catch (Exception e) { Registro.Excepcion("volcado", e); }
    }

    private void Apagar()
    {
        if (_apagando) return;
        _apagando = true;
        try
        {
            Registro.Anota("medidor", "apagando");
            VolcarAntesDeMorir("apagado");
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
    }
}
