import Link from "next/link";
import { AutoRefresco } from "@/components/AutoRefresco";
import { LineaDeTiempoDia } from "@/components/LineaDeTiempoDia";
import { Calidad, ChipFase, Insignia, Seccion, Tile, Vacio } from "@/components/ui";
import { lineaDeTiempoDia } from "@/lib/consultas";
import { hoyOperativo, leerFecha, sumarDias, type Sp } from "@/lib/filtros";
import { ETIQUETA_EVENTO, fmtFecha, fmtHora, fmtMin, fmtNum, fmtPct, fmtSeg, glifoEvento } from "@/lib/formato";
import { indicePacientes, ventanaAuto, ventanaDesdeQuery } from "@/lib/linea-tiempo";
import { totalesPorEstado } from "@/lib/segmentos";

const ETIQUETA_CALIDAD: Record<string, string> = {
  cobertura_pct: "Cobertura", sin_datos_ms: "Sin datos (huecos > 30 s)", huecos_ms: "Huecos del reloj del medidor", clock_jumps: "Saltos de reloj",
  spool_dropped: "Datos descartados (disco lleno)", hooks_degradados: "Ganchos de teclado/ratón degradados", hooks_rearmados: "Ganchos rearmados",
  ticks_sap_saltados_busy: "Ticks SAP saltados (ocupado)", sap_scripting: "SAP GUI Scripting disponible", sap_eventos_com: "Eventos COM de SAP enganchados",
  procesos: "Arranques del medidor", relanzos: "Relanzos",
};
const fmtCalidad = (k: string, v: number | boolean | null) =>
  v == null ? "—" : typeof v === "boolean" ? (v ? "sí" : "no") : k.endsWith("_ms") ? fmtSeg(v) : k.endsWith("_pct") ? fmtPct(v) : fmtNum(v);
const uno = (sp: Sp, k: string): string | null => { const v = sp[k]; const s = Array.isArray(v) ? v[0] : v; return s || null; };
const colorPaciente = (n: number) => (n % 2 === 1 ? "var(--color-pac-a)" : "var(--color-pac-b)");

/**
 * EL DÍA DE UN CONSULTORIO: la línea de tiempo completa (estado · app · pantallas SAP ·
 * pacientes · eventos), los totales del día, los pacientes (huellas, no nombres) con el
 * mismo P# que las bandas, el recorrido por SAP, los eventos y la calidad del instrumento.
 * La fecha viaja en la URL (`?fecha=`), y el zoom también (`?desde=HH:MM&hasta=HH:MM`).
 */
