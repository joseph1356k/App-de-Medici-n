using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Medidor.App;

/// <summary>Lo que el servidor contestó a un lote: qué filas confirmar (aceptadas + duplicadas) y
/// cuáles rechazó como veneno (para sacarlas del spool).</summary>
public sealed record RespuestaDeLote(
    bool Ok, int Codigo,
    IReadOnlyList<(string Coleccion, long Seq)> Confirmar,
    IReadOnlyList<(string Coleccion, long Seq)> Veneno,
    int? ConfigVersion, int? HmacVersion, long? DesfaseMs, int? RetryAfterS);

/// <summary>
/// El caño con la plataforma. Todo SALIENTE, con <c>X-API-Key</c> en cada petición: nunca un puerto
/// entrante en el PC del médico, así funciona tras el firewall del hospital. Timeout corto y
/// errores que NO tumban: si el servidor no contesta, el lote se queda en el spool y se reintenta.
/// Perder la red no puede perder datos.
///
/// Tres rutas: <c>POST /api/medidor/registro</c> (identidad + secreto + config, al arrancar),
/// <c>GET /api/medidor/config</c> (refresco) y <c>POST /api/medidor/lote</c> (cada minuto).
/// </summary>
public sealed class ClienteServidor
{
    private readonly HttpClient _http;
    private readonly string _clave;

    public ClienteServidor(string servidor, string clave, string versionApp)
    {
        _clave = clave;
        _http = new HttpClient { BaseAddress = new Uri(servidor.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(20) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"Medidor/{versionApp}");
    }

    public async Task<JsonDocument?> RegistrarAsync(string? deviceId, string machineName, string osVersion, string appVersion)
    {
        var cuerpo = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["device_id"] = deviceId,
            ["machine_name"] = machineName,
            ["os_version"] = osVersion,
            ["app_version"] = appVersion,
        });
        var (ok, codigo, texto) = await PostAsync("api/medidor/registro", cuerpo);
        if (!ok)
        {
            Registro.Anota("registro", codigo == 0 ? "sin red o servidor caído" : $"rechazado ({codigo})");
            return null;
        }
        return JsonDocument.Parse(texto);
    }

    public async Task<JsonDocument?> ConfigAsync(string deviceId, int configVersion, int hmacVersion)
    {
        var (ok, codigo, texto) = await GetAsync(
            $"api/medidor/config?device_id={Uri.EscapeDataString(deviceId)}&config_version={configVersion}&hmac_version={hmacVersion}");
        if (!ok) { Registro.Anota("config", $"sin config ({codigo})"); return null; }
        return JsonDocument.Parse(texto);
    }

    public async Task<RespuestaDeLote> EnviarLoteAsync(string cuerpo, LoteTomado lote)
    {
        var (ok, codigo, texto) = await PostAsync("api/medidor/lote", cuerpo);
        if (!ok)
            return new RespuestaDeLote(false, codigo, Array.Empty<(string, long)>(), Array.Empty<(string, long)>(),
                null, null, null, RetryAfterDe(codigo));

        // El servidor aceptó el lote entero (200): se confirma todo lo que iba en él, y se envenena
        // lo que rechazó por fila. Solo tras el 200 se toca el spool.
        var confirmar = TodoElLote(lote);
        var veneno = new List<(string, long)>();
        int? cfg = null, hmac = null; long? desfase = null;
        try
        {
            using var doc = JsonDocument.Parse(texto);
            var raiz = doc.RootElement;
            if (raiz.TryGetProperty("rejected", out var rechazadas) && rechazadas.ValueKind == JsonValueKind.Array)
                foreach (var r in rechazadas.EnumerateArray())
                {
                    var col = r.TryGetProperty("col", out var c) ? c.GetString() : null;
                    if (col != null && r.TryGetProperty("seq", out var s) && s.ValueKind == JsonValueKind.Number)
                        veneno.Add((col, s.GetInt64()));
                }
            if (raiz.TryGetProperty("config_version", out var cv) && cv.ValueKind == JsonValueKind.Number) cfg = cv.GetInt32();
            if (raiz.TryGetProperty("hmac_version", out var hv) && hv.ValueKind == JsonValueKind.Number) hmac = hv.GetInt32();
            if (raiz.TryGetProperty("clock_skew_ms", out var cs) && cs.ValueKind == JsonValueKind.Number) desfase = cs.GetInt64();
        }
        catch (Exception e) { Registro.Excepcion("lote", e); }

        var venenoSet = veneno.ToHashSet();
        confirmar = confirmar.Where(c => !venenoSet.Contains(c)).ToList();
        return new RespuestaDeLote(true, codigo, confirmar, veneno, cfg, hmac, desfase, null);
    }

    private static List<(string, long)> TodoElLote(LoteTomado lote) =>
        lote.Turnos.Select(f => ("turnos", f.Seq))
            .Concat(lote.Muestras.Select(f => ("muestras", f.Seq)))
            .Concat(lote.Eventos.Select(f => ("eventos", f.Seq)))
            .Concat(lote.Visitas.Select(f => ("visitas", f.Seq)))
            .ToList();

    private static int? RetryAfterDe(int codigo) => codigo == (int)HttpStatusCode.TooManyRequests ? 60 : null;

    private async Task<(bool Ok, int Codigo, string Texto)> PostAsync(string ruta, string cuerpo)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, ruta)
            { Content = new StringContent(cuerpo, Encoding.UTF8, "application/json") };
            req.Headers.Add("X-API-Key", _clave);
            using var resp = await _http.SendAsync(req);
            var texto = await resp.Content.ReadAsStringAsync();
            return ((int)resp.StatusCode < 300, (int)resp.StatusCode, texto);
        }
        catch (Exception e) { Registro.Anota("http", $"{ruta}: {e.GetType().Name}"); return (false, 0, ""); }
    }

    private async Task<(bool Ok, int Codigo, string Texto)> GetAsync(string ruta)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, ruta);
            req.Headers.Add("X-API-Key", _clave);
            using var resp = await _http.SendAsync(req);
            var texto = await resp.Content.ReadAsStringAsync();
            return ((int)resp.StatusCode < 300, (int)resp.StatusCode, texto);
        }
        catch (Exception e) { Registro.Anota("http", $"{ruta}: {e.GetType().Name}"); return (false, 0, ""); }
    }
}
