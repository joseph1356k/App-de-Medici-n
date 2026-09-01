import Link from "next/link";
import { Filtros } from "@/components/Filtros";
import { Calidad, ChipFase, Paginador, Seccion, Vacio } from "@/components/ui";
import { medicosParaFiltro, turnos } from "@/lib/consultas";
import { conFiltro, leerFiltros, type Sp } from "@/lib/filtros";
import { ETIQUETA_CIERRE, fmtFecha, fmtHora, fmtMin, fmtNum, fmtSeg } from "@/lib/formato";

const TAMANO = 25;

export default async function TurnosPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const f = leerFiltros(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ filas, total }, medicos] = await Promise.all([turnos(f, page, TAMANO), medicosParaFiltro()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Turnos</h1>
        <p className="text-sm text-muted">Un turno = un médico (o «sin médico») en un PC, desde que se abre hasta que se cierra. Clic en el día para ver el detalle.</p>
      </div>
      <Filtros f={f} medicos={medicos} ruta="/turnos" />
      {total === 0 ? (
        <Vacio titulo="Sin turnos" texto="No hay turnos con estos filtros." />
      ) : (
        <Seccion titulo={`${fmtNum(total)} turnos`}>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Día</th><th>Médico</th><th>PC</th><th>Fase</th><th>Horario</th><th>Cierre</th><th className="num">Duración</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Escrib.</th><th className="num">Clics</th><th className="num">Pacientes</th><th className="num">Post-at.</th><th className="num">Espera SAP</th><th>Calidad</th></tr></thead>
              <tbody>
                {filas.map((t) => (
                  <tr key={t.shift_id}>
                    <td><Link href={`/turnos/${t.shift_id}`} className="text-accent hover:underline">{fmtFecha(t.fecha)}</Link></td>
                    <td className="text-ink">{t.nombre ?? <span className="text-muted">sin médico</span>}</td>
                    <td className="text-secondary">{t.machine_name}</td>
                    <td><ChipFase fase={t.phase} /></td>
                    <td className="tabular text-secondary">{fmtHora(t.started_at)} – {t.ended_at ? fmtHora(t.ended_at) : "en curso"}</td>
                    <td className="text-secondary">{t.end_reason ? ETIQUETA_CIERRE[t.end_reason] ?? t.end_reason : "—"}</td>
                    <td className="num">{fmtMin(t.duracion_ms)}</td>
                    <td className="num">{fmtMin(t.active_ms_total)}</td>
                    <td className="num">{fmtMin(t.his_ms)}</td>
                    <td className="num">{fmtMin(t.typing_ms)}</td>
                    <td className="num">{fmtNum(t.clicks)}</td>
                    <td className="num">{fmtNum(t.encounters)}</td>
                    <td className="num">{fmtMin(t.post_atencion_ms)}</td>
                    <td className="num">{fmtSeg(t.sap_wait_ms_total)}</td>
                    <td><Calidad ok={t.calidad_ok} cobertura={t.cobertura_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Paginador page={page} total={total} tamano={TAMANO} href={(p) => `/turnos${conFiltro(f, { page: String(p) })}`} /></div>
        </Seccion>
      )}
    </div>
  );
}
