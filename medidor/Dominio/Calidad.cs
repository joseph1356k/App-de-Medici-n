namespace Medidor;

/// <summary>
/// LA CUENTA DE LO QUE FALTÓ. Un medidor honesto no es el que nunca falla: es el que dice cuánto
/// dejó de ver. Estos contadores viajan con el turno y son lo que permite excluir del estudio una
/// sesión de mala calidad EN VEZ de dejar que contamine la comparación (una caja que miente es
/// peor que no tener caja, aprendizaje nº4).
///
/// Contadores donde ocurre el trabajo y totales derivados — el modelo del Pulso del mapeador.
/// </summary>
public sealed class Calidad
{
    public long HuecosMs { get; private set; }
    public int Saltos { get; private set; }
    public int DescartesTotal { get; private set; }
    public bool Degradados { get; private set; }
    public int TicksSapSaltados { get; private set; }

    public void Hueco(long ms) { if (ms > 0) HuecosMs += ms; }
    public void SaltoDeReloj() => Saltos++;
    public void Descartes(int n) { if (n > 0) DescartesTotal += n; }
    public void GanchosDegradados() => Degradados = true;
    public void TickSapSaltado() => TicksSapSaltados++;

    public string ComoJson() =>
        "{\"huecos_ms\":" + HuecosMs
        + ",\"clock_jumps\":" + Saltos
        + ",\"spool_dropped\":" + DescartesTotal
        + ",\"hooks_degradados\":" + (Degradados ? "true" : "false")
        + ",\"ticks_sap_saltados_busy\":" + TicksSapSaltados + "}";
}
