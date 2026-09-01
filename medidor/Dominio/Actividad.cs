namespace Medidor;

/// <summary>
/// La regla de activo/idle, y es UNA sola: hubo input en los últimos 60 s. El umbral es el mismo
/// que usa el reloj de Notes en el portal (revisando cuenta solo con interacción reciente) —
/// compartirlo no es estética: es lo que hace comparables «tiempo activo» del baseline y de la
/// fase Notes. Cambiarlo aquí sin cambiarlo allá partiría el estudio en dos varas.
/// </summary>
public static class Actividad
{
    public const int UmbralInactividadMs = 60_000;

    public static bool DebeContar(long ahoraMs, long ultimoInputMs)
        => ahoraMs - ultimoInputMs <= UmbralInactividadMs;
}