export default async function ConsultorioDiaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Sp> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Vacio titulo="Consultorio no encontrado" texto="El identificador no tiene forma de consultorio." />;

  const hoy = hoyOperativo();
  const fecha = leerFecha(sp);
  const esHoy = fecha === hoy;
  const ahora = new Date().toISOString();
  const datos = await lineaDeTiempoDia(id, fecha);
  if (!datos) return <Vacio titulo="Consultorio no encontrado" texto="Puede que se haya borrado o que el enlace sea viejo. Los consultorios se administran en Configuración." />;

  const zoom = { desde: uno(sp, "desde"), hasta: uno(sp, "hasta") };
  const ventana = ventanaDesdeQuery(ventanaAuto(datos, ahora), fecha, zoom.desde, zoom.hasta);
  const r = datos.resumen;
  const tot = totalesPorEstado(datos.segmentos);
  const indice = indicePacientes(datos.segmentos, datos.pacientes);
  const hayDatos = datos.segmentos.length > 0;
  const href = (f: string) => `/consultorios/${id}?fecha=${f}`;
  const calidad = Object.entries(r?.calidad ?? {}).filter(([k]) => k in ETIQUETA_CALIDAD);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-accent hover:underline print:hidden">← Inicio</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{datos.consultorio.nombre} · {fmtFecha(fecha)}</h1>
          <nav aria-label="Cambiar de día" className="flex flex-wrap items-center gap-1 text-sm print:hidden">
            <Link href={href(sumarDias(fecha, -1))} className="boton">◀ ayer</Link>
            {esHoy ? <span className="boton opacity-50" aria-disabled="true">hoy</span> : <Link href={href(hoy)} className="boton">hoy</Link>}
            {esHoy ? <span className="boton opacity-50" aria-disabled="true">mañana ▶</span> : <Link href={href(sumarDias(fecha, 1))} className="boton">mañana ▶</Link>}
            <form method="get" className="ml-1 flex items-center gap-1">
              <input type="date" name="fecha" defaultValue={fecha} max={hoy} className="campo" aria-label="Fecha" />
              <button className="boton">Ir</button>
            </form>
          </nav>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          {datos.device && <Insignia tono="neutro" title="PC asignado ese día">{datos.device.machine_name || "PC sin nombre"}</Insignia>}
          {r?.app_version && <Insignia tono="neutro" title="Versión del medidor">v{r.app_version}</Insignia>}
          {r && <ChipFase fase={r.phase} />}
          {r && <Calidad ok={r.calidad_ok} cobertura={r.cobertura_pct} />}
          {r && !r.calidad_ok && r.calidad_motivos?.length > 0 && <span className="text-xs">motivos: {r.calidad_motivos.join(", ")}</span>}
          {datos.medicos_vistos.map((m, i) => (
            <Insignia key={i} tono="ok" title={`usuario SAP ${m.sap_user}`}>{m.nombre ?? m.sap_user} · {fmtHora(m.desde)}–{fmtHora(m.hasta)}</Insignia>
          ))}
          {esHoy && <span className="ml-auto print:hidden"><AutoRefresco ahora={ahora} /></span>}
        </div>
      </div>

      {!hayDatos ? (
        <Vacio titulo={`Sin datos el ${fmtFecha(fecha)}`} texto={datos.device || esHoy
          ? "No llegó ninguna cubeta de 15 s ese día: el PC estuvo apagado, sin red, o el medidor no corría. Si es hoy, espera un minuto."
          : "Ese día ningún PC estaba asignado a este consultorio. Los PCs se asignan en Dispositivos."} />
      ) : (
        <>
          <Seccion titulo="Línea de tiempo" sub="Cada cubeta de 15 s en uno de cuatro estados; encima, la app delante, las pantallas SAP con su espera, los pacientes (P1, P2… huellas, no nombres) y los eventos del medidor. Pasa el cursor para el detalle.">
            <LineaDeTiempoDia datos={datos} modo="completo" ventana={ventana} ahora={ahora} zoom={zoom} />
          </Seccion>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Tile label="Activo en el PC" value={fmtMin(r?.activo_ms)} sub={r ? `cobertura ${fmtPct(r.cobertura_pct)} · ${fmtNum(r.tramos)} tramo${r.tramos === 1 ? "" : "s"}` : "resumen pendiente (se calcula cada 5 min)"} hero />
            <Tile label="En SAP (HIS)" value={fmtMin(r?.his_ms)} sub={r ? `${fmtPct(r.carga_admin_pct)} del activo · Miracle ${fmtMin(r.miracle_ms)}` : undefined} />
            <Tile label="Escribiendo" value={fmtMin(r?.typing_ms)} sub={r ? `${fmtNum(r.keystrokes)} teclas · ${fmtNum(r.clicks)} clics` : undefined} />
            <Tile label="Pacientes" value={fmtNum(r?.pacientes ?? datos.pacientes.length)} sub={r ? `${fmtNum(r.pacientes_por_hora, 1)} por hora · ${fmtNum(r.interrupciones)} interrupciones` : `${datos.pacientes.length} en las cubetas`} />
            <Tile label="Consulta (mediana)" value={fmtMin(r?.consulta_ms_mediana)} sub="reloj de pared, del primer al último toque" />
            <Tile label="Espera de SAP" value={fmtSeg(r?.sap_wait_ms)} sub={r ? `${fmtNum(r.sap_roundtrips)} round-trips` : undefined} />
            <Tile label="Pantalla lista p50 · p95" value={`${fmtSeg(r?.ready_ms_p50)} · ${fmtSeg(r?.ready_ms_p95)}`} sub={r ? `${fmtNum(r.visitas)} visitas · ${fmtNum(r.pantallas_distintas)} pantallas` : undefined} />
            <Tile label="Bloqueado" value={fmtMin(tot.bloqueado)} sub="sesión de Windows bloqueada" />
            <Tile label="Sin datos" value={fmtMin(tot.sin_datos)} tono={tot.sin_datos > 0 ? "critico" : undefined} sub="huecos entre cubetas: PC apagado, suspendido o medidor caído" />
            <Tile label="Hasta el siguiente paciente" value={fmtMin(r?.entre_consultas_ms_mediana)} sub={r ? `post-atención ${fmtMin(r.post_atencion_ms)}` : undefined} />
            <Tile label="Arranque del día" value={fmtMin(r?.pre_atencion_ms)} sub="activo antes de abrir al primer paciente" />
            <Tile label="Cola de documentación" value={fmtMin(r?.cola_post_jornada_ms)} sub={r ? `en SAP tras abrir al último paciente · consulta p25–p75 ${fmtMin(r.consulta_ms_p25)} – ${fmtMin(r.consulta_ms_p75)}` : "en SAP tras abrir al último paciente"} />
          </div>

          <Seccion titulo={`Pacientes (${datos.pacientes.length})`} sub="Cada paciente es una huella irreversible calculada en el PC — nunca un nombre ni un documento. El P# es el mismo de las bandas de la línea de tiempo.">
            {datos.pacientes.length === 0 ? <p className="text-sm text-muted">Sin pacientes identificados. Si SAP estaba abierto, revisa la regla de extracción en Configuración o si el PC tiene SAP GUI Scripting.</p> : (
              <div className="overflow-x-auto">
                <table className="tabla">
                  <thead><tr><th>P#</th><th>Huella</th><th>Primera vez</th><th>Última vez</th><th className="num">Consulta</th><th className="num">Activo</th><th className="num">Visitas SAP</th><th className="num">Tramos</th></tr></thead>
                  <tbody>
                    {datos.pacientes.map((p) => {
                      const n = indice[p.encounter_key];
                      return (
                        <tr key={p.encounter_key}>
                          <td className="whitespace-nowrap font-semibold text-ink"><span className="linea-dia__muestra" style={{ background: colorPaciente(n) }} aria-hidden />P{n}</td>
                          <td className="font-mono text-xs text-secondary">{p.encounter_key.slice(0, 12)}…</td>
                          <td className="tabular">{fmtHora(p.primera_vez)}</td>
                          <td className="tabular">{fmtHora(p.ultima_vez)}</td>
                          <td className="num">{fmtMin(p.consulta_ms)}</td>
                          <td className="num">{fmtMin(p.activo_ms)}</td>
                          <td className="num">{fmtNum(p.visitas)}</td>
                          <td className="num">{fmtNum(p.tramos)}{p.tramos > 1 && <span className="text-muted" title="volvió a este paciente después de abrir otro"> ↩</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>

          <Seccion titulo={`Recorrido por SAP (${datos.visitas.length} pantallas)`} sub="Cada fila es una estadía en una pantalla: cuánto duró, cuánto tardó SAP en dejarla lista, cuánto se esperó al servidor, y a dónde se fue después.">
            {datos.visitas.length === 0 ? <p className="text-sm text-muted">Sin visitas SAP. O no se usó SAP, o el scripting de SAP GUI no está habilitado en ese PC (el medidor igual cuenta el tiempo en SAP como app).</p> : (
              <div className="max-h-[32rem] overflow-auto">
                <table className="tabla">
                  <thead><tr><th>Hora</th><th>Transacción</th><th>Pantalla</th><th>Paciente</th><th>Usuario</th><th className="num">Estadía</th><th className="num">Lista en</th><th className="num">Espera</th><th className="num">Round-trips</th><th>Siguiente</th></tr></thead>
                  <tbody>
                    {datos.visitas.map((v) => (
                      <tr key={v.visit_uid}>
                        <td className="tabular">{fmtHora(v.entered_at)}</td>
                        <td className="font-mono text-xs text-ink">{v.tcode || "—"}</td>
                        <td className="font-mono text-xs text-secondary" title={v.surface}>{v.surface.replace(/^sapgui:\/\/[^/]+\//, "")}</td>
                        <td className="font-mono text-xs text-muted">{v.encounter_key ? (indice[v.encounter_key] ? `P${indice[v.encounter_key]}` : v.encounter_key.slice(0, 8) + "…") : "—"}</td>
                        <td className="font-mono text-xs text-muted">{v.sap_user ?? "—"}</td>
                        <td className="num">{fmtSeg(v.dwell_ms)}</td>
                        <td className="num">{fmtSeg(v.ready_ms)}</td>
                        <td className="num">{fmtSeg(v.sap_wait_ms)}</td>
                        <td className="num">{fmtNum(v.roundtrips)}</td>
                        <td className="font-mono text-xs text-secondary">{v.exit_to ?? (v.left_at ? "salió de SAP" : "abierta")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>

          <details className="tarjeta p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Eventos ({datos.marcas.length})</summary>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {datos.marcas.map((e, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-12 shrink-0 font-mono text-xs text-muted">{fmtHora(e.t)}</span>
                  <span className="w-4 shrink-0 text-center font-mono text-xs text-secondary" aria-hidden>{glifoEvento(e.kind, e.detail)}</span>
                  <span className="text-ink">{ETIQUETA_EVENTO[e.kind] ?? e.kind}</span>
                  {Object.keys(e.detail ?? {}).length > 0 && <span className="text-xs text-muted">{Object.entries(e.detail).map(([k, v]) => `${k}=${v}`).join(" ")}</span>}
                </li>
              ))}
              {datos.marcas.length === 0 && <li className="text-muted">Sin eventos ese día.</li>}
            </ul>
          </details>

          <details className="tarjeta p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Calidad del instrumento</summary>
            <p className="mt-1 text-xs text-muted">Lo que el medidor dejó de ver. Una jornada con cobertura &lt; 80 %, más de dos saltos de reloj o datos descartados no entra a las comparaciones.</p>
            {r ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
                {calidad.map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted">{ETIQUETA_CALIDAD[k]}</dt><dd className="tabular text-ink">{fmtCalidad(k, v)}</dd></div>
                ))}
                <div><dt className="text-xs text-muted">Versión del medidor</dt><dd className="text-ink">{r.app_version || "—"}</dd></div>
                <div><dt className="text-xs text-muted">Resumido</dt><dd className="text-ink">{r.resumido_en ? fmtHora(r.resumido_en) : "—"}{r.sucia ? " · pendiente de recalcular" : ""}</dd></div>
              </dl>
            ) : <p className="mt-3 text-sm text-muted">Todavía no hay resumen de esta jornada: se calcula como máximo cada 5 minutos mientras llegan datos.</p>}
          </details>
        </>
      )}
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
