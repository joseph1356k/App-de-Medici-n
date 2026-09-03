using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Medidor.App;

/// <summary>
/// A QUÉ SERVIDOR HABLA EL MEDIDOR Y CON QUÉ CLAVE. Por orden de prioridad:
///   1. <c>medidor.json</c> — en %APPDATA%\Medidor (lo escribe instalar.ps1) o junto al .exe.
///      Es la vía para apuntar un PC a OTRO servidor sin recompilar nada.
///   2. las variables de entorno MEDIDOR_SERVIDOR / MEDIDOR_CLAVE.
///   3. lo horneado al compilar: el servidor (una URL pública, aquí abajo) y la clave, que el CI
///      inyecta desde un secreto y NUNCA está en el repo (ver App.csproj).
///
/// El punto 3 es lo que hace que el .exe descargado funcione con un doble clic. Sin él, instalar
/// en seis PCs de un hospital obligaba a teclear una clave de cuarenta caracteres en cada uno, y
/// en el piloto del HGM eso se cayó tres veces seguidas antes de existir.
///
/// La CONFIG DE MEDICIÓN (qué procesos son qué app, reglas de extracción, cadencias) NO se
/// configura en el PC: llega del servidor al registrarse y se refresca sola. Cambiar una regla
/// para todo el hospital es editarla en el panel, sin tocar ningún PC.
/// </summary>
public sealed class Ajustes
{
    /// <summary>El servidor de esta instalación. No es un secreto —es una web pública— así que
    /// vive aquí y no en un secreto del CI: hornearlo evita un paso manual por PC.</summary>
    private const string ServidorPorDefecto = "https://medicion.vercel.app";

    [JsonPropertyName("servidor")] public string? Servidor { get; set; }
    [JsonPropertyName("clave")] public string? Clave { get; set; }

    public bool Completos => !string.IsNullOrWhiteSpace(Servidor) && !string.IsNullOrWhiteSpace(Clave)
                             && Uri.TryCreate(Servidor, UriKind.Absolute, out _);

    public static Ajustes Cargar()
    {
        var a = new Ajustes();
        foreach (var ruta in new[] { Rutas.ArchivoDeAjustes, Path.Combine(AppContext.BaseDirectory, "medidor.json") })
        {
            try
            {
                if (!File.Exists(ruta)) continue;
                var disco = JsonSerializer.Deserialize<Ajustes>(File.ReadAllText(ruta));
                if (disco != null) { a = disco; Registro.Anota("ajustes", $"leídos de {ruta}"); break; }
            }
            catch (Exception e) { Registro.Excepcion("ajustes", e); }
        }
        var envServidor = Environment.GetEnvironmentVariable("MEDIDOR_SERVIDOR");
        var envClave = Environment.GetEnvironmentVariable("MEDIDOR_CLAVE");
        if (!string.IsNullOrWhiteSpace(envServidor)) a.Servidor = envServidor;
        if (!string.IsNullOrWhiteSpace(envClave)) a.Clave = envClave;

        // Lo horneado va al final: solo rellena lo que nadie más dijo.
        if (string.IsNullOrWhiteSpace(a.Servidor)) a.Servidor = ServidorPorDefecto;
        if (string.IsNullOrWhiteSpace(a.Clave)) a.Clave = ClaveHorneada();
        return a;
    }

    /// <summary>La clave que el CI metió en este build, o vacía si se compiló sin ella (lo que
    /// pasa en cualquier clon del repo: ahí no hay ninguna credencial que encontrar).</summary>
    private static string? ClaveHorneada()
    {
        var v = typeof(Ajustes).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(m => m.Key == "MedidorClavePorDefecto")?.Value?.Trim();
        return string.IsNullOrWhiteSpace(v) ? null : v;
    }
}

