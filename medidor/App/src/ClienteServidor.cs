using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Medidor.App;

/// <summary>El consultorio que el panel le asignó a este PC (Dispositivos). El PC no elige nada.</summary>
public sealed record ConsultorioDelServidor(string Id, string Nombre);

/// <summary>Lo que el servidor contestó a un lote (contrato 2): qué confirmar (todo lo enviado menos
/// rechazadas menos no procesadas), qué envenenar (rechazadas: se sacan del spool) y qué se queda
/// para el siguiente lote (no procesadas: el servidor no llegó a mirarlas). <c>TraeConsultorio</c>
/// distingue «no vino la clave» (conservar) de «vino null» (desasignado).</summary>
public sealed record RespuestaDeLote(
    bool Ok, int Codigo,
    LoteTomado Confirmar,
    IReadOnlyList<(string Coleccion, long Seq)> Veneno,
    IReadOnlyList<(string Coleccion, long Seq)> NoProcesadas,
    int? ConfigVersion, int? HmacVersion, long? DesfaseMs, int? RetryAfterS,
    bool TraeConsultorio, ConsultorioDelServidor? Consultorio,
    bool IdentidadDesconocida = false);

/// <summary>
/// El caño con la plataforma. Todo SALIENTE, con <c>X-API-Key</c> en cada petición: nunca un puerto
/// entrante en el PC del consultorio, así funciona tras el firewall del hospital. Timeout corto y
/// errores que NO tumban: si el servidor no contesta, el lote se queda en el spool y se reintenta.
/// Perder la red no puede perder datos.
///
/// Tres rutas: <c>POST /api/medidor/registro</c> (identidad + secreto + config + consultorio, al
/// arrancar), <c>GET /api/medidor/config</c> (refresco) y <c>POST /api/medidor/lote</c> (cada minuto;
/// su respuesta también trae el consultorio, así una asignación se ve en ≤ 2 min).
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
        {
            // Un 403 sin `status` es «este device_id ya no existe»: hay que registrarse otra vez.
            // Uno con `status` es una pausa deliberada desde el panel y se respeta.
            var desconocida = codigo == 403 && Cable.IdentidadDesconocida(texto);
            return new RespuestaDeLote(false, codigo, LoteTomado.Nada, Array.Empty<(string, long)>(), Array.Empty<(string, long)>(),
                null, null, null, RetryAfterDe(codigo), false, null, desconocida);
        }

        // El servidor aceptó el lote (200): se confirma lo enviado menos lo rechazado (veneno) y
        // menos lo no procesado (se reenvía). Solo tras el 200 se toca el spool.
        var veneno = new List<(string, long)>();
        var noProcesadas = new List<(string, long)>();
        int? cfg = null, hmac = null; long? desfase = null;
        bool traeConsultorio = false; ConsultorioDelServidor? consultorio = null;
        try
        {
            using var doc = JsonDocument.Parse(texto);
            var raiz = doc.RootElement;
            LeerFilas(raiz, "rechazadas", "coleccion", "spool_seq", veneno);
            LeerFilas(raiz, "rejected", "col", "seq", veneno); // espejo v1 de transición: mismos rechazos, nombres viejos
            LeerFilas(raiz, "no_procesadas", "coleccion", "spool_seq", noProcesadas);
            if (raiz.TryGetProperty("config_version", out var cv) && cv.ValueKind == JsonValueKind.Number) cfg = cv.GetInt32();
            if (raiz.TryGetProperty("hmac_version", out var hv) && hv.ValueKind == JsonValueKind.Number) hmac = hv.GetInt32();
            if (raiz.TryGetProperty("clock_skew_ms", out var cs) && cs.ValueKind == JsonValueKind.Number) desfase = cs.GetInt64();
            if (raiz.TryGetProperty("consultorio", out var c))
            {
                if (c.ValueKind == JsonValueKind.Null) traeConsultorio = true;
                else if (LeerConsultorio(c) is ConsultorioDelServidor leido) { traeConsultorio = true; consultorio = leido; }
            }
        }
        catch (Exception e) { Registro.Excepcion("lote", e); }

        var venenoUnico = veneno.Distinct().ToList();
        var noProcesadasUnicas = noProcesadas.Distinct().ToList();
        var confirmar = Lote.Confirmables(lote, noProcesadasUnicas, venenoUnico);
        return new RespuestaDeLote(true, codigo, confirmar, venenoUnico, noProcesadasUnicas, cfg, hmac, desfase, null, traeConsultorio, consultorio);
    }

    /// <summary>Un objeto <c>{id, nombre}</c> completo, o null si no lo es (un objeto a medias no
    /// borra una asignación válida).</summary>
    public static ConsultorioDelServidor? LeerConsultorio(JsonElement c)
    {
        if (c.ValueKind != JsonValueKind.Object) return null;
        var id = c.TryGetProperty("id", out var i) && i.ValueKind == JsonValueKind.String ? i.GetString() : null;
        var nombre = c.TryGetProperty("nombre", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(nombre)) return null;
        return new ConsultorioDelServidor(id, nombre);
    }

    /// <summary>Las filas señaladas pasan por <see cref="Cable.ColeccionDelSpool"/>: el servidor v2
    /// ya habla con los nombres del spool y el espejo v1 con los del cable; un nombre desconocido o
    /// un seq nulo se ignoran (no señalan nada que exista).</summary>
    private static void LeerFilas(JsonElement raiz, string propiedad, string claveColeccion, string claveSeq, List<(string, long)> destino)
    {
        if (!raiz.TryGetProperty(propiedad, out var lista) || lista.ValueKind != JsonValueKind.Array) return;
        foreach (var r in lista.EnumerateArray())
        {
            if (r.ValueKind != JsonValueKind.Object) continue;
            var col = r.TryGetProperty(claveColeccion, out var c) && c.ValueKind == JsonValueKind.String
                ? Cable.ColeccionDelSpool(c.GetString()) : null;
            if (col == null || !r.TryGetProperty(claveSeq, out var s) || s.ValueKind != JsonValueKind.Number) continue;
            destino.Add((col, s.GetInt64()));
        }
    }

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
