namespace Medidor.App;

/// <summary>
/// EL SUBIDOR: cada minuto arma un lote desde el spool y lo manda. Un latido por minuto por PC
/// (15 PCs = 15 peticiones/min) es nada para el servidor y para el NAT del hospital.
///
/// El orden es aceptar-y-verificar: solo tras un 200 se toca el spool —confirmar lo aceptado,
/// envenenar lo rechazado, dejar lo no procesado—; ante cualquier fallo el spool queda intacto y
/// se reintenta al siguiente latido. Un lote vacío se manda igual: es el heartbeat que distingue
/// «medidor vivo, PC quieto» de «medidor muerto» (el panel marca el silencio por dispositivo).
///
/// Corre en un hilo de fondo; el spool compartido lleva su propio candado.
/// </summary>
public sealed class Subidor
{
    private readonly SpoolCompartido _spool;
    private readonly ClienteServidor _cliente;
    private readonly Func<string?> _deviceId;
    private readonly Func<Calidad> _calidad;
    private readonly Func<string> _appVersion;
    private DateTime _proximoPermitido = DateTime.MinValue;
    private int _descartesVistos;
    private int _corriendo;

    public event Action<int>? ConfigVersionNueva;
    public event Action? DevicePausado;
    public event Action<bool>? Conectado;

    /// <summary>La respuesta del lote trajo la clave <c>consultorio</c>: el objeto, o null si el
    /// panel desasignó este PC.</summary>
    public event Action<ConsultorioDelServidor?>? ConsultorioRecibido;

    public DateTimeOffset? UltimaSubidaOk { get; private set; }

    public Subidor(SpoolCompartido spool, ClienteServidor cliente, Func<string?> deviceId, Func<Calidad> calidad, Func<string> appVersion)
    {
        _spool = spool; _cliente = cliente; _deviceId = deviceId; _calidad = calidad; _appVersion = appVersion;
        // Los descartes de procesos anteriores ya viajaron con sus jornadas: este proceso solo cuenta
        // los suyos (contrato 1: los contadores son por proceso y no se restauran).
        _descartesVistos = spool.DescartesAcumulados;
    }

    /// <summary>Un latido, en un hilo de fondo. Si el anterior sigue corriendo, se salta.</summary>
    public void Latir()
    {
        if (Interlocked.CompareExchange(ref _corriendo, 1, 0) != 0) return;
        _ = Task.Run(async () =>
        {
            try { await LatirAsync(); }
            catch (Exception e) { Registro.Excepcion("subida", e); }
            finally { Interlocked.Exchange(ref _corriendo, 0); }
        });
    }

    public async Task LatirAsync()
    {
        var deviceId = _deviceId();
        if (deviceId == null) return; // aún sin registrar: el spool acumula; se sube al registrarse
        if (DateTime.UtcNow < _proximoPermitido) return; // respetando un Retry-After previo

        // Los descartes del spool (si el disco se llenó) pasan a la calidad de la jornada — solo los
        // nuevos desde la última vez, no el acumulado (sumarlo cada minuto contaría el mismo
        // descarte sesenta veces por hora).
        var descartes = _spool.DescartesAcumulados;
        if (descartes > _descartesVistos) { _calidad().Descartes(descartes - _descartesVistos); _descartesVistos = descartes; }

        var lote = _spool.Tomar(new LimitesDeLote());
        var cuerpo = Lote.Serializar(deviceId, Guid.NewGuid().ToString(), DateTimeOffset.UtcNow, _appVersion(), lote);

        var resp = await _cliente.EnviarLoteAsync(cuerpo, lote);
        if (!resp.Ok)
        {
            Conectado?.Invoke(false);
            if (resp.Codigo == 403) { DevicePausado?.Invoke(); return; }
            if (resp.RetryAfterS is int s) _proximoPermitido = DateTime.UtcNow.AddSeconds(s);
            return; // el spool intacto: se reintenta
        }
        Conectado?.Invoke(true);
        UltimaSubidaOk = DateTimeOffset.Now;

        foreach (var (col, seq) in resp.Veneno)
        {
            _spool.Envenenar(col, seq);
            Registro.Anota("subidor", $"veneno sacado: {col}#{seq}");
        }
        _spool.Confirmar(resp.Confirmar);

        if (!lote.Vacio)
            Registro.Anota("subidor", $"subido: {lote.Jornadas.Count} jornadas · {lote.Muestras.Count} muestras · {lote.Eventos.Count} eventos · {lote.Visitas.Count} visitas"
                + $" · veneno {resp.Veneno.Count} · no procesadas {resp.NoProcesadas.Count}");

        if (resp.ConfigVersion is int cv) ConfigVersionNueva?.Invoke(cv);
        if (resp.TraeConsultorio) ConsultorioRecibido?.Invoke(resp.Consultorio);
    }
}

/// <summary>El spool con candado: el hilo de la ventana encola y el hilo del subidor toma y
/// confirma. SQLite no admite dos hilos sobre la misma conexión sin serializarlos.
///
/// Y el sitio donde se nota la corrupción EN MARCHA: una excepción de archivo (no de uso) deja
/// <see cref="Corrupto"/> en true y el latido llama a <see cref="Reabrir"/>, que aparta la base y
/// abre una nueva. La excepción se relanza: quien encolaba se entera y lo anota.</summary>
public sealed class SpoolCompartido : IDisposable
{
    private readonly SpoolSqlite _spool;
    private readonly object _candado = new();
    private volatile bool _corrupto;

    public SpoolCompartido(SpoolSqlite spool) => _spool = spool;

    public bool Corrupto => _corrupto;

    public long Encolar(string coleccion, string json) => Con(s => s.Encolar(coleccion, json));
    public LoteTomado Tomar(LimitesDeLote limites) => Con(s => s.Tomar(limites));
    public void Confirmar(LoteTomado lote) => Con(s => { s.Confirmar(lote); return 0; });
    public void Envenenar(string coleccion, long seq) => Con(s => { s.Envenenar(coleccion, seq); return 0; });
    public int Compactar(string coleccion, DateOnly dia, Guid procesoId) => Con(s => s.Compactar(coleccion, dia, procesoId));
    public int DescartesAcumulados => Con(s => s.DescartesAcumulados);
    public long BytesAproximados => Con(s => s.BytesAproximados);
    public long Filas => Con(s => s.Filas);

    /// <summary>Aparta la base corrupta y abre una nueva. Devuelve la ruta del archivo apartado.</summary>
    public string Reabrir()
    {
        lock (_candado)
        {
            var movido = _spool.Reabrir();
            _corrupto = false;
            return movido;
        }
    }

    public void Dispose() { lock (_candado) _spool.Dispose(); }

    private T Con<T>(Func<SpoolSqlite, T> accion)
    {
        lock (_candado)
        {
            try { return accion(_spool); }
            catch (Exception e) when (SpoolSqlite.EsCorrupcion(e))
            {
                _corrupto = true;
                throw;
            }
        }
    }
}
