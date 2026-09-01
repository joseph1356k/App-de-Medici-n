using System.Text.Json;
using System.Text.Json.Serialization;

namespace Medidor.App;

/// <summary>
/// LO ÚNICO QUE HAY QUE CONFIGURAR EN EL PC: a qué servidor hablar y con qué clave. Vive en
/// <c>medidor.json</c>, primero en %APPDATA%\Medidor (lo escribe instalar.ps1) y si no, al lado
/// del .exe. Las variables de entorno MEDIDOR_SERVIDOR / MEDIDOR_CLAVE pisan al archivo.
///
/// La CONFIG DE MEDICIÓN (qué procesos son qué app, reglas de extracción, cadencias) NO se
/// configura en el PC: llega del servidor al registrarse y se refresca sola. Cambiar una regla
/// para todo el hospital es editarla en el panel, sin tocar ningún PC.
/// </summary>
public sealed class Ajustes
{
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
        return a;
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

/// <summary>La identidad de esta instalación: lo que el registro devolvió. El secreto HMAC NO vive
/// aquí — vive cifrado aparte (DPAPI), y nunca se serializa junto al resto.</summary>
public sealed class Identidad
{
    [JsonPropertyName("device_id")] public string DeviceId { get; set; } = "";
    [JsonPropertyName("hospital")] public string Hospital { get; set; } = "";
    [JsonPropertyName("hmac_version")] public int HmacVersion { get; set; }
    [JsonPropertyName("config_version")] public int ConfigVersion { get; set; }
}
