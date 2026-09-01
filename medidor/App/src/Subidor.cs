namespace Medidor.App;

/// <summary>
/// EL SUBIDOR: cada minuto arma un lote desde el spool y lo manda. Un latido por minuto por PC
/// (15 PCs = 15 peticiones/min) es nada para el servidor y para el NAT del hospital.
///
/// El orden es aceptar-y-verificar: solo tras un 200 se toca el spool —confirmar lo aceptado,
/// envenenar lo rechazado—; ante cualquier fallo el spool queda intacto y se reintenta al
/// siguiente latido. Un lote vacío se manda igual: es el heartbeat que distingue «medidor vivo,
/// PC quieto» de «medidor muerto» (el panel marca el silencio por dispositivo).
///
/// Corre en un hilo de fondo; el spool compartido lleva su propio candado.
/// </summary>
public sealed class Subidor
{
    private readonly SpoolCompartido _spool;
    private readonly ClienteServidor _cliente;
    private readonly Func<string?> _deviceId;
    private readonly Func<Calidad> _calidad;
    private DateTime _proximoPermitido = DateTime.MinValue;
    private int _descartesVistos;
    private int _corriendo;

    public event Action<int>? ConfigVersionNueva;
    public event Action? DevicePausado;
    public event Action<bool>? Conectado;

    public Subidor(SpoolCompartido spool, ClienteServidor cliente, Func<string?> deviceId, Func<Calidad> calidad)
    {
        _spool = spool; _cliente = cliente; _deviceId = deviceId; _calidad = calidad;
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

        // Los descartes del spool (si el disco se llenó) pasan a la calidad del turno — solo los
        // nuevos desde la última vez, no el acumulado (sumarlo cada minuto contaría el mismo
        // descarte sesenta veces por hora).
        var descartes = _spool.DescartesAcumulados;
        if (descartes > _descartesVistos) { _calidad().Descartes(descartes - _descartesVistos); _descartesVistos = descartes; }

        var lote = _spool.Tomar(new LimitesDeLote());
        var cuerpo = Lote.Serializar(deviceId, Guid.NewGuid().ToString(), DateTimeOffset.UtcNow, lote);

        var resp = await _cliente.EnviarLoteAsync(cuerpo, lote);
        if (!resp.Ok)
        {
            Conectado?.Invoke(false);
            if (resp.Codigo == 403) { DevicePausado?.Invoke(); return; }
            if (resp.RetryAfterS is int s) _proximoPermitido = DateTime.UtcNow.AddSeconds(s);
            return; // el spool intacto: se reintenta
        }
        Conectado?.Invoke(true);

        foreach (var (col, seq) in resp.Veneno)
        {
            _spool.Envenenar(col, seq);
            Registro.Anota("subidor", $"veneno sacado: {col}#{seq}");
        }
        _spool.Confirmar(new LoteTomado(
            FiltrarPorColeccion(lote.Turnos, resp.Confirmar, "turnos"),
            FiltrarPorColeccion(lote.Muestras, resp.Confirmar, "muestras"),
            FiltrarPorColeccion(lote.Eventos, resp.Confirmar, "eventos"),
            FiltrarPorColeccion(lote.Visitas, resp.Confirmar, "visitas")));

        if (!lote.Vacio)
            Registro.Anota("subidor", $"subido: {lote.Turnos.Count} turnos · {lote.Muestras.Count} muestras · {lote.Eventos.Count} eventos · {lote.Visitas.Count} visitas · veneno {resp.Veneno.Count}");

        if (resp.ConfigVersion is int cv) ConfigVersionNueva?.Invoke(cv);
    }

    private static IReadOnlyList<FilaDelSpool> FiltrarPorColeccion(
        IReadOnlyList<FilaDelSpool> filas, IReadOnlyList<(string Coleccion, long Seq)> confirmar, string coleccion)
    {
        var seqs = confirmar.Where(c => c.Coleccion == coleccion).Select(c => c.Seq).ToHashSet();
        return filas.Where(f => seqs.Contains(f.Seq)).ToList();
    }
}

/// <summary>El spool con candado: el hilo de la ventana encola y el hilo del subidor toma y
/// confirma. SQLite no admite dos hilos sobre la misma conexión sin serializarlos.</summary>
public sealed class SpoolCompartido : IDisposable
{
    private readonly SpoolSqlite _spool;
    private readonly object _candado = new();

    public SpoolCompartido(SpoolSqlite spool) => _spool = spool;

    public long Encolar(string coleccion, string json) { lock (_candado) return _spool.Encolar(coleccion, json); }
    public LoteTomado Tomar(LimitesDeLote limites) { lock (_candado) return _spool.Tomar(limites); }
    public void Confirmar(LoteTomado lote) { lock (_candado) _spool.Confirmar(lote); }
    public void Envenenar(string coleccion, long seq) { lock (_candado) _spool.Envenenar(coleccion, seq); }
    public int DescartesAcumulados { get { lock (_candado) return _spool.DescartesAcumulados; } }
    public long BytesAproximados { get { lock (_candado) return _spool.BytesAproximados; } }
    public void Dispose() { lock (_candado) _spool.Dispose(); }
}
