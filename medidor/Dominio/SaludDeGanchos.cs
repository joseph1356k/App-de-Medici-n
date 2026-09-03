namespace Medidor;

/// <summary>
/// ¿SIGUEN VIVOS LOS GANCHOS? Windows quita un gancho de bajo nivel cuyo hilo tarde en contestar, y
/// lo hace EN SILENCIO: los clics y las teclas pasan a cero y nadie se entera. El testigo independiente
/// es GetLastInputInfo: si el sistema vio input en los últimos 10 s y los ganchos no, algo pasa. Tres
/// chequeos seguidos (30 s) antes de rearmar, para no reaccionar a un tick raro.
///
/// En la pantalla de bloqueo o en un UAC (escritorio seguro) los ganchos no ven nada CON RAZÓN: ahí
/// no se sospecha. Puro, para jurarlo en el contrato (promesa 25).
/// </summary>
public sealed class SaludDeGanchos
{
    public const int VentanaMs = 10_000;
    public const int Chequeos = 3;

    private int _sospechas;

    /// <summary>true cuando toca rearmar. Los «hace cuánto» son relativos (ms desde ahora).</summary>
    public bool Evaluar(long haceSistemaMs, long haceGanchosMs, bool escritorioSeguro)
    {
        if (escritorioSeguro || haceSistemaMs > VentanaMs) { _sospechas = 0; return false; } // bloqueo/UAC o sin input: ciegos con razón
        _sospechas = haceGanchosMs > VentanaMs ? _sospechas + 1 : 0;
        if (_sospechas < Chequeos) return false;
        _sospechas = 0;
        return true;
    }
}
