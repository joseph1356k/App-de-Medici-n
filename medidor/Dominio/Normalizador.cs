namespace Medidor;

/// <summary>Lo que la App vio en primer plano, tal cual. El título viene porque Windows lo da —
/// y este módulo existe para que NO salga de aquí.</summary>
public sealed record EntradaDeSuperficie(string Proceso, string? Titulo, string? UrlNavegador, string? IdentidadSap);

public sealed record ConfigDeNormalizacion(
    IReadOnlyDictionary<string, string> AppsPorProceso,
    IReadOnlySet<string> DominiosPermitidos,
    IReadOnlySet<string> DominiosMiracle);

/// <summary>La forma en que una superficie viaja: una clave de app (la del catálogo, o el nombre
/// del ejecutable saneado si no está en él) y, si la hay, una superficie normalizada. Nunca un
/// título.</summary>
public sealed record Superficie(string App, string? Surface);

/// <summary>
/// LA ADUANA DE PRIVACIDAD del medidor: todo lo que se observa pasa por aquí antes de tocar una
/// cubeta. De aquí salen dos cosas y ninguna más: claves del catálogo de apps, y el NOMBRE del
/// ejecutable de un programa que el catálogo no conozca (`acrord32`), saneado a [a-z0-9_]. El
/// título de la ventana entra como parámetro y se ignora a propósito — está en la firma para que
/// quede escrito que se decidió no usarlo, no que se olvidó (en urgencias un título lleva nombre
/// y documento).
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
            : AppDeProcesoDesconocido(entrada.Proceso);

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

    /// <summary>
    /// EL NOMBRE DE UN PROCESO QUE NO ESTÁ EN EL CATÁLOGO: `AcroRd32.exe` → `acrord32`.
    ///
    /// Antes todo lo desconocido caía en «otro», un saco gris del que no se podía salir: en un día
    /// del HGM «otro» llegó a 195 minutos de tiempo activo —más que SAP en ese consultorio— sin
    /// que nadie pudiera decir qué aplicación era. Medir un tercio de la jornada y no saber a qué
    /// llamarlo no es medir.
    ///
    /// Lo que viaja es SOLO el nombre del ejecutable, en minúsculas, sin la extensión, sin ruta,
    /// sin argumentos y sin título — y saneado carácter a carácter a [a-z0-9_], que es la misma
    /// forma que tiene una clave del catálogo. Un ejecutable con un nombre raro no puede colar
    /// texto libre por aquí: lo que no sea letra o dígito no pasa.
    ///
    /// El nombre de un programa no es un dato clínico. La aduana sigue en pie para lo que sí lo
    /// es: el título de la ventana, el contenido de los campos y las teclas no salen nunca del PC.
    /// </summary>
    public static string AppDeProcesoDesconocido(string proceso)
    {
        var p = ClaveDeProceso(proceso);
        if (p.Length <= 4) return AppOtro;              // "" o solo ".exe"
        var sb = new System.Text.StringBuilder(32);
        foreach (var c in p[..^4])
        {
            if (c is (>= 'a' and <= 'z') or (>= '0' and <= '9')) sb.Append(c);
            else if (c is '_' or '-' or '.' or '+' or ' ') { if (sb.Length > 0 && sb[^1] != '_') sb.Append('_'); }
            if (sb.Length == 32) break;
        }
        var clave = sb.ToString().Trim('_');
        return clave.Length == 0 ? AppOtro : clave;
    }

    private static string ClaveDeProceso(string proceso)
    {
        var p = (proceso ?? "").Trim().ToLowerInvariant();
        if (p.Length == 0) return p;
        return p.EndsWith(".exe", StringComparison.Ordinal) ? p : p + ".exe";
    }
}
