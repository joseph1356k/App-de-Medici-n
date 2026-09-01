namespace Medidor;

/// <summary>Las únicas teclas que el medidor distingue. Todo lo demás es «una tecla más».</summary>
public enum TeclaDeControl { Ninguna, Tab, Enter, Correccion, Copiar, Pegar, Guardar }

/// <summary>
/// LA LISTA BLANCA DEL TECLADO. El gancho de teclado mira el código de la tecla SOLO para
/// contestar esta pregunta: ¿es Tab, Enter, borrar (Backspace/Supr), copiar (Ctrl+C / Ctrl+Ins),
/// pegar (Ctrl+V / Mayús+Ins) o guardar (Ctrl+S)? Cualquier otra tecla —todas las letras, los
/// números, los símbolos— devuelve <see cref="TeclaDeControl.Ninguna"/> y es indistinguible de las
/// demás. Es la forma de medir «cuánto se corrige, cuánto se copia y pega, cuánto se navega con
/// Tab» sin que exista un camino por el que una letra pueda llegar a ningún sitio (promesa 23).
///
/// Puro y sin Windows: los códigos son las constantes VK_* de Win32, que son números públicos.
/// </summary>
public static class TeclasDeControl
{
    public const int VK_BACK = 0x08, VK_TAB = 0x09, VK_RETURN = 0x0D, VK_INSERT = 0x2D, VK_DELETE = 0x2E;
    public const int VK_C = 0x43, VK_S = 0x53, VK_V = 0x56;

    public static TeclaDeControl Clasificar(int vk, bool ctrl, bool shift)
    {
        switch (vk)
        {
            case VK_TAB: return TeclaDeControl.Tab;
            case VK_RETURN: return TeclaDeControl.Enter;
            case VK_BACK or VK_DELETE: return TeclaDeControl.Correccion;
            case VK_C when ctrl: return TeclaDeControl.Copiar;
            case VK_V when ctrl: return TeclaDeControl.Pegar;
            case VK_S when ctrl: return TeclaDeControl.Guardar;
            case VK_INSERT when ctrl: return TeclaDeControl.Copiar;
            case VK_INSERT when shift: return TeclaDeControl.Pegar;
            default: return TeclaDeControl.Ninguna;
        }
    }
}
