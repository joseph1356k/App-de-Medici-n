namespace Medidor.App;

/// <summary>
/// Dónde vive cada cosa del medidor. <c>MEDIDOR_DATA_DIR</c> redirige todo, para correr una
/// instancia de prueba junto a la real.
/// </summary>
internal static class Rutas
{
    private static string Base(string raiz)
    {
        var forzada = Environment.GetEnvironmentVariable("MEDIDOR_DATA_DIR");
        var dir = string.IsNullOrWhiteSpace(forzada) ? Path.Combine(raiz, "Medidor") : forzada!;
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>Config e identidad (%APPDATA%\Medidor): sobrevive a actualizaciones.</summary>
    public static string Config => Base(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));

    /// <summary>Datos locales (%LOCALAPPDATA%\Medidor): spool y logs.</summary>
    public static string Datos => Base(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

    public static string ArchivoDeEstado => Path.Combine(Config, "estado.json");
    public static string ArchivoDeAjustes => Path.Combine(Config, "medidor.json");
    public static string ArchivoDeSecreto => Path.Combine(Config, "secreto.bin");
    public static string ArchivoDelSpool => Path.Combine(Datos, "spool.db");
    public static string CarpetaDeLogs { get { var d = Path.Combine(Datos, "logs"); Directory.CreateDirectory(d); return d; } }

    /// <summary>El latido del vigilante (se escribe al arrancar y cada 5 min): distingue un medidor
    /// vivo de un zombi que tiene el mutex pero no mide.</summary>
    public static string ArchivoDeLatido => Path.Combine(Datos, "latido.txt");

    /// <summary>Los instantes de los últimos relanzos por colapso (la guardia de 5 en 10 min).</summary>
    public static string ArchivoDeRelanzos => Path.Combine(Datos, "relanzos.json");

    /// <summary>La definición de la tarea programada «Medidor-Vigilante» que el .exe escribe y schtasks importa.</summary>
    public static string ArchivoDelVigilanteXml => Path.Combine(Datos, "vigilante.xml");
}
