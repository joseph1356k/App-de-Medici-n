namespace Medidor;

/// <summary>Un segmento de estadía en una pantalla SAP: cuánto duró, cuánto de eso fue esperar a
/// SAP, cuándo estuvo lista, y a dónde se fue el médico después. La cadena de visitas ES el
/// journey del HIS.</summary>
public sealed record Visita(string Surface, string Sid, string Tcode, string Dynpro,
    DateTimeOffset EnteredAt, DateTimeOffset LeftAt, long DwellMs, long? ReadyMs, long EsperaMs, int Roundtrips, string? ExitTo);

/// <summary>
/// Aparea `StartRequest`/`EndRequest` (los eventos COM 514/515, la latencia real de SAP sin
/// sondear nada). Un EndRequest sin StartRequest no suma ni resta — llega cuando el medidor se
/// enganchó a mitad de un round-trip, y castigar o premiar por él sería inventar una medida.
/// Sí vale para el ready: un fin desocupado es un fin desocupado, venga apareado o no.
/// </summary>
public sealed class EsperaSap
{
    private long? _inicioPendiente;

    public long EsperaMs { get; private set; }
    public int Roundtrips { get; private set; }
    public long? PrimerFinSinBusyMs { get; private set; }

    public void Start(long monotonicoMs) => _inicioPendiente = monotonicoMs;

    public void End(long monotonicoMs, bool busyDespues)
    {
        if (_inicioPendiente is long inicio && monotonicoMs >= inicio)
        {
            EsperaMs += monotonicoMs - inicio;
            Roundtrips++;
            _inicioPendiente = null;
        }
        if (!busyDespues && PrimerFinSinBusyMs == null)
            PrimerFinSinBusyMs = monotonicoMs;
    }
}

/// <summary>
/// EL VIAJE POR SAP: convierte el stream de identidades (lo que el localizador ve) y los eventos
/// de round-trip en VISITAS. La duración y el destino salen del stream, no de un cronómetro
/// aparte — dos relojes sobre el mismo hecho serían dos opiniones (la lección del Pulso).
///
/// El time-to-ready va de la llegada al primer `EndRequest` sin `Busy`. Si nunca llega, queda
/// NULO: un cero diría «estuvo lista al instante», que es mentira — una caja que miente es peor
/// que no tener caja (aprendizaje nº4).
/// </summary>
public sealed class Viaje
{
    private string? _surface;
    private string _sid = "", _tcode = "", _dynpro = "";
    private long _entradaMono;
    private DateTimeOffset _entradaPared;
    private EsperaSap _espera = new();

    /// <summary>Al cambiar la identidad SAP de primer plano. Devuelve la visita que se CERRÓ (o
    /// null si no había, o si la identidad es la misma — releer no es navegar). Una superficie
    /// null significa «ya no estamos en SAP».</summary>
    public Visita? AlCambiarSuperficie(long monotonicoMs, DateTimeOffset pared, string? sapSurface)
    {
        var limpia = string.IsNullOrWhiteSpace(sapSurface) ? null : Normalizador.SinVista(sapSurface!);
        if (limpia != null && Normalizador.PartesSap(limpia) == null)
            limpia = null; // una identidad incompleta no abre visita: mejor sin visita que una visita quimera

        if (limpia == _surface) return null;

        var cerrada = Cerrar(monotonicoMs, pared, exitTo: limpia);

        if (limpia != null)
        {
            var partes = Normalizador.PartesSap(limpia)!.Value;
            _surface = limpia;
            (_sid, _tcode, _dynpro) = partes;
            _entradaMono = monotonicoMs;
            _entradaPared = pared;
            _espera = new EsperaSap();
        }
        return cerrada;
    }

    public void AlStartRequest(long monotonicoMs)
    {
        if (_surface != null) _espera.Start(monotonicoMs);
    }

    public void AlEndRequest(long monotonicoMs, bool busyDespues)
    {
        if (_surface != null) _espera.End(monotonicoMs, busyDespues);
    }

    /// <summary>Cierra la visita en curso sin abrir otra (salir de SAP, cerrar el turno, apagar).</summary>
    public Visita? CerrarPendiente(long monotonicoMs, DateTimeOffset pared)
        => Cerrar(monotonicoMs, pared, exitTo: null);

    private Visita? Cerrar(long monotonicoMs, DateTimeOffset pared, string? exitTo)
    {
        if (_surface == null) return null;

        var visita = new Visita(
            _surface, _sid, _tcode, _dynpro,
            _entradaPared, pared,
            DwellMs: Math.Max(0, monotonicoMs - _entradaMono),
            ReadyMs: _espera.PrimerFinSinBusyMs is long listo ? Math.Max(0, listo - _entradaMono) : null,
            EsperaMs: _espera.EsperaMs,
            Roundtrips: _espera.Roundtrips,
            ExitTo: exitTo);

        _surface = null;
        return visita;
    }
}
