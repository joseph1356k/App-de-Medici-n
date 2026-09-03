namespace Medidor;

/// <summary>
/// LA CUENTA DE LO QUE FALTÓ. Un medidor honesto no es el que nunca falla: es el que dice cuánto
/// dejó de ver. Estos contadores viajan con la jornada y son lo que permite excluir del estudio un
/// día de mala calidad EN VEZ de dejar que contamine la comparación (una caja que miente es peor
/// que no tener caja, aprendizaje nº4).
///
/// POR PROCESO Y EN MEMORIA (contrato 1): cada arranque del .exe parte de cero y manda su fila de
/// `jornadas` con su `proceso_id`; el servidor guarda una por (device, día, proceso) con GREATEST y
/// el resumen SUMA entre procesos. No se persisten en el spool: restaurarlos duplicaría.
///
/// Contadores donde ocurre el trabajo y totales derivados — el modelo del Pulso del mapeador.
/// </summary>
public sealed class Calidad
{
    public long HuecosMs { get; private set; }
    public int Saltos { get; private set; }
    public int DescartesTotal { get; private set; }
    public bool Degradados { get; private set; }
    public int HooksRearmados { get; private set; }
    public int TicksSapSaltados { get; private set; }

    /// <summary>null = SAP no estuvo delante; true = el motor de scripting entró alguna vez; false =
    /// SAP estuvo delante más de un minuto sin motor (sin pantallas ni paciente). El sí gana al no.</summary>
    public bool? SapScripting { get; private set; }

    /// <summary>true cuando los eventos COM StartRequest/EndRequest engancharon alguna vez; null si
    /// nunca (sin ellos la espera y el time-to-ready quedan sin dato). Lo hace visible en el panel.</summary>
    public bool? SapEventosCom { get; private set; }

    /// <summary>1 si este proceso nació de un colapso del anterior (modo Relanzado).</summary>
    public int Relanzos { get; private set; }

    public void Hueco(long ms) { if (ms > 0) HuecosMs += ms; }
    public void SaltoDeReloj() => Saltos++;
    public void Descartes(int n) { if (n > 0) DescartesTotal += n; }
    public void GanchosDegradados() => Degradados = true;
    public void GanchoRearmado() => HooksRearmados++;
    public void TickSapSaltado() => TicksSapSaltados++;
    public void SapEnganchado() => SapScripting = true;
    public void SapSinScripting() { if (SapScripting != true) SapScripting = false; }
    public void SapEventosEnganchados() => SapEventosCom = true;
    public void Relanzo() => Relanzos++;

    /// <summary>Con las claves de la fila `jornadas` (contrato 4).</summary>
    public string ComoJson() =>
        "{\"huecos_ms\":" + HuecosMs
        + ",\"clock_jumps\":" + Saltos
        + ",\"spool_dropped\":" + DescartesTotal
        + ",\"hooks_degradados\":" + Bool(Degradados)
        + ",\"hooks_rearmados\":" + HooksRearmados
        + ",\"ticks_sap_saltados_busy\":" + TicksSapSaltados
        + ",\"sap_scripting\":" + Bool(SapScripting)
        + ",\"sap_eventos_com\":" + Bool(SapEventosCom)
        + ",\"relanzos\":" + Relanzos + "}";

    private static string Bool(bool? b) => b == null ? "null" : b.Value ? "true" : "false";
}
