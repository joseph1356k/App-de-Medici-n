namespace Medidor;

/// <summary>Lo que la App vio en primer plano, tal cual. El título viene porque Windows lo da —
/// y este módulo existe para que NO salga de aquí.</summary>
public sealed record EntradaDeSuperficie(string Proceso, string? Titulo, string? UrlNavegador, string? IdentidadSap);

public sealed record ConfigDeNormalizacion(
    IReadOnlyDictionary<string, string> AppsPorProceso,
    IReadOnlySet<string> DominiosPermitidos,
    IReadOnlySet<string> DominiosMiracle);

/// <summary>La forma en que una superficie viaja: una clave de app de lista blanca y, si la hay,
/// una superficie normalizada. Nunca un título.</summary>
public sealed record Superficie(string App, string? Surface);

/// <summary>
/// LA ADUANA DE PRIVACIDAD del medidor: todo lo que se observa pasa por aquí antes de tocar una
/// cubeta, y de aquí solo salen claves de lista blanca. El título de la ventana entra como
/// parámetro y se ignora a propósito — está en la firma para que quede escrito que se decidió no
/// usarlo, no que se olvidó (en urgencias un título lleva nombre y documento).
///
/// Normaliza en UN solo sitio (aprendizaje nº16: `AppDe` conserva el .exe, `ProcessFromOrigin` lo
/// quita, y quien las junta hereda el desacuerdo): aquí el proceso siempre queda en minúscula y
/// con su .exe.
/// </summary>
public static class Normalizador
{
    public const string AppOtro = "otro";
    public const string AppSap = "sap";
    public const string AppMiracle = "miracle_web";

    public static Superficie Normalizar(EntradaDeSuperficie entrada, ConfigDeNormalizacion cfg)
    {
        // Vacío no es ausente (aprendizaje nº14): una identidad SAP en blanco no es SAP.
        if (!string.IsNullOrWhiteSpace(entrada.IdentidadSap))
            return new Superficie(AppSap, SinVista(entrada.IdentidadSap));

        var app = cfg.AppsPorProceso.TryGetValue(ClaveDeProceso(entrada.Proceso), out var conocida)
            ? conocida
            : AppOtro;

        if (!string.IsNullOrWhiteSpace(entrada.UrlNavegador))
        {
            var dominio = DominioDe(entrada.UrlNavegador);
            if (dominio != null && cfg.DominiosMiracle.Contains(dominio))
                return new Superficie(AppMiracle, "web://" + dominio);
            if (dominio != null && cfg.DominiosPermitidos.Contains(dominio))
                return new Superficie(app, "web://" + dominio);
        }

        return new Superficie(app, null);
    }

    /// <summary>El sufijo `vista:` de la identidad SAP es texto libre del árbol de navegación
    /// (nombres de vistas — y lo que el árbol quiera poner). Se corta SIEMPRE antes de viajar.
    /// El subdynpro no es vista: y se conserva: sin él dos pantallas distintas parecen la misma
    /// (el salto-adelante que se comió 19 pasos).</summary>
    public static string SinVista(string identidadSap)
    {
        var i = identidadSap.IndexOf("/vista:", StringComparison.OrdinalIgnoreCase);
        return i < 0 ? identidadSap : identidadSap[..i];
    }

    public static string? DominioDe(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return null;
        var host = uri.Host.ToLowerInvariant();
        if (host.StartsWith("www.", StringComparison.Ordinal)) host = host[4..];
        return string.IsNullOrWhiteSpace(host) ? null : host;
    }

    /// <summary>De `sapgui://SID/TCODE/PROGRAMA/DYNPRO[/sub…]` saca lo que las visitas necesitan.
    /// Una superficie que no tenga las cuatro partes no es una identidad SAP completa.</summary>
    public static (string Sid, string Tcode, string Dynpro)? PartesSap(string surface)
    {
        const string esquema = "sapgui://";
        if (!surface.StartsWith(esquema, StringComparison.OrdinalIgnoreCase)) return null;
        var partes = surface[esquema.Length..].Split('/');
        if (partes.Length < 4) return null;
        if (partes.Take(4).Any(string.IsNullOrWhiteSpace)) return null;
        return (partes[0], partes[1], partes[3]);
    }

    private static string ClaveDeProceso(string proceso)
    {
        var p = (proceso ?? "").Trim().ToLowerInvariant();
        if (p.Length == 0) return p;
        return p.EndsWith(".exe", StringComparison.Ordinal) ? p : p + ".exe";
    }
}
