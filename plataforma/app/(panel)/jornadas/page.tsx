import Link from "next/link";
import { Filtros } from "@/components/Filtros";
import { Calidad, ChipFase, Paginador, Seccion, Vacio } from "@/components/ui";
import { consultoriosParaFiltro, jornadas } from "@/lib/consultas";
import { conFiltro, leerFiltros, type Sp } from "@/lib/filtros";
import { fmtFecha, fmtHora, fmtMin, fmtNum, fmtPct, fmtSeg } from "@/lib/formato";

const TAMANO = 25;

/**
 * JORNADAS: una fila por consultorio y día operativo. Es la unidad del estudio (no hay
 * turnos que abrir ni cerrar: el medidor graba siempre). Clic en el día para ver la línea
 * de tiempo de ese consultorio.
 */
export default async function JornadasPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const f = leerFiltros(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ filas, total }, consultorios] = await Promise.all([jornadas(f, page, TAMANO), consultoriosParaFiltro()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Jornadas</h1>
        <p className="text-sm text-muted">Una jornada = un consultorio en un día operativo (corte 06:00). El horario es de la primera a la última cubeta con actividad.</p>
      </div>
      <Filtros f={f} consultorios={consultorios} ruta="/jornadas" />
      {total === 0 ? (
        <Vacio titulo="Sin jornadas" texto="No hay jornadas con estos filtros. Una jornada aparece a los pocos minutos de que un PC empiece a mandar cubetas." />
      ) : (
        <Seccion titulo={`${fmtNum(total)} jornadas`}>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Día</th><th>Consultorio</th><th>Fase</th><th>Horario</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Escrib.</th><th className="num">Pacientes</th><th className="num">Consulta med.</th><th className="num">Espera SAP</th><th className="num">Cobertura</th><th>Calidad</th></tr></thead>
              <tbody>
                {filas.map((j) => (
                  <tr key={`${j.device_id}-${j.dia_operativo}`}>
                    <td>{j.consultorio_id
                      ? <Link href={`/consultorios/${j.consultorio_id}?fecha=${j.dia_operativo}`} className="text-accent hover:underline">{fmtFecha(j.dia_operativo)}</Link>
                      : <span className="text-ink">{fmtFecha(j.dia_operativo)}</span>}</td>
                    <td className="text-ink">{j.consultorio ?? <span className="text-muted">sin consultorio</span>}<br /><span className="text-xs text-muted">{j.machine_name}</span></td>
                    <td><ChipFase fase={j.phase} /></td>
                    <td className="tabular text-secondary">{j.primera_actividad ? `${fmtHora(j.primera_actividad)} – ${fmtHora(j.ultima_actividad)}` : "sin actividad"}</td>
                    <td className="num">{fmtMin(j.activo_ms)}</td>
                    <td className="num">{fmtMin(j.his_ms)}</td>
                    <td className="num">{fmtMin(j.typing_ms)}</td>
                    <td className="num">{fmtNum(j.pacientes)}</td>
                    <td className="num">{fmtMin(j.consulta_ms_mediana)}</td>
                    <td className="num">{fmtSeg(j.sap_wait_ms)}</td>
                    <td className="num">{fmtPct(j.cobertura_pct)}</td>
                    <td><Calidad ok={j.calidad_ok} cobertura={j.cobertura_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Paginador page={page} total={total} tamano={TAMANO} noun="jornadas" href={(p) => `/jornadas${conFiltro(f, { page: String(p) })}`} /></div>
        </Seccion>
      )}
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
