using System.Security.Cryptography;
using System.Text;

namespace Medidor;

/// <summary>
/// LA HUELLA DEL ENCOUNTER: el identificador del paciente entra, un HMAC irreversible sale, y el
/// crudo muere aquí — no toca log, ni spool, ni red. Es lo que permite saber que dos segmentos de
/// actividad pertenecen a la misma consulta (el A→B→A de urgencias) sin almacenar identidad.
///
/// La clave se deriva POR DÍA OPERATIVO, con corte a las 06:00: entre días las huellas no se
/// pueden enlazar (más privado, y ninguna métrica del estudio necesita ese enlace), y el corte a
/// las 06:00 —no a medianoche— existe porque un turno nocturno abre a las 19:00 y cruza las 00:00:
/// si la clave rotara ahí, el mismo paciente daría dos huellas en el mismo turno. El turno FIJA su
/// día operativo al abrirse (promesa 5).
/// </summary>
public static class Huella
{
    private const int CorteDelDiaHoras = 6;

    /// <param name="instanteLocal">La hora LOCAL del hospital (con su offset). América/Bogotá no
    /// cambia de hora, así que el offset del reloj del PC basta.</param>
    public static DateOnly DiaOperativo(DateTimeOffset instanteLocal)
        => DateOnly.FromDateTime(instanteLocal.DateTime.AddHours(-CorteDelDiaHoras));

    public static byte[] ClaveDelDia(byte[] secretoOrg, DateOnly diaOperativo)
    {
        using var hmac = new HMACSHA256(secretoOrg);
        return hmac.ComputeHash(Encoding.UTF8.GetBytes("dia-operativo:" + diaOperativo.ToString("yyyy-MM-dd")));
    }

    /// <summary>Normaliza el crudo ANTES de hashear, para que «0012345» y «12345» sean la misma
    /// persona. Un modo desconocido devuelve null: ante la duda, no hay identificador — nunca se
    /// hashea algo que no se entendió.</summary>
    public static string? Normalizar(string crudo, string modo)
    {
        if (string.IsNullOrWhiteSpace(crudo)) return null;
        switch (modo)
        {
            case "digitos_sin_ceros":
                var digitos = new string(crudo.Where(char.IsAsciiDigit).ToArray()).TrimStart('0');
                return digitos.Length == 0 ? null : digitos;
            case "tal_cual":
                var limpio = crudo.Trim();
                return limpio.Length == 0 ? null : limpio;
            default:
                return null;
        }
    }

    /// <summary>HMAC-SHA256 truncado a 16 bytes, en hex (32 caracteres). Determinista dentro del
    /// día operativo; irreversible siempre.</summary>
    public static string DeIdentificador(byte[] claveDelDia, string idNormalizado)
    {
        using var hmac = new HMACSHA256(claveDelDia);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(idNormalizado));
        return Convert.ToHexString(hash, 0, 16).ToLowerInvariant();
    }
}
