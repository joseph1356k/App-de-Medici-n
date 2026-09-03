// La tarjeta de un consultorio en Inicio: qué está pasando AHORA (estado, app, desde
// cuándo), la tira del día con la misma ventana que las otras dos, lo acumulado hoy y las
// alertas del instrumento. Toda la tarjeta es el enlace al día completo.
import Link from "next/link";
import type { EstadoConsultorio, LineaDeTiempoDia as Datos } from "@/lib/consultas";
import type { Ventana } from "@/lib/linea-tiempo";
import { ETIQUETA_ESTADO, etiquetaApp, fmtHora, fmtMin, fmtNum, fmtRelativo } from "@/lib/formato";
import { LineaDeTiempoDia } from "./LineaDeTiempoDia";
import { Insignia, PuntoEstado } from "./ui";

export function TarjetaConsultorio({ estado: e, datos, ventana, ahora }: { estado: EstadoConsultorio; datos: Datos | null; ventana?: Ventana; ahora: string }) {
  const ultimo = datos && datos.segmentos.length > 0 ? datos.segmentos[datos.segmentos.length - 1] : null;
  // «Sin datos» empieza cuando se acabaron las cubetas; los demás estados, con su último segmento.
  const desde = !ultimo ? null : e.estado_actual === "sin_datos" ? ultimo.fin : ultimo.inicio;
  const insignia = !e.device
    ? <Insignia tono="neutro">sin PC</Insignia>
    : e.en_linea ? <Insignia tono="ok" title={`latido ${fmtRelativo(e.device.last_seen_at)}`}>● en línea</Insignia>
    : <Insignia tono="critico" title={`último latido ${fmtRelativo(e.device.last_seen_at)}`}>⚠ callado</Insignia>;

  return (
    <Link href={`/consultorios/${e.consultorio.id}`} className="tarjeta block p-4 transition-colors hover:border-accent">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{e.consultorio.nombre}</h2>
        {insignia}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="inline-flex items-center gap-2 text-2xl font-semibold text-ink">
          <PuntoEstado estado={e.estado_actual} grande /> {ETIQUETA_ESTADO[e.estado_actual]}
        </span>
        {e.app_actual && <span className="text-sm text-secondary">· {etiquetaApp(e.app_actual)}{e.tcode_actual ? ` · ${e.tcode_actual}` : ""}</span>}
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {desde ? `desde las ${fmtHora(desde)} · ${fmtRelativo(desde)}` : e.device ? "todavía sin cubetas hoy" : "asigna un PC en Dispositivos"}
        {e.medico && <> · <span className="text-secondary">{e.medico.nombre}</span></>}
      </p>

      <div className="mt-3">
        {datos ? <LineaDeTiempoDia datos={datos} modo="mini" ventana={ventana} ahora={ahora} /> : <div className="h-12 rounded bg-plane" aria-hidden />}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div><dt className="text-xs text-muted">Activo hoy</dt><dd className="tabular text-base font-semibold text-ink">{fmtMin(e.hoy?.activo_ms)}</dd></div>
        <div><dt className="text-xs text-muted">En SAP</dt><dd className="tabular text-base font-semibold text-ink">{fmtMin(e.hoy?.his_ms)}</dd></div>
        <div><dt className="text-xs text-muted">Pacientes</dt><dd className="tabular text-base font-semibold text-ink">{fmtNum(e.hoy?.pacientes)}</dd></div>
      </dl>

      {e.alertas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {e.alertas.map((a) => <Insignia key={a} tono={a.startsWith("Sin PC") ? "neutro" : "aviso"}>{a}</Insignia>)}
        </div>
      )}

      <p className="mt-3 border-t border-line pt-2 text-xs text-muted">
        {e.device ? <>{e.device.machine_name || "PC sin nombre"} · v{e.device.app_version || "?"} · latido {fmtRelativo(e.device.last_seen_at)}</> : "Sin PC asignado"}
      </p>
    </Link>
  );
}
