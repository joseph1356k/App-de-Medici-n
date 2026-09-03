import Link from "next/link";
import { Insignia, Seccion, Vacio } from "@/components/ui";
import { consultoriosParaFiltro, dispositivos } from "@/lib/consultas";
import { etiquetaApp, fmtNum, fmtRelativo } from "@/lib/formato";
import { asignarConsultorio, cambiarEstado } from "./actions";

/**
 * DISPOSITIVOS: cada PC con el medidor, y a qué consultorio pertenece. La asignación se
 * hace AQUÍ (el PC no elige nada): al asignar, lo que ese PC mandó sin consultorio se
 * completa hacia atrás. «Callado» = no late hace más de 20 min: el medidor manda un latido
 * cada minuto aunque el PC esté quieto, así que 20 minutos de silencio es medidor muerto o
 * PC apagado, no «nadie lo está usando».
 */
export default async function DispositivosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [lista, consultorios] = await Promise.all([dispositivos(), consultoriosParaFiltro()]);
  const ahora = Date.now();
  const callado = (d: { last_seen_at: string; status: string }) => d.status === "active" && ahora - new Date(d.last_seen_at).getTime() > 20 * 60 * 1000;
  const sinAsignar = lista.filter((d) => d.status === "active" && !d.consultorio_id).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dispositivos</h1>
        <p className="text-sm text-muted">Los PCs con el medidor instalado. Se registran solos la primera vez que arrancan con la clave del servidor; aquí se les asigna su consultorio (el icono del PC lo muestra en ≤ 2 min).</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-good-soft px-4 py-2 text-sm text-good-text">{sp.ok}</p>}
      {sp.error && <p className="rounded-lg bg-critical-soft px-4 py-2 text-sm text-critical">{sp.error}</p>}
      {sinAsignar > 0 && <p className="rounded-lg bg-warning-soft px-4 py-2 text-sm text-ink">{sinAsignar === 1 ? "Hay un PC activo sin consultorio: mide, pero no aparece en Inicio hasta que se asigne." : `Hay ${sinAsignar} PCs activos sin consultorio: miden, pero no aparecen en Inicio hasta que se asignen.`}</p>}

      {lista.length === 0 ? (
        <Vacio titulo="Ningún PC registrado todavía" texto="Instala el medidor en un PC (doble clic en Medidor.exe, o medidor/instalar.ps1 con la URL de este servidor y la clave). Aparecerá aquí en su primer latido." />
      ) : (
        <Seccion titulo={`${lista.length} dispositivos`}>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>PC</th><th>Consultorio</th><th>Estado</th><th>Último latido</th><th>Última cubeta</th><th className="num">Jornadas</th><th>Versión</th><th>Acciones</th></tr></thead>
              <tbody>
                {lista.map((d) => (
                  <tr key={d.id}>
                    <td className="text-ink">
                      {d.consultorio_id
                        ? <Link href={`/consultorios/${d.consultorio_id}`} className="hover:underline">{d.machine_name || "sin nombre"}</Link>
                        : <span>{d.machine_name || "sin nombre"}</span>}
                      <br /><span className="text-xs text-muted">{d.os_version}</span>
                    </td>
                    <td>
                      <form action={asignarConsultorio} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={d.id} />
                        <select name="consultorio" defaultValue={d.consultorio_id ?? ""} className="campo" aria-label={`Consultorio de ${d.machine_name}`}>
                          <option value="">— sin consultorio —</option>
                          {consultorios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                        <button className="boton" title="Guardar la asignación">✓</button>
                      </form>
                      {d.status === "active" && !d.consultorio_id && <Insignia tono="critico">sin consultorio</Insignia>}
                      {d.consultorio_desde && d.consultorio_id && <span className="text-xs text-muted">desde {fmtRelativo(d.consultorio_desde)}</span>}
                    </td>
                    <td>
                      {d.status === "retired" ? <span className="chip bg-plane text-muted">retirado</span>
                        : d.status === "paused" ? <span className="chip bg-warning-soft text-ink">⏸ pausado</span>
                        : callado(d) ? <span className="chip bg-critical-soft text-critical">⚠ callado</span>
                        : <span className="chip bg-good-soft text-good-text">● activo</span>}
                    </td>
                    <td className="text-secondary">{fmtRelativo(d.last_seen_at)}</td>
                    <td className="text-secondary">{fmtRelativo(d.ultima_cubeta ?? d.last_sample_at)}{d.ultima_app && <><br /><span className="text-xs text-muted">{etiquetaApp(d.ultima_app)}</span></>}</td>
                    <td className="num">{fmtNum(d.jornadas)}</td>
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

// 60 y no 30: la primera asignación de un consultorio completa hacia atrás todo lo que ese
// PC mandó sin consultorio, y puede ser mucho.
export const maxDuration = 60;
