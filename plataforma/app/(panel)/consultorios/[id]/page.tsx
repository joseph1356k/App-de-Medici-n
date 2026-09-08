import Link from "next/link";
import { AutoRefresco } from "@/components/AutoRefresco";
import { Cifra } from "@/components/Cifra";
import { LineaDeTiempoDia } from "@/components/LineaDeTiempoDia";
import { Barras } from "@/components/graficos/Barras";
import { Columnas } from "@/components/graficos/Columnas";
import { Interactivo } from "@/components/graficos/Interactivo";
import { CabeceraPagina, Calidad, ChipFase, Insignia, Seccion, Vacio } from "@/components/ui";
import { topN } from "@/lib/graficos";
import { cargaDeSap, corregido, delanteSinTocar, esperaPorPantalla, fueraDelHis, pantallasPorHora, ritmoDeTecleo } from "@/lib/metricas";
import { encuentrosDelDia, lineaDeTiempoDia } from "@/lib/consultas";
import { hoyOperativo, leerFecha, sumarDias, type Sp } from "@/lib/filtros";
import { ETIQUETA_EVENTO, colorApp, etiquetaApp, fmtFecha, fmtHora, fmtHoras, fmtMin, fmtNum, fmtPct, fmtSeg, glifoEvento } from "@/lib/formato";
import { indicePacientes, leerDetalle, ventanaAuto, ventanaDesdeQuery } from "@/lib/linea-tiempo";
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
  const [datos, encuentros] = await Promise.all([lineaDeTiempoDia(id, fecha), encuentrosDelDia(id, fecha)]);
  if (!datos) return <Vacio titulo="Consultorio no encontrado" texto="Puede que se haya borrado o que el enlace sea viejo. Los consultorios se administran en Configuración." />;

  const zoom = { desde: uno(sp, "desde"), hasta: uno(sp, "hasta") };
  const detalle = leerDetalle(uno(sp, "detalle"));
  const ventana = ventanaDesdeQuery(ventanaAuto(datos, ahora), fecha, zoom.desde, zoom.hasta);
  const r = datos.resumen;
  const tot = totalesPorEstado(datos.segmentos);
  const indice = indicePacientes(datos.segmentos, datos.pacientes);
  const hayDatos = datos.segmentos.length > 0;
  const href = (f: string) => `/consultorios/${id}?fecha=${f}`;
  const calidad = Object.entries(r?.calidad ?? {}).filter(([k]) => k in ETIQUETA_CALIDAD);
  const hayPacientes = (r?.pacientes ?? 0) > 0;

  // El perfil por horas y el reparto por app salen de la MISMA fila del resumen: dos gráficos más
  // sin una consulta más.
  const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const det = r?.por_hora_detalle ?? {};
  const perfilDelDia = Object.keys(det).length === 0 ? [] : [
    { id: "sap", nombre: "SAP (HIS)", color: "var(--color-perfil-sap)", valores: HORAS.map((h) => Number(det[h]?.sap ?? 0)) },
    { id: "otras", nombre: "Otras apps", color: "var(--color-perfil-otras)", valores: HORAS.map((h) => Number(det[h]?.otras ?? 0)) },
    { id: "inactivo", nombre: "Encendido sin uso", color: "var(--color-perfil-inactivo)", valores: HORAS.map((h) => Number(det[h]?.inactivo ?? 0)) },
  ];

  const apps = Object.entries(r?.activo_por_app ?? {})
    .filter(([app, ms]) => app !== "bloqueado" && Number(ms) > 0)
    .map(([app, ms]) => ({ app, ms: Number(ms) }));
  const appsTop = topN(apps, 6, (a) => a.ms, (suma, cuantos) => ({ app: `resto (${cuantos})`, ms: suma }));
  const totalApps = Math.max(1, appsTop.reduce((s, a) => s + a.ms, 0));
  const filaApps = {
    id: "dia", etiqueta: fmtFecha(fecha), texto: fmtHoras(totalApps),
    partes: appsTop.map((a) => ({
      id: a.app, nombre: etiquetaApp(a.app), valor: a.ms,
      color: a.app.startsWith("resto") ? "var(--color-otro)" : colorApp(a.app),
      texto: fmtPct((a.ms / totalApps) * 100), extra: fmtMin(a.ms),
    })),
  };

  // Los ENCUENTROS son la fuente buena (los calcula el resumen: SAP, tecleo, clics,
  // post-atención, hueco hasta el siguiente). Mientras el resumen no haya corrido todavía
  // —los primeros minutos de un día en curso— caen los pacientes derivados de las cubetas,
  // que traen menos columnas pero existen ya. Las que faltan van en «—», nunca en cero.
  const filasPacientes = encuentros.length > 0
    ? encuentros.map((e) => ({
        key: e.encounter_key, n: indice[e.encounter_key] ?? e.orden, primera: e.primera_vez, ultima: e.ultima_vez,
        consulta: e.consulta_ms, activo: e.activo_ms, his: e.his_ms, typing: e.typing_ms, keystrokes: e.keystrokes, clicks: e.clicks,
        visitas: e.visitas, pantallas: e.pantallas_distintas, post: e.post_atencion_ms, siguiente: e.siguiente_ms,
        tramos: e.tramos, quien: e.medico ?? e.sap_user,
      }))
    : datos.pacientes.map((p) => ({
        key: p.encounter_key, n: indice[p.encounter_key], primera: p.primera_vez, ultima: p.ultima_vez,
        consulta: p.consulta_ms, activo: p.activo_ms, his: null, typing: null, keystrokes: null, clicks: null,
        visitas: p.visitas, pantallas: null, post: null, siguiente: null, tramos: p.tramos, quien: null,
      }));

  return (
    <div className="space-y-6">
      <div>
        <CabeceraPagina
          eyebrow={datos.consultorio.nombre}
          titulo={fmtFecha(fecha)}
          acciones={
            <nav aria-label="Cambiar de día" className="flex flex-wrap items-center gap-1 text-sm">
              <Link href={href(sumarDias(fecha, -1))} className="boton">◀ ayer</Link>
              {esHoy ? <span className="boton opacity-50" aria-disabled="true">hoy</span> : <Link href={href(hoy)} className="boton">hoy</Link>}
              {esHoy ? <span className="boton opacity-50" aria-disabled="true">mañana ▶</span> : <Link href={href(sumarDias(fecha, 1))} className="boton">mañana ▶</Link>}
              <form method="get" className="ml-1 flex items-center gap-1">
                <input type="date" name="fecha" defaultValue={fecha} max={hoy} className="campo" aria-label="Fecha" />
                <button className="boton">Ir</button>
              </form>
            </nav>
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Link href="/" className="text-accent hover:underline print:hidden">← Inicio</Link>
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
          <Seccion titulo="Línea de tiempo" sub="Cada cubeta de 15 s en uno de cuatro estados; encima, la app delante, las pantallas SAP con su espera, los pacientes (P1, P2… huellas, no nombres) y los eventos del medidor. «Tamaño» la abre a 2× o 4× del ancho (con desplazamiento propio); un clic en una hora del eje amplía esa hora.">
            <LineaDeTiempoDia datos={datos} modo="completo" ventana={ventana} ahora={ahora} zoom={zoom} detalle={detalle} />
          </Seccion>

          {/* NIVEL 0 y 1 — lo que resume el día, y lo importante. El orden no es decorativo: antes
              estas doce cifras iban todas del mismo tamaño y en la misma rejilla, así que «Sin
              datos: 0 min» pesaba lo mismo que «Activo: 9 h». */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Cifra clase="xl:col-span-2" etiqueta="Activo en el PC" valor={fmtMin(r?.activo_ms)} variante="hero"
              reparto={r ? [
                { nombre: "SAP", valor: r.his_ms, color: "var(--color-perfil-sap)" },
                { nombre: "Otras apps", valor: fueraDelHis(r), color: "var(--color-perfil-otras)" },
                { nombre: "Miracle", valor: r.miracle_ms, color: "var(--color-s2)" },
              ] : undefined}
              sub={r ? `cobertura ${fmtPct(r.cobertura_pct)} · ${fmtNum(r.tramos)} tramo${r.tramos === 1 ? "" : "s"} de actividad` : "resumen pendiente (se calcula cada 5 min)"} />
            <Cifra etiqueta="En SAP (HIS)" valor={fmtMin(r?.his_ms)} sub={r ? `${fmtNum(r.visitas)} visitas · ${fmtNum(r.pantallas_distintas)} pantallas distintas` : undefined} />
            <Cifra etiqueta="Carga de SAP" valor={fmtPct(r ? cargaDeSap(r) : null)} sub="del tiempo activo" />
            <Cifra etiqueta="Escribiendo" valor={fmtMin(r?.typing_ms)} sub={r ? `${fmtNum(r.keystrokes)} teclas · ${fmtNum(r.clicks)} clics` : undefined} />
            <Cifra etiqueta="Fuera de SAP" valor={fmtMin(r ? fueraDelHis(r) : null)} sub="trabajo activo fuera del HIS y de Miracle" />
            <Cifra etiqueta="Espera de SAP" valor={fmtSeg(r?.sap_wait_ms)} sub={r ? `${fmtNum(r.sap_roundtrips)} round-trips · ${fmtSeg(esperaPorPantalla(r))} por pantalla` : undefined} />
            <Cifra etiqueta="Pantalla lista p95" valor={fmtSeg(r?.ready_ms_p95)} sub={r ? `mediana ${fmtSeg(r.ready_ms_p50)}` : undefined} />
            <Cifra etiqueta="Delante sin tocar" valor={fmtMin(r ? delanteSinTocar(r) : null)} sub="la pantalla delante, sin input: leer y esperar" />
            <Cifra etiqueta="Encendido sin uso" valor={fmtMin(r?.inactivo_ms)} sub="desbloqueado y sin que nadie lo toque" />
            <Cifra etiqueta="Bloqueado" valor={fmtMin(tot.bloqueado)} sub="sesión de Windows bloqueada" />
            {tot.sin_datos > 0 && (
              <Cifra etiqueta="Sin datos" valor={fmtMin(tot.sin_datos)} tono="critico"
                sub="huecos entre cubetas: PC apagado, suspendido o medidor caído" />
            )}
          </div>

          {/* Los dos gráficos del día. No cuestan una consulta más: `por_hora_detalle` y `por_app`
              ya vienen en la fila del resumen. */}
          {r && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Seccion titulo="La forma del día" sub="Minutos por hora de Bogotá: cuánto en SAP, cuánto en otras apps y cuánto con el PC encendido sin que nadie lo toque.">
                {perfilDelDia.length === 0 ? <p className="text-sm text-muted">Este día se resumió antes de que existiera el perfil por horas.</p> : (
                  <Interactivo modo="cruceta">
                    <Columnas ancho={560} alto={200} xs={HORAS} etiquetaX={(h) => h} etiquetaLarga={(h) => `${h}:00 – ${h}:59`}
                      series={perfilDelDia} fmt={(v) => `${Math.round(v / 60000)} min`}
                      ariaLabel="La forma del día por horas" cabeceraTabla="Hora" />
                  </Interactivo>
                )}
              </Seccion>
              <Seccion titulo="En qué se fue el tiempo" sub="El reparto del tiempo activo por aplicación. Una app que no esté en el catálogo aparece con el nombre de su programa.">
                {filaApps.partes.length === 0 ? <p className="text-sm text-muted">Sin actividad por app este día.</p> : (
                  <Interactivo modo="marca">
                    <Barras modo="cien" leyenda filas={[filaApps]} ariaLabel="Reparto del tiempo activo por app" cabeceraTabla="Día" />
                  </Interactivo>
                )}
              </Seccion>
            </div>
          )}

          {/* NIVEL 2 — la actividad, para hojear. Catorce columnas que se medían desde el primer
              día y no aparecían en ninguna parte. */}
          <Seccion titulo="La actividad, al detalle" sub="Lo que se contó tecla a tecla y clic a clic. Copiar y pegar importan: son la señal de que algo se redacta fuera de SAP y se pega dentro.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Cifra variante="menor" etiqueta="Teclas" valor={fmtNum(r?.keystrokes)} sub={`${fmtNum(ritmoDeTecleo(r ?? {}), 0)} por minuto escribiendo`} />
              <Cifra variante="menor" etiqueta="Clics" valor={fmtNum(r?.clicks)} />
              <Cifra variante="menor" etiqueta="Corregido" valor={fmtPct(r ? corregido(r) : null)} sub={`${fmtNum(r?.correcciones)} borrados`} />
              <Cifra variante="menor" etiqueta="Copiar · pegar" valor={`${fmtNum(r?.copias)} · ${fmtNum(r?.pegados)}`} />
              <Cifra variante="menor" etiqueta="Guardados" valor={fmtNum(r?.guardados)} />
              <Cifra variante="menor" etiqueta="Tab · Enter" valor={`${fmtNum(r?.tabs)} · ${fmtNum(r?.enters)}`} />
              <Cifra variante="menor" etiqueta="Cambios de contexto" valor={fmtNum(r?.context_switches)} sub="saltos de app, pantalla o paciente" />
              <Cifra variante="menor" etiqueta="Scroll" valor={fmtNum(r?.scroll_ticks)} />
              <Cifra variante="menor" etiqueta="Revisitas SAP" valor={fmtNum(r?.revisitas_sap)} sub="volver a una pantalla ya vista" />
              <Cifra variante="menor" etiqueta="Pantallas por hora" valor={fmtNum(r ? pantallasPorHora(r) : null, 1)} sub="por hora de actividad" />
              <Cifra variante="menor" etiqueta="En tramos de actividad" valor={fmtMin(r?.tramos_ms)} />
              <Cifra variante="menor" etiqueta="Ventana del día" valor={fmtMin(r?.ventana_ms)} sub="de la primera a la última cubeta activa" />
            </div>
          </Seccion>

          {/* NIVEL 3 — lo que todavía no se puede medir, y POR QUÉ. Sube solo a nivel 1 el día que
              la regla de identidad funcione: la página no hay que volver a tocarla. */}
          {hayPacientes ? (
            <Seccion titulo="Por paciente" sub="Lo que costó cada consulta, medido sobre las huellas del día.">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <Cifra etiqueta="Pacientes" valor={fmtNum(r?.pacientes)} sub={`${fmtNum(r?.pacientes_por_hora, 1)} por hora de actividad`} />
                <Cifra etiqueta="Consulta (mediana)" valor={fmtMin(r?.consulta_ms_mediana)} sub={`p25–p75 ${fmtMin(r?.consulta_ms_p25)} – ${fmtMin(r?.consulta_ms_p75)}`} />
                <Cifra etiqueta="Activo por paciente" valor={fmtMin(r?.activo_por_paciente_mediana)} />
                <Cifra etiqueta="Hasta el siguiente" valor={fmtMin(r?.entre_consultas_ms_mediana)} />
                <Cifra etiqueta="Post-atención" valor={fmtMin(r?.post_atencion_ms)} sub={`${fmtNum(r?.interrupciones)} interrupciones`} />
                <Cifra etiqueta="Arranque · cola" valor={`${fmtMin(r?.pre_atencion_ms)} · ${fmtMin(r?.cola_post_jornada_ms)}`} sub="antes del primer paciente · en SAP tras el último" />
              </div>
            </Seccion>
          ) : (
            <Seccion titulo="Todavía sin datos" sub="Ocho métricas del estudio dependen de identificar al paciente en la pantalla de SAP, y hoy no se identifica ninguno.">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
                {["Pacientes", "Consulta (mediana)", "Activo por paciente", "Hasta el siguiente", "Post-atención", "Arranque del día", "Cola de documentación", "Interrupciones"]
                  .map((e) => <Cifra key={e} variante="apagada" etiqueta={e} valor="—" />)}
              </div>
              <p className="mt-3 text-sm text-secondary">
                La regla busca un número de paciente en el título de la ventana de SAP y no lo encuentra nunca. Se arregla sin
                reinstalar nada desde <Link href="/configuracion" className="text-accent hover:underline">Configuración → Identidad del paciente</Link>,
                que enseña qué forma tiene ese título en los PCs. En cuanto acierte, estas ocho se llenan solas.
              </p>
              {r && r.miracle_ms === 0 && (
                <p className="mt-2 text-sm text-secondary">
                  <strong>En Miracle: 0 min</strong> no es un fallo — el estudio está en fase <em>baseline</em> y Miracle todavía no se usa en el consultorio.
                </p>
              )}
            </Seccion>
          )}

          <Seccion titulo={`Pacientes (${filasPacientes.length})`} sub="Lo que costó cada consulta. El paciente es una huella irreversible calculada en el PC — nunca un nombre ni un documento — y el P# es el mismo de las bandas de la línea de tiempo.">
            {filasPacientes.length === 0 ? <p className="text-sm text-muted">Sin pacientes identificados. Si SAP estaba abierto, revisa la regla de extracción en Configuración o si el PC tiene SAP GUI Scripting.</p> : (
              <>
                <div className="caja-tabla caja-tabla--alta">
                  <table className="tabla tabla--cebra">
                    <thead><tr><th>P#</th><th>Huella</th><th>Primera vez</th><th>Última vez</th><th className="num">Consulta</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Escrib.</th><th className="num">Teclas</th><th className="num">Clics</th><th className="num">Visitas SAP</th><th className="num">Pantallas</th><th className="num">Post-atención</th><th className="num">Al siguiente</th><th className="num">Tramos</th><th>Usuario SAP</th></tr></thead>
                    <tbody>
                      {filasPacientes.map((p) => (
                        <tr key={p.key}>
                          <td className="whitespace-nowrap font-semibold text-ink"><span className="linea-dia__muestra" style={{ background: colorPaciente(p.n) }} aria-hidden />P{p.n}</td>
                          <td className="font-mono text-xs text-secondary">{p.key.slice(0, 12)}…</td>
                          <td className="tabular">{fmtHora(p.primera)}</td>
                          <td className="tabular">{fmtHora(p.ultima)}</td>
                          <td className="num">{fmtMin(p.consulta)}</td>
                          <td className="num">{fmtMin(p.activo)}</td>
                          <td className="num">{fmtMin(p.his)}</td>
                          <td className="num">{fmtMin(p.typing)}</td>
                          <td className="num">{fmtNum(p.keystrokes)}</td>
                          <td className="num">{fmtNum(p.clicks)}</td>
                          <td className="num">{fmtNum(p.visitas)}</td>
                          <td className="num">{fmtNum(p.pantallas)}</td>
                          <td className="num">{fmtMin(p.post)}</td>
                          <td className="num">{fmtMin(p.siguiente)}</td>
                          <td className="num">{fmtNum(p.tramos)}{p.tramos > 1 && <span className="text-muted" title="volvió a este paciente después de abrir otro"> ↩</span>}</td>
                          <td className="font-mono text-xs text-muted">{p.quien ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {encuentros.length === 0 && (
                  <p className="mt-2 text-xs text-muted">Estos pacientes salen de las cubetas: el resumen de la jornada (que añade SAP, tecleo, clics, post-atención y el hueco hasta el siguiente) todavía no ha corrido. Se calcula como máximo cada 5 minutos.</p>
                )}
              </>
            )}
          </Seccion>

          <Seccion titulo={`Recorrido por SAP (${datos.visitas.length} pantallas)`} sub="Cada fila es una estadía en una pantalla: cuánto duró, cuánto tardó SAP en dejarla lista, cuánto se esperó al servidor, y a dónde se fue después.">
            {datos.visitas.length === 0 ? <p className="text-sm text-muted">Sin visitas SAP. O no se usó SAP, o el scripting de SAP GUI no está habilitado en ese PC (el medidor igual cuenta el tiempo en SAP como app).</p> : (
              <div className="caja-tabla caja-tabla--alta">
                <table className="tabla tabla--cebra">
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
