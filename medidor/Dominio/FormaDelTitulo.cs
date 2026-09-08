using System.Globalization;
using System.Text;

namespace Medidor;

/// <summary>
/// LA FORMA DE UN TÍTULO, para poder escribir la regla del paciente sin ir al hospital.
///
/// El problema que resuelve: la regla que saca el identificador del paciente se escribe contra el
/// título de la ventana de SAP, pero ese título NO SALE del PC (y no debe salir: en urgencias lleva
/// nombre y documento). Así que quien escribe la regla lo hace a ciegas. En el HGM eso costó
/// 25.277 pantallas leídas y CERO pacientes identificados: la regla buscaba «Paciente 12345678» y
/// el título dice otra cosa que nadie ha podido ver nunca.
///
/// Lo que viaja en su lugar es la FORMA: cada dígito pasa a `#`, cada letra a `x`, se conservan los
/// separadores y —solo— las palabras de un diccionario cerrado de rótulos de SAP. Un título como
///
///     Historia clínica — Juan Pérez Gómez (CC 123456789) · Paciente 00123456
///
/// viaja como
///
///     Historia clínica — xxxx xxxxx xxxxx (CC #########) · Paciente ########
///
/// Con eso se ve DÓNDE está el número y QUÉ rótulo lo precede, que es exactamente lo que necesita
/// una regex, y no se puede reconstruir ni el nombre ni el documento: los dígitos son todos `#` y
/// una palabra que no esté en el diccionario es toda `x`.
///
/// EL ENSANCHE, dicho en voz alta: hasta la v2.0.5 NINGUNA palabra del título salía del PC. Desde
/// la v2.0.6 salen las del diccionario —rótulos, nunca datos— y solo en el evento de diagnóstico
/// `encounter_unknown`, una vez por pantalla y jornada. Está en docs/PRIVACIDAD.md y lo fija la
/// promesa 35 del contrato.
/// </summary>
public static class FormaDelTitulo
{
    public const int Tope = 120;

    /// <summary>
    /// Los RÓTULOS que sobreviven en claro. Son nombres de campo de SAP IS-H y las palabras con las
    /// que un hospital colombiano rotula un identificador: ninguna es un dato de nadie. La
    /// comparación es por palabra completa y sin tildes, así que «Ingrid» no pasa por «ingreso» ni
    /// «Cecilia» por «cédula».
    /// </summary>
    private static readonly HashSet<string> Rotulos = new(StringComparer.Ordinal)
    {
        "paciente", "pacientes", "patnr", "nhc", "hc", "historia", "clinica", "clinico",
        "caso", "falnr", "einri", "episodio", "ingreso", "admision", "atencion", "consulta",
        "documento", "identificacion", "cedula", "cc", "ti", "rc", "ce", "ps", "ms",
        "registro", "num", "nro", "no", "id", "hist", "expediente", "folio",
        "urgencias", "puesto", "trabajo", "visualizar", "modificar", "crear", "mostrar",
        "sap", "nwp", "menu", "sesion", "sistema",
    };

    /// <summary>Los separadores que se conservan tal cual: son la estructura del título, y sin
    /// ellos la forma no se puede leer. Cualquier otro carácter raro pasa a espacio. `#` NO está
    /// en la lista a propósito: es el carácter con el que se enmascara un dígito, y un `#` literal
    /// del título haría creer que ahí hay un número.</summary>
    private const string Separadores = " -–—_/\\|:;,.()[]{}<>·•*+=@&%\"'¿?¡!";

    /// <summary>
    /// El título → su forma. Nunca devuelve un dígito, ni una letra que no venga de un rótulo del
    /// diccionario. Cadena vacía si no hay título.
    /// </summary>
    public static string Enmascarar(string? titulo)
    {
        if (string.IsNullOrWhiteSpace(titulo)) return "";

        var salida = new StringBuilder(Math.Min(titulo.Length, Tope) + 8);
        var palabra = new StringBuilder(32);

        void CerrarPalabra()
        {
            if (palabra.Length == 0) return;
            var texto = palabra.ToString();
            salida.Append(EsRotulo(texto) ? texto : Enmascarada(texto));
            palabra.Clear();
        }

        foreach (var c in titulo)
        {
            if (char.IsLetterOrDigit(c)) { if (palabra.Length < 64) palabra.Append(c); continue; }
            CerrarPalabra();
            // Un carácter que no es letra, dígito ni separador conocido (un emoji, un carácter de
            // control) no dice nada de la forma y podría llevar información: pasa a espacio.
            salida.Append(Separadores.Contains(c) ? c : ' ');
        }
        CerrarPalabra();

        return Recortar(ColapsarEspacios(salida.ToString()));
    }

    /// <summary>Una palabra que no es rótulo: letra → `x`, dígito → `#`. Se conserva la LONGITUD,
    /// que es lo que permite escribir `[0-9]{5,10}` con conocimiento de causa.</summary>
    private static string Enmascarada(string palabra)
    {
        var sb = new StringBuilder(palabra.Length);
        foreach (var c in palabra) sb.Append(char.IsDigit(c) ? '#' : 'x');
        return sb.ToString();
    }

    /// <summary>¿Es una palabra del diccionario? Se compara en minúsculas y sin tildes («clínica»
    /// entra como «clinica»), pero lo que se emite es la palabra ORIGINAL: la regla se escribe
    /// contra el título de verdad, tildes incluidas.</summary>
    private static bool EsRotulo(string palabra)
    {
        var sb = new StringBuilder(palabra.Length);
        foreach (var c in palabra.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(char.ToLowerInvariant(c));
        }
        return Rotulos.Contains(sb.ToString());
    }

    private static string ColapsarEspacios(string s)
    {
        var sb = new StringBuilder(s.Length);
        bool espacio = false;
        foreach (var c in s)
        {
            if (c == ' ') { espacio = true; continue; }
            if (espacio && sb.Length > 0) sb.Append(' ');
            espacio = false;
            sb.Append(c);
        }
        return sb.ToString();
    }

    private static string Recortar(string s) => s.Length <= Tope ? s : s[..Tope];
}
