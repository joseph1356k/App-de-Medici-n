namespace Medidor.App;

/// <summary>
/// El log del medidor: <c>%LOCALAPPDATA%\Medidor\logs\medidor-AAAAMMDD.log</c>. Es la fuente de
/// verdad para diagnosticar — pero con una restricción que un log normal no tiene: aquí no entra
/// NUNCA un título de ventana, un identificador de paciente ni un valor de campo. Solo etiquetas,
/// conteos y estados. El medidor promete no sacar contenido clínico del PC, y un log que lo
/// guardara sería sacarlo a medias.
/// </summary>
internal static class Registro
{
    private static readonly object Candado = new();
    private static bool _discoRoto;

    public static void Anota(string etiqueta, string mensaje)
    {
        if (_discoRoto) return;
        var linea = $"[{DateTime.Now:HH:mm:ss}] {etiqueta}: {mensaje}";
        try
        {
            lock (Candado)
                File.AppendAllText(
                    Path.Combine(Rutas.CarpetaDeLogs, $"medidor-{DateTime.Now:yyyyMMdd}.log"),
                    linea + Environment.NewLine);
        }
        catch
        {
            // Si el disco falla una vez, el archivo se apaga y el medidor sigue: un log no puede
            // tumbar al instrumento.
            _discoRoto = true;
        }
    }

    public static void Excepcion(string etiqueta, Exception e)
    {
        // La cadena ENTERA: un catch que se traga el motivo convierte cualquier bug en «no existe».
        for (var x = e; x != null; x = x.InnerException)
            Anota(etiqueta, $"✘ {x.GetType().Name}: {x.Message}");
    }

    /// <summary>Borra los logs de más de <paramref name="dias"/> días: el medidor vive meses en un
    /// PC compartido y no puede llenarlo.</summary>
    public static void Podar(int dias)
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(Rutas.CarpetaDeLogs, "medidor-*.log"))
                if (File.GetLastWriteTime(f) < DateTime.Now.AddDays(-dias)) File.Delete(f);
        }
        catch { /* podar es cortesía, no promesa */ }
    }
}
