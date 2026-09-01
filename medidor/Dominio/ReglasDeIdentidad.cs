using System.Text.RegularExpressions;

namespace Medidor;

/// <summary>Una regla de extracción del identificador de paciente, definida por org en la config
/// remota. `Fuente` es «campo» (leer UN campo SAP por selector) o «titulo_sap» (regex sobre el
/// título de la ventana SAP). El patrón conserva SOLO su primer grupo de captura.</summary>
public sealed record ReglaDeIdentidad(string Id, string Tcode, string Fuente, string? Selector, string Patron, string Normalizar);

/// <summary>
/// Evalúa las reglas en orden y devuelve el identificador NORMALIZADO de la primera que aplica.
/// Es puro: leer el campo real lo hace la App (LectorSap) a través del callback; aquí solo se
/// decide QUÉ leer y qué parte conservar. El que llama debe pasar el resultado por
/// <see cref="Huella.DeIdentificador"/> de inmediato y soltar el crudo.
/// </summary>
public static class ReglasDeIdentidad
{
    private static readonly TimeSpan TopeDeRegex = TimeSpan.FromMilliseconds(100);

    public static (string ReglaId, string IdNormalizado)? Extraer(
        IReadOnlyList<ReglaDeIdentidad> reglas, string tcode,
        Func<string, string?> leerCampo, string? tituloSap)
    {
        foreach (var regla in reglas)
        {
            if (regla.Tcode != "*" && !string.Equals(regla.Tcode, tcode, StringComparison.OrdinalIgnoreCase))
                continue;

            string? crudo = regla.Fuente switch
            {
                "campo" when !string.IsNullOrWhiteSpace(regla.Selector) => leerCampo(regla.Selector!),
                "titulo_sap" => tituloSap,
                _ => null,
            };
            if (string.IsNullOrWhiteSpace(crudo)) continue;

            string? extraido;
            try
            {
                var m = Regex.Match(crudo, regla.Patron, RegexOptions.None, TopeDeRegex);
                if (!m.Success) continue;
                extraido = m.Groups.Count > 1 && m.Groups[1].Success ? m.Groups[1].Value : m.Value;
            }
            catch (RegexMatchTimeoutException)
            {
                // Una regex mal escrita en la config no puede colgar el medidor: la regla se salta.
                continue;
            }

            var normalizado = Huella.Normalizar(extraido, regla.Normalizar);
            if (normalizado != null) return (regla.Id, normalizado);
        }
        return null;
    }
}
