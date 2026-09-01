namespace Medidor;

/// <summary>
/// El tiempo de escritura se mide por RÁFAGAS: teclas con huecos de hasta 1,5 s pertenecen a la
/// misma ráfaga (teclear lento sigue siendo teclear), y un hueco mayor la parte (pensar no es
/// teclear). Cada ráfaga vale de su primera a su última tecla más una cola fija — sin la cola,
/// una tecla suelta valdría 0 ms y un formulario lleno a golpes de Tab mediría «cero escritura».
///
/// La entrada son INSTANTES, nunca códigos de tecla: este módulo no tiene forma de saber qué se
/// escribió, y así es como debe seguir (promesa 9).
/// </summary>
public static class Escritura
{
    public const int HuecoMaxMs = 1500;
    public const int ColaDeRafagaMs = 500;

    public static long MsDeRafagas(IReadOnlyList<long> instantes)
    {
        if (instantes.Count == 0) return 0;

        var orden = instantes.OrderBy(t => t).ToArray();
        long total = 0;
        long inicioDeRafaga = orden[0];
        long anterior = orden[0];

        foreach (var t in orden.Skip(1))
        {
            if (t - anterior > HuecoMaxMs)
            {
                total += anterior - inicioDeRafaga + ColaDeRafagaMs;
                inicioDeRafaga = t;
            }
            anterior = t;
        }
        total += anterior - inicioDeRafaga + ColaDeRafagaMs;
        return total;
    }
}