/// <summary>La config de medición que llega del servidor. Versionada: el cliente solo pide lo nuevo
/// si su versión quedó vieja.</summary>
public sealed class ConfigDeMedicion
{
    [JsonPropertyName("config_version")] public int Version { get; set; }
    [JsonPropertyName("apps_por_proceso")] public Dictionary<string, string> AppsPorProceso { get; set; } = new();
    [JsonPropertyName("dominios_permitidos")] public List<string> DominiosPermitidos { get; set; } = new();
    [JsonPropertyName("dominios_miracle")] public List<string> DominiosMiracle { get; set; } = new();
    [JsonPropertyName("reglas_identidad")] public List<ReglaCruda> ReglasIdentidad { get; set; } = new();
    [JsonPropertyName("foreground_ms")] public int ForegroundMs { get; set; } = 1000;
    [JsonPropertyName("sap_identity_ms")] public int SapIdentityMs { get; set; } = 1500;
    [JsonPropertyName("solo_foreground")] public bool SoloForeground { get; set; }

    /// <summary>Lo que se usa si el servidor todavía no mandó nada: SAP y los navegadores
    /// habituales. Sin esto, un PC recién instalado y sin red mediría todo como «otro».</summary>
    public static ConfigDeMedicion PorDefecto() => new()
    {
        Version = 0,
        AppsPorProceso = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["saplogon.exe"] = "sap", ["sapgui.exe"] = "sap", ["saplgpad.exe"] = "sap",
            ["chrome.exe"] = "chrome", ["msedge.exe"] = "edge", ["firefox.exe"] = "firefox",
            ["winword.exe"] = "office", ["excel.exe"] = "office", ["outlook.exe"] = "office",
            ["explorer.exe"] = "explorador", ["u.exe"] = "uexe",
        },
        ReglasIdentidad = new List<ReglaCruda>
        {
            new() { Id = "titulo-patnr", Tcode = "*", Fuente = "titulo_sap",
                    Patron = @"(?:PATNR|[Pp]aciente|[Nn]HC)\D*0*([0-9]{5,10})", Normalizar = "digitos_sin_ceros" },
        },
    };

    public ConfigDeNormalizacion ParaNormalizar() => _normalizacion ??= new(
        new Dictionary<string, string>(AppsPorProceso, StringComparer.OrdinalIgnoreCase),
        new HashSet<string>(DominiosPermitidos, StringComparer.OrdinalIgnoreCase),
        new HashSet<string>(DominiosMiracle, StringComparer.OrdinalIgnoreCase));
    private ConfigDeNormalizacion? _normalizacion;

    public List<ReglaDeIdentidad> Reglas() => _reglas ??= ReglasIdentidad
        .Select(r => new ReglaDeIdentidad(r.Id, r.Tcode, r.Fuente, r.Selector, r.Patron, r.Normalizar))
        .ToList();
    private List<ReglaDeIdentidad>? _reglas;

    public bool EsProcesoSap(string proceso)
    {
        var p = proceso.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? proceso : proceso + ".exe";
        return AppsPorProceso.TryGetValue(p, out var app) && app == Normalizador.AppSap;
    }

    public sealed class ReglaCruda
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("tcode")] public string Tcode { get; set; } = "*";
        [JsonPropertyName("fuente")] public string Fuente { get; set; } = "titulo_sap";
        [JsonPropertyName("selector")] public string? Selector { get; set; }
        [JsonPropertyName("patron")] public string Patron { get; set; } = "";
        [JsonPropertyName("normalizar")] public string Normalizar { get; set; } = "digitos_sin_ceros";
    }
}

/// <summary>La identidad de esta instalación: lo que el registro devolvió, más el consultorio que el
/// panel le asignó a este PC (llega en el registro y en la respuesta de cada lote; el PC no elige
/// nada). El secreto HMAC NO vive aquí — vive cifrado aparte (DPAPI), y nunca se serializa junto al
/// resto. Los estado.json de la v1 (con «Roster») siguen cargando: lo que sobra se ignora.</summary>
public sealed class Identidad
{
    [JsonPropertyName("device_id")] public string DeviceId { get; set; } = "";
    [JsonPropertyName("hospital")] public string Hospital { get; set; } = "";
    [JsonPropertyName("hmac_version")] public int HmacVersion { get; set; }
    [JsonPropertyName("config_version")] public int ConfigVersion { get; set; }
    [JsonPropertyName("consultorio_id")] public string? ConsultorioId { get; set; }
    [JsonPropertyName("consultorio_nombre")] public string? ConsultorioNombre { get; set; }
}
