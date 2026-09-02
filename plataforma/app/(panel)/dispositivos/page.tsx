import Link from "next/link";
import { Seccion, Vacio } from "@/components/ui";
import { dispositivos } from "@/lib/consultas";
import { fmtNum, fmtRelativo } from "@/lib/formato";
import { cambiarEstado, etiquetar } from "./actions";

/**
 * DISPOSITIVOS: cada PC con el medidor. «Callado» = no late hace más de 20 min: el
 * medidor manda un latido cada minuto aunque el PC esté quieto, así que 20 minutos de
 * silencio es medidor muerto o PC apagado, no «nadie lo está usando».
 */
export default async function DispositivosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const lista = await dispositivos();
  const ahora = Date.now();
  const callado = (d: { last_seen_at: string; status: string }) => d.status === "active" && ahora - new Date(d.last_seen_at).getTime() > 20 * 60 * 1000;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dispositivos</h1>
        <p className="text-sm text-muted">Los PCs con el medidor instalado. Se registran solos la primera vez que arrancan con la clave del servidor.</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-good-soft px-4 py-2 text-sm text-good-text">{sp.ok}</p>}
      {sp.error && <p className="rounded-lg bg-critical-soft px-4 py-2 text-sm text-critical">{sp.error}</p>}

      {lista.length === 0 ? (
        <Vacio titulo="Ningún PC registrado todavía" texto="Instala el medidor en un PC (medidor/instalar.ps1 con la URL de este servidor y la clave). Aparecerá aquí en su primer latido." />
      ) : (
        <Seccion titulo={`${lista.length} dispositivos`}>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>PC</th><th>Etiqueta</th><th>Estado</th><th>Último latido</th><th>Última muestra</th><th>Turno en curso</th><th className="num">Turnos</th><th>Versión</th><th>Acciones</th></tr></thead>
              <tbody>
                {lista.map((d) => (
                  <tr key={d.id}>
                    <td className="text-ink"><Link href={`/turnos?dispositivo=${d.id}&rango=todo`} className="hover:underline">{d.machine_name || "sin nombre"}</Link><br /><span className="text-xs text-muted">{d.os_version}</span></td>
                    <td>
                      <form action={etiquetar} className="flex gap-1">
                        <input type="hidden" name="id" value={d.id} />
                        <input name="label" defaultValue={d.label} placeholder="p. ej. consultorio 3" className="campo w-36" />
                        <button className="boton">✓</button>
                      </form>
                    </td>
                    <td>
                      {d.status === "retired" ? <span className="chip bg-plane text-muted">retirado</span>
                        : d.status === "paused" ? <span className="chip bg-warning-soft text-ink">⏸ pausado</span>
                        : callado(d) ? <span className="chip bg-critical-soft text-critical">⚠ callado</span>
                        : <span className="chip bg-good-soft text-good-text">● activo</span>}
                    </td>
                    <td className="text-secondary">{fmtRelativo(d.last_seen_at)}</td>
                    <td className="text-secondary">{fmtRelativo(d.last_sample_at)}</td>
                    <td className="text-secondary">{d.turno_abierto ? <Link href={`/turnos/${d.turno_abierto}`} className="text-accent hover:underline">{d.medico_actual}</Link> : "—"}</td>
                    <td className="num">{fmtNum(d.turnos)}</td>
                    <td className="text-secondary">{d.app_version || "—"}</td>
                    <td>
                      <div className="flex gap-1">
                        {d.status !== "active" && <form action={cambiarEstado}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="estado" value="active" /><button className="boton">Reactivar</button></form>}
                        {d.status === "active" && <form action={cambiarEstado}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="estado" value="paused" /><button className="boton">Pausar</button></form>}
                        {d.status !== "retired" && <form action={cambiarEstado}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="estado" value="retired" /><button className="boton text-muted">Retirar</button></form>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Seccion>
      )}
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
