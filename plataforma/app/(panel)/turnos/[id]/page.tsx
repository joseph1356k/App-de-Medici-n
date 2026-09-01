import Link from "next/link";
import { LineaDeTiempo } from "@/components/LineaDeTiempo";
import { Calidad, ChipFase, Seccion, Tile, Vacio } from "@/components/ui";
import { encounters, eventosDelTurno, lineaDeTiempo, turno, visitasDelTurno } from "@/lib/consultas";
import { ETIQUETA_CIERRE, ETIQUETA_EVENTO, colorApp, etiquetaApp, fmtFecha, fmtHora, fmtMin, fmtNum, fmtPct, fmtSeg } from "@/lib/formato";

/**
 * UN TURNO, de principio a fin: qué se midió, la línea de tiempo por app, los
 * pacientes (huellas, no nombres), el recorrido por SAP pantalla a pantalla, los
 * eventos, y la calidad del instrumento en ese turno.
 */
export default async function TurnoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Vacio titulo="Turno no encontrado" texto="El identificador no tiene forma de turno." />;
  const t = await turno(id);
  if (!t) return <Vacio titulo="Turno no encontrado" texto="Puede que aún no esté resumido (se resume al minuto de recibir datos) o que el id no exista." />;
  const [bins, pacientes, visitas, eventos] = await Promise.all([lineaDeTiempo(id), encounters(id), visitasDelTurno(id), eventosDelTurno(id)]);
  const apps = Object.entries(t.active_ms_por_app ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  const totalApps = apps.reduce((s, [, ms]) => s + Number(ms), 0) || 1;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/turnos" className="text-sm text-accent hover:underline">← Turnos</Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">Turno del {fmtFecha(t.fecha)} · {t.nombre ?? "sin médico"}</h1>
        <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>PC <span className="text-secondary">{t.machine_name}</span></span>
          <ChipFase fase={t.phase} />
          <span className="tabular">{fmtHora(t.started_at)} – {t.ended_at ? fmtHora(t.ended_at) : "en curso"}</span>
          {t.end_reason && <span>· {ETIQUETA_CIERRE[t.end_reason] ?? t.end_reason}</span>}
          {t.sap_user_seen && <span>· usuario SAP <span className="font-mono text-xs">{t.sap_user_seen}</span></span>}
          <Calidad ok={t.calidad_ok} cobertura={t.cobertura_pct} />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Tile label="Duración" value={fmtMin(t.duracion_ms)} />
        <Tile label="Activo en el PC" value={fmtMin(t.active_ms_total)} sub={`${fmtPct(t.duracion_ms ? (t.active_ms_total / t.duracion_ms) * 100 : null)} del turno`} />
        <Tile label="En SAP (HIS)" value={fmtMin(t.his_ms)} />
        <Tile label="En Miracle" value={fmtMin(t.miracle_ms)} />
        <Tile label="Escribiendo" value={fmtMin(t.typing_ms)} sub={`${fmtNum(t.keystrokes)} teclas`} />
        <Tile label="Clics · scroll" value={`${fmtNum(t.clicks)} · ${fmtNum(t.scroll_ticks)}`} />
        <Tile label="Cambios de contexto" value={fmtNum(t.context_switches)} />
        <Tile label="Pacientes" value={fmtNum(t.encounters)} sub={`mediana ${fmtMin(t.encounter_active_ms_mediana)} c/u`} />
        <Tile label="Post-atención" value={fmtMin(t.post_atencion_ms)} sub="sobre pacientes ya cerrados" />
        <Tile label="Cola post-turno" value={fmtMin(t.cola_post_turno_ms)} sub="SAP tras el último paciente" />
        <Tile label="Espera de SAP" value={fmtSeg(t.sap_wait_ms_total)} sub={`${fmtNum(t.sap_roundtrips)} round-trips`} />
        <Tile label="Pantalla lista p50 · p95" value={`${fmtSeg(t.ready_ms_p50)} · ${fmtSeg(t.ready_ms_p95)}`} sub={`${t.visitas} visitas · ${t.pantallas_distintas} pantallas`} />
        <Tile label="Duración por consulta" value={fmtMin(t.consulta_ms_mediana)} sub="mediana, reloj de pared" />
        <Tile label="Hasta el siguiente paciente" value={fmtMin(t.entre_consultas_ms_mediana)} sub="mediana" />
        <Tile label="Pacientes por hora" value={fmtNum(t.consultas_por_hora, 1)} />
        <Tile label="Interrupciones" value={fmtNum(t.interrupciones)} sub="vueltas a un paciente ya abierto" />
        <Tile label="Revisitas de pantalla" value={fmtNum(t.revisitas_sap)} sub="idas y vueltas en SAP" />
        <Tile label="Carga en SAP" value={fmtPct(t.carga_admin_pct)} sub="del tiempo activo" />
        <Tile label="Copiar · pegar" value={`${fmtNum(t.copias)} · ${fmtNum(t.pegados)}`} />
        <Tile label="Correcciones" value={fmtNum(t.correcciones)} sub="Backspace + Supr" />
        <Tile label="Tab · Enter" value={`${fmtNum(t.tabs)} · ${fmtNum(t.enters)}`} />
        <Tile label="Guardados (Ctrl+S)" value={fmtNum(t.guardados)} />
      </div>

      <Seccion titulo="Línea de tiempo" sub="Minutos activos en cada tramo de 5 minutos, por aplicación. Las marcas de abajo son pacientes abiertos en SAP.">
        <LineaDeTiempo bins={bins} inicio={t.started_at} fin={t.ended_at}
          marcas={eventos.filter((e) => e.kind === "encounter_enter").map((e) => ({ t: e.occurred_at, encounter_key: e.encounter_key, kind: e.kind }))} />
      </Seccion>

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion titulo="Reparto por aplicación">
          <table className="tabla">
            <thead><tr><th>App</th><th className="num">Activo</th><th className="num">%</th></tr></thead>
            <tbody>
              {apps.map(([app, ms]) => (
                <tr key={app}>
                  <td className="text-ink"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: colorApp(app) }} />{etiquetaApp(app)}</td>
                  <td className="num">{fmtMin(ms)}</td>
                  <td className="num">{Math.round((Number(ms) / totalApps) * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Seccion>
        <Seccion titulo="Calidad del instrumento en este turno" sub="Lo que el medidor dejó de ver. Un turno con cobertura < 85 %, saltos de reloj o descartes no entra a las comparaciones.">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Cobertura</dt><dd className="tabular text-ink">{fmtPct(t.cobertura_pct)}</dd>
            <dt className="text-muted">Huecos del reloj</dt><dd className="tabular text-ink">{fmtSeg(t.huecos_ms)}</dd>
            <dt className="text-muted">Saltos de reloj</dt><dd className="tabular text-ink">{fmtNum(t.clock_jumps)}</dd>
            <dt className="text-muted">Datos descartados (disco lleno)</dt><dd className="tabular text-ink">{fmtNum(t.spool_dropped)}</dd>
            <dt className="text-muted">Ganchos de teclado/ratón</dt><dd className="text-ink">{t.hooks_degradados ? "degradados (sin conteo de clics/teclas)" : "ok"}</dd>
            <dt className="text-muted">Ticks SAP saltados (ocupado)</dt><dd className="tabular text-ink">{fmtNum(t.ticks_sap_saltados_busy)}</dd>
            <dt className="text-muted">Versión del medidor</dt><dd className="text-ink">{t.app_version || "—"}</dd>
          </dl>
        </Seccion>
      </div>

      <Seccion titulo={`Pacientes del turno (${pacientes.length})`} sub="Cada paciente es una huella irreversible calculada en el PC — nunca un nombre ni un documento. Sirve para saber que dos momentos son la misma consulta.">
        {pacientes.length === 0 ? <p className="text-sm text-muted">Sin pacientes identificados. Si SAP estaba abierto, revisa la regla de extracción en Configuración.</p> : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Huella</th><th>Primera vez</th><th>Última vez</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Escrib.</th><th className="num">Clics</th><th className="num">Pantallas</th><th className="num">Post-atención</th></tr></thead>
              <tbody>
                {pacientes.map((p) => (
                  <tr key={p.encounter_key}>
                    <td className="font-mono text-xs text-secondary">{p.encounter_key.slice(0, 12)}…</td>
                    <td className="tabular">{fmtHora(p.primera)}</td>
                    <td className="tabular">{fmtHora(p.ultima)}</td>
                    <td className="num">{fmtMin(p.active_ms)}</td>
                    <td className="num">{fmtMin(p.his_ms)}</td>
                    <td className="num">{fmtMin(p.typing_ms)}</td>
                    <td className="num">{fmtNum(p.clicks)}</td>
                    <td className="num">{fmtNum(p.pantallas)} <span className="text-muted">({p.visitas} visitas)</span></td>
                    <td className="num">{fmtMin(p.post_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion titulo={`Recorrido por SAP (${visitas.length} pantallas)`} sub="Cada fila es una estadía en una pantalla: cuánto duró, cuánto tardó SAP en dejarla lista, cuánto se esperó al servidor, y a dónde se fue después.">
        {visitas.length === 0 ? <p className="text-sm text-muted">Sin visitas SAP. O no se usó SAP, o el scripting de SAP GUI no está habilitado en ese PC (el medidor igual cuenta el tiempo en SAP como app).</p> : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Hora</th><th>Transacción</th><th>Pantalla</th><th>Paciente</th><th className="num">Estadía</th><th className="num">Lista en</th><th className="num">Espera</th><th className="num">Round-trips</th><th>Siguiente</th></tr></thead>
              <tbody>
                {visitas.map((v, i) => (
                  <tr key={i}>
                    <td className="tabular">{fmtHora(v.entered_at)}</td>
                    <td className="font-mono text-xs text-ink">{v.tcode}</td>
                    <td className="font-mono text-xs text-secondary" title={v.surface}>{v.surface.replace(/^sapgui:\/\/[^/]+\//, "")}</td>
                    <td className="font-mono text-xs text-muted">{v.encounter_key ? v.encounter_key.slice(0, 8) + "…" : "—"}</td>
                    <td className="num">{fmtSeg(v.dwell_ms)}</td>
                    <td className="num">{fmtSeg(v.ready_ms)}</td>
                    <td className="num">{fmtSeg(v.sap_wait_ms)}</td>
                    <td className="num">{fmtNum(v.roundtrips)}</td>
                    <td className="font-mono text-xs text-secondary">{v.exit_to ?? "salió de SAP"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion titulo={`Eventos (${eventos.length})`}>
        <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {eventos.map((e, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="w-12 shrink-0 font-mono text-xs text-muted">{fmtHora(e.occurred_at)}</span>
              <span className="text-ink">{ETIQUETA_EVENTO[e.kind] ?? e.kind}</span>
              {Object.keys(e.detail ?? {}).length > 0 && <span className="text-xs text-muted">{Object.entries(e.detail).map(([k, v]) => `${k}=${v}`).join(" ")}</span>}
              {e.encounter_key && <span className="font-mono text-xs text-muted">{e.encounter_key.slice(0, 8)}…</span>}
            </li>
          ))}
        </ul>
      </Seccion>
    </div>
  );
}
