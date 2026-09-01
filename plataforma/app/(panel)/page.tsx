import Link from "next/link";
import { Filtros } from "@/components/Filtros";
import { SerieDiaria } from "@/components/SerieDiaria";
import { Barras } from "@/components/Barras";
import { Calidad, ChipFase, Seccion, Tile, Vacio } from "@/components/ui";
import { cobertura, kpis, medicosParaFiltro, porApp, porMedico, serieDiaria, turnos } from "@/lib/consultas";
import { leerFiltros, type Sp } from "@/lib/filtros";
import { colorApp, etiquetaApp, fmtFecha, fmtHora, fmtMin, fmtNum, fmtPct, fmtSeg } from "@/lib/formato";

/**
 * RESUMEN: la vista con la que se abre el panel. Primero la COBERTURA (cuántos turnos
 * se midieron bien y cuántos se excluyeron) — un promedio sobre turnos parciales
 * miente, así que se dice antes de mostrar ningún número. Después las medianas por
 * turno, la serie diaria, el reparto por médico y por app, y los últimos turnos.
 */
export default async function ResumenPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const f = leerFiltros(await searchParams);
  const [k, c, serie, medicos, apps, ultimos, listaMedicos] = await Promise.all([
    kpis(f), cobertura(f), serieDiaria(f), porMedico(f), porApp(f), turnos(f, 1, 10), medicosParaFiltro(),
  ]);
  const totalApps = apps.reduce((s, a) => s + Number(a.ms), 0) || 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Resumen de la medición</h1>
        <p className="text-sm text-muted">Trabajo operativo de los médicos en el PC: tiempo, escritura, clics, recorridos por SAP y esperas. Nunca contenido clínico.</p>
      </div>

      <Filtros f={f} medicos={listaMedicos} />

      {c.total === 0 ? (
        <Vacio titulo="Todavía no hay turnos en este rango" texto="Cuando un PC con el medidor tenga actividad, sus turnos aparecen aquí a un minuto del terreno. Revisa Dispositivos para ver qué PCs están reportando." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
            <span><strong className="text-ink">{fmtNum(c.total)}</strong> <span className="text-muted">turnos en el rango</span></span>
            <span><strong className="text-good-text">{fmtNum(c.medidos)}</strong> <span className="text-muted">de buena calidad</span></span>
            <span><strong className={c.excluidos > 0 ? "text-critical" : "text-ink"}>{fmtNum(c.excluidos)}</strong> <span className="text-muted">excluidos por calidad</span></span>
            <span><strong className="text-ink">{fmtPct(c.cobertura_media)}</strong> <span className="text-muted">cobertura media</span></span>
            {c.abiertos > 0 && <span className="chip bg-accent-soft text-ink">● {c.abiertos} turno{c.abiertos === 1 ? "" : "s"} en curso</span>}
            <span className="ml-auto text-xs text-muted">{f.incluirMala ? "promedios CON turnos de mala calidad" : "promedios solo con turnos de buena calidad"}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Tile label="Activo en el PC por turno" value={fmtMin(k.activo_med)} sub={`mediana de ${fmtNum(k.n)} turnos`} hero />
            <Tile label="En SAP (HIS)" value={fmtMin(k.his_med)} sub="activo con SAP delante" />
            <Tile label="Escribiendo" value={fmtMin(k.escritura_med)} sub="ráfagas de tecleo" />
            <Tile label="Clics" value={fmtNum(k.clics_med)} sub="por turno" />
            <Tile label="Cambios de contexto" value={fmtNum(k.cambios_med)} sub="app/pantalla/paciente" />
            <Tile label="Duración del turno" value={fmtMin(k.duracion_med)} sub="apertura → cierre" />
            <Tile label="Pacientes por turno" value={fmtNum(k.encounters_med)} sub="identificados en SAP" />
            <Tile label="Tiempo activo por paciente" value={fmtMin(k.por_encounter_med)} sub="mediana por consulta" />
            <Tile label="Trabajo post-atención" value={fmtMin(k.post_med)} sub="sobre un paciente ya cerrado" />
            <Tile label="Cola al final del turno" value={fmtMin(k.cola_med)} sub="SAP tras el último paciente" />
            <Tile label="Espera de SAP" value={fmtSeg(k.espera_sap_med)} sub="suma de round-trips" />
            <Tile label="Pantalla lista (p95)" value={fmtSeg(k.ready_p95_med)} sub="time-to-ready" />
          </div>

          <Seccion titulo="Minutos por turno, día a día" sub="Mediana de los turnos de cada día operativo (corte 06:00). Un día sin punto es un día sin turnos de buena calidad.">
            <SerieDiaria puntos={serie.map((p) => ({ ...p, activo_ms: p.activo_ms == null ? null : Number(p.activo_ms), his_ms: p.his_ms == null ? null : Number(p.his_ms) }))} />
          </Seccion>

          <div className="grid gap-6 lg:grid-cols-5">
            <Seccion titulo="Por médico" sub="Medianas por turno." accion={<Link href={`/turnos`} className="text-xs text-accent hover:underline">ver turnos →</Link>}>
              <div className="overflow-x-auto lg:col-span-3">
                <table className="tabla">
                  <thead><tr><th>Médico</th><th className="num">Turnos</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Pacientes</th><th className="num">Por paciente</th><th className="num">Post-atención</th><th className="num">Clics</th></tr></thead>
                  <tbody>
                    {medicos.map((m) => (
                      <tr key={m.doctor_id ?? "anon"}>
                        <td className="text-ink">{m.doctor_id ? <Link href={`/turnos?medico=${m.doctor_id}`} className="hover:underline">{m.nombre}</Link> : <span className="text-muted">{m.nombre}</span>}</td>
                        <td className="num">{fmtNum(m.turnos)}</td>
                        <td className="num">{fmtMin(m.activo_med)}</td>
                        <td className="num">{fmtMin(m.his_med)}</td>
                        <td className="num">{fmtNum(m.encounters_med)}</td>
                        <td className="num">{fmtMin(m.por_encounter_med)}</td>
                        <td className="num">{fmtMin(m.post_med)}</td>
                        <td className="num">{fmtNum(m.clics_med)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Seccion>
            <div className="lg:col-span-2">
              <Seccion titulo="Dónde se va el tiempo activo" sub="Suma de minutos activos por aplicación en el rango.">
                <Barras ariaLabel="Minutos activos por aplicación" items={apps.map((a) => ({
                  id: a.app, etiqueta: etiquetaApp(a.app), valor: Number(a.ms), color: colorApp(a.app),
                  texto: `${fmtMin(a.ms)} · ${Math.round((Number(a.ms) / totalApps) * 100)} %`, detalle: `${a.turnos} turnos`,
                }))} />
              </Seccion>
            </div>
          </div>

          <Seccion titulo="Últimos turnos" accion={<Link href={`/turnos`} className="text-xs text-accent hover:underline">ver todos →</Link>}>
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead><tr><th>Día</th><th>Médico</th><th>PC</th><th>Fase</th><th>Horario</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Pacientes</th><th className="num">Post-at.</th><th>Calidad</th></tr></thead>
                <tbody>
                  {ultimos.filas.map((t) => (
                    <tr key={t.shift_id}>
                      <td><Link href={`/turnos/${t.shift_id}`} className="text-accent hover:underline">{fmtFecha(t.fecha)}</Link></td>
                      <td className="text-ink">{t.nombre ?? <span className="text-muted">sin médico</span>}</td>
                      <td className="text-secondary">{t.machine_name}</td>
                      <td><ChipFase fase={t.phase} /></td>
                      <td className="tabular text-secondary">{fmtHora(t.started_at)} – {t.ended_at ? fmtHora(t.ended_at) : "en curso"}</td>
                      <td className="num">{fmtMin(t.active_ms_total)}</td>
                      <td className="num">{fmtMin(t.his_ms)}</td>
                      <td className="num">{fmtNum(t.encounters)}</td>
                      <td className="num">{fmtMin(t.post_atencion_ms)}</td>
                      <td><Calidad ok={t.calidad_ok} cobertura={t.cobertura_pct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
        </>
      )}
    </div>
  );
}
