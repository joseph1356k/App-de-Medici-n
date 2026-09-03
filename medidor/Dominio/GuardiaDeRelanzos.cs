namespace Medidor;

/// <summary>
/// CUÁNTAS VECES SE RELANZA un medidor que colapsa. Un bug determinista al arrancar produciría un
/// bucle de relanzos por segundo (CPU, log lleno, cientos de medidor_start): la guardia deja pasar
/// 5 en 10 minutos y el sexto se lo deja al vigilante, que reintenta cada 5 min con calma. El
/// historial vive en relanzos.json porque tiene que sobrevivir al proceso que muere (promesa 26).
/// </summary>
public static class GuardiaDeRelanzos
{
    public const int VentanaMinutos = 10;
    public const int Maximo = 5;

    /// <summary>Conserva del historial solo los últimos 10 min. Con 5 o más devuelve (false, historial);
    /// si no, añade <paramref name="ahora"/> y devuelve (true, historial).</summary>
    public static (bool Relanzar, IReadOnlyList<DateTimeOffset> Historial) Evaluar(IReadOnlyList<DateTimeOffset> historial, DateTimeOffset ahora)
    {
        var desde = ahora.AddMinutes(-VentanaMinutos);
        var recientes = historial.Where(t => t > desde).OrderBy(t => t).ToList();
        if (recientes.Count >= Maximo) return (false, recientes);
        recientes.Add(ahora);
        return (true, recientes);
    }
}
