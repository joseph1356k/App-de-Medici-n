namespace Medidor;

/// <summary>Lo que un tick del reloj aporta a la medición: los ms que de verdad pasaron (acotados),
/// el hueco que quedó sin ver, y el desfase si el reloj de pared saltó por su cuenta.</summary>
public sealed record Tic(int AporteMs, long HuecoMs, long DesfaseRelojMs);

/// <summary>
/// EL RELOJ DEL MEDIDOR: las duraciones salen SIEMPRE del monotónico; la pared solo ancla las
/// cubetas al calendario. Herencia directa del reloj del portal (`encounter-usage.ts`,
/// MAX_TICK_MS=2000): mismo umbral a propósito, para que las fases del estudio midan con la misma
/// vara.
///
/// EL FALLO QUE ESTO IMPIDE: el PC se suspende a las 14:00 y despierta a las 17:00 — un reloj
/// ingenuo suma tres horas de «trabajo». Aquí el tick aporta como mucho 2 s, el resto queda
/// contado como hueco (la calidad del turno lo hereda), y si la pared se mueve sin que el
/// monotónico se mueva —alguien ajustó la hora— el desfase se dice en vez de tragarse.
/// </summary>
public sealed class Reloj
{
    public const int AporteMaxMs = 2000;
    public const int HuecoDesdeMs = 10_000;
    public const int DesfaseDesdeMs = 30_000;

    private long _monotonico;
    private DateTimeOffset _pared;

    public Reloj(long monotonicoMs, DateTimeOffset paredUtc)
    {
        _monotonico = monotonicoMs;
        _pared = paredUtc;
    }

    public Tic Avanzar(long monotonicoMs, DateTimeOffset paredUtc)
    {
        var deltaMono = Math.Max(0, monotonicoMs - _monotonico);
        var deltaPared = (long)(paredUtc - _pared).TotalMilliseconds;
        _monotonico = monotonicoMs;
        _pared = paredUtc;

        var aporte = (int)Math.Min(deltaMono, AporteMaxMs);
        var hueco = deltaMono > HuecoDesdeMs ? deltaMono - aporte : 0;
        var desvio = deltaPared - deltaMono;
        var desfase = Math.Abs(desvio) >= DesfaseDesdeMs ? desvio : 0;

        return new Tic(aporte, hueco, desfase);
    }
}
