import Link from "next/link";
import { Filtros } from "@/components/Filtros";
import { BarrasPorHora, COLOR_SERIE, Delta, LineasPorDia, type SerieDia } from "@/components/Graficos";
import { Insignia, Seccion, Tile, Vacio } from "@/components/ui";
import {
  cobertura, consultoriosParaFiltro, distribucionConsultas, kpis, kpisPorConsultorio, porAppDetalle, porAppYConsultorio,
  porHoraYConsultorio, porMedico, serieDiaria, type FilaConsultorio, type Kpis, type Medianas,
} from "@/lib/consultas";
import { conFiltro, leerFiltros, periodoPrevio, type Filtros as F, type Sp } from "@/lib/filtros";
import { colorApp, etiquetaApp, fmtFecha, fmtHoras, fmtMin, fmtNum, fmtPct, fmtSeg } from "@/lib/formato";

/**
 * DATOS: la página para mirar y comparar. Está construida sobre tres preguntas, en este orden,
 * porque es el orden en que se miran los datos de verdad:
 *
 *   1. ¿Cómo va? ......... los titulares del rango, con el cambio frente al periodo anterior.
 *   2. ¿Cómo cambia? ..... la tendencia por día, una línea por consultorio.
 *   3. ¿Y en qué se van? . el reparto por app, la forma del día, las consultas, los usuarios.
 *
 * Todo cuelga de UN control de alcance (todos los consultorios / uno) y de UNA fila de filtros,
 * así que cada número de la página está calculado sobre la misma rebanada: si dos bloques no
 * cuadran, es que hay un fallo, no un filtro distinto.
 *
 * Las medianas son POR JORNADA (un consultorio en un día operativo), que es la unidad del
 * estudio: «activo 6 h» significa que la jornada típica tuvo 6 h de PC activo, no que se
 * sumaran 6 h en el rango entero.
 */

/** Las métricas que se comparan entre consultorios, con lo que significa subir. Es una selección
 * a propósito: 31 columnas no se comparan, se hojean (están todas en la tabla del final). */
const COMPARABLES: { clave: keyof Medianas; label: string; fmt: (v: number | null) => string; mejor: "mas" | "menos" | "neutro"; nota: string }[] = [
  { clave: "activo_med", label: "Activo en el PC", fmt: fmtMin, mejor: "neutro", nota: "Tiempo con alguien tocando el PC" },
  { clave: "his_med", label: "En SAP (HIS)", fmt: fmtMin, mejor: "menos", nota: "Del activo, cuánto fue dentro de SAP" },
  { clave: "carga_admin_med", label: "Carga de SAP", fmt: fmtPct, mejor: "menos", nota: "Qué porcentaje del activo se fue en SAP" },
  { clave: "escritura_med", label: "Escribiendo", fmt: fmtMin, mejor: "menos", nota: "Tiempo en ráfagas de tecleo" },
  { clave: "pacientes_med", label: "Pacientes", fmt: fmtNum, mejor: "mas", nota: "Huellas distintas identificadas en SAP" },
  { clave: "consulta_med", label: "Consulta (mediana)", fmt: fmtMin, mejor: "neutro", nota: "De la primera a la última tecla de ese paciente" },
  { clave: "por_paciente_med", label: "Activo por paciente", fmt: fmtMin, mejor: "menos", nota: "Solo el tiempo con input, por paciente" },
  { clave: "entre_consultas_med", label: "Hasta el siguiente", fmt: fmtMin, mejor: "menos", nota: "Hueco entre un paciente y el siguiente" },
  { clave: "post_med", label: "Post-atención", fmt: fmtMin, mejor: "menos", nota: "Trabajo sobre un paciente después de pasar al siguiente" },
  { clave: "espera_sap_med", label: "Espera de SAP", fmt: fmtSeg, mejor: "menos", nota: "Lo que el médico esperó al servidor" },
  { clave: "pantallas_med", label: "Pantallas SAP", fmt: fmtNum, mejor: "menos", nota: "Pantallas distintas recorridas" },
  { clave: "clics_med", label: "Clics", fmt: fmtNum, mejor: "menos", nota: "Clics de ratón" },
  { clave: "cambios_med", label: "Cambios de contexto", fmt: fmtNum, mejor: "menos", nota: "Saltos de app, pantalla o paciente" },
  { clave: "interrupciones_med", label: "Interrupciones", fmt: fmtNum, mejor: "menos", nota: "Consultas que se retomaron después de otra" },
  { clave: "inactivo_med", label: "Encendido sin uso", fmt: fmtMin, mejor: "neutro", nota: "PC desbloqueado y nadie tocándolo" },
  { clave: "cobertura_med", label: "Cobertura del instrumento", fmt: fmtPct, mejor: "mas", nota: "Cuánto del día llegó medido" },
];

/** Las 31 medianas, para la tabla completa del final. */
const TODAS: { clave: keyof Medianas; label: string; fmt: (v: number | null) => string }[] = [
  { clave: "activo_med", label: "Activo", fmt: fmtMin }, { clave: "his_med", label: "En SAP", fmt: fmtMin },
  { clave: "miracle_med", label: "En Miracle", fmt: fmtMin }, { clave: "carga_admin_med", label: "Carga SAP", fmt: fmtPct },
  { clave: "escritura_med", label: "Escribiendo", fmt: fmtMin }, { clave: "clics_med", label: "Clics", fmt: fmtNum },
  { clave: "cambios_med", label: "Cambios de contexto", fmt: fmtNum }, { clave: "pacientes_med", label: "Pacientes", fmt: fmtNum },
  { clave: "pacientes_por_hora_med", label: "Pacientes/hora", fmt: (v) => fmtNum(v, 1) },
  { clave: "consulta_med", label: "Consulta", fmt: fmtMin }, { clave: "por_paciente_med", label: "Activo/paciente", fmt: fmtMin },
  { clave: "entre_consultas_med", label: "Al siguiente", fmt: fmtMin }, { clave: "post_med", label: "Post-atención", fmt: fmtMin },
  { clave: "pre_med", label: "Arranque del día", fmt: fmtMin }, { clave: "cola_med", label: "Cola de documentación", fmt: fmtMin },
  { clave: "interrupciones_med", label: "Interrupciones", fmt: fmtNum }, { clave: "espera_sap_med", label: "Espera SAP", fmt: fmtSeg },
  { clave: "ready_p95_med", label: "Pantalla lista p95", fmt: fmtSeg }, { clave: "pantallas_med", label: "Pantallas distintas", fmt: fmtNum },
  { clave: "revisitas_med", label: "Revisitas SAP", fmt: fmtNum }, { clave: "tabs_med", label: "Tab", fmt: fmtNum },
  { clave: "enters_med", label: "Enter", fmt: fmtNum }, { clave: "correcciones_med", label: "Correcciones", fmt: fmtNum },
  { clave: "copias_med", label: "Copiar", fmt: fmtNum }, { clave: "pegados_med", label: "Pegar", fmt: fmtNum },
  { clave: "guardados_med", label: "Guardados", fmt: fmtNum }, { clave: "tramos_ms_med", label: "En tramos de actividad", fmt: fmtMin },
  { clave: "bloqueado_med", label: "Bloqueado", fmt: fmtMin }, { clave: "inactivo_med", label: "Inactivo", fmt: fmtMin },
  { clave: "sin_datos_med", label: "Sin datos", fmt: fmtMin }, { clave: "cobertura_med", label: "Cobertura", fmt: fmtPct },
];

const MOTIVO: Record<string, string> = {
  cobertura: "Cobertura por debajo del 80 % (faltaban cubetas del día)",
  clock_jumps: "Reloj del PC inestable (más de 2 saltos)",
  spool_dropped: "El PC descartó datos (disco lleno)",
  hooks_degradados: "Ganchos de teclado y ratón degradados",
  sin_actividad: "Jornada sin ninguna actividad",
  en_curso: "Jornada todavía en curso",
};

const METRICAS = [
  { id: "activo", label: "Tiempo activo", campo: "activo_ms" as const, fmt: fmtHoras, unidad: "" },
  { id: "sap", label: "Tiempo en SAP", campo: "his_ms" as const, fmt: fmtHoras, unidad: "" },
  { id: "pacientes", label: "Pacientes", campo: "pacientes" as const, fmt: (v: number) => fmtNum(v), unidad: "" },
];

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));
const uno = (sp: Sp, k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

export default async function DatosPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const f = leerFiltros(sp);
  const metrica = METRICAS.find((m) => m.id === uno(sp, "metrica")) ?? METRICAS[0];
  const metricaEnUrl = metrica.id === METRICAS[0].id ? null : metrica.id;

  // La cobertura primero, y sola: es la que decide si hay algo que enseñar. Si el filtro de
  // calidad dejaría la página en blanco teniendo jornadas, se enseñan igual y se avisa — una
  // página vacía no informa de nada, y el motivo de la exclusión ya se dice arriba.
  const cob = await cobertura(f);
  const rescatando = !f.incluirMala && cob.buenas === 0 && cob.total > 0;
  const fx: F = rescatando ? { ...f, incluirMala: true } : f;

  const [consultorios, k, kPrevio, porC] = await Promise.all([
    consultoriosParaFiltro(), kpis(fx), kpis(periodoPrevio(fx)), kpisPorConsultorio(fx),
  ]);
  const [serie, apps, appsC, horasC] = await Promise.all([
    serieDiaria(fx), porAppDetalle(fx), porAppYConsultorio(fx), porHoraYConsultorio(fx),
  ]);
  const [consultas, medicos] = await Promise.all([distribucionConsultas(fx), porMedico(fx)]);

  const elegido = consultorios.find((c) => c.id === f.consultorio) ?? null;
  const alcance = elegido ? elegido.nombre : "los tres consultorios juntos";
  const motivos = Object.entries(cob.motivos ?? {}).sort((a, b) => b[1] - a[1]);

  // Color por consultorio, estable en toda la página: el mismo azul es el mismo consultorio
  // en la tendencia, en las apps y en la forma del día.
  const orden = [...new Map(porC.map((c) => [c.consultorio_id ?? "sin", c])).values()].sort((a, b) => a.orden - b.orden);
  const color = new Map(orden.map((c, i) => [c.consultorio_id ?? "sin", COLOR_SERIE[i % COLOR_SERIE.length]]));

  const fechas = [...new Set(serie.map((p) => p.fecha))].sort();
  const series: SerieDia[] = orden.map((c) => ({
    id: c.consultorio_id ?? "sin", nombre: c.nombre, color: color.get(c.consultorio_id ?? "sin")!,
    puntos: new Map(serie.filter((p) => (p.consultorio_id ?? "sin") === (c.consultorio_id ?? "sin")).map((p) => [p.fecha, num(p[metrica.campo])])),
  }));

  const totalApp = Math.max(1, apps.reduce((s, a) => s + num(a.activo_ms), 0));
  const pctInterrupcion = consultas && consultas.n > 0 ? (num(consultas.con_interrupcion) / consultas.n) * 100 : null;
  const hayVarios = orden.length > 1 && !elegido;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Datos</h1>
        <p className="sub-pagina">
          Todo lo medido en el rango elegido, junto y comparable. Cada número es una <strong>mediana por jornada</strong> —
          un consultorio en un día operativo—, que es la unidad del estudio. Ahora mismo estás viendo <strong>{alcance}</strong>.
        </p>
      </div>

      <Filtros f={f} consultorios={consultorios} ruta="/datos" ocultarConsultorio />

      {/* Alcance: todos, o uno. Es el control que cambia toda la página. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-muted">Ver</span>
        <nav className="segmentos">
          <Link href={"/datos" + conFiltro(f, { consultorio: null, metrica: metricaEnUrl })} aria-current={!f.consultorio}>Todos (promedio)</Link>
          {consultorios.map((c) => (
            <Link key={c.id} href={"/datos" + conFiltro(f, { consultorio: c.id, metrica: metricaEnUrl })} aria-current={f.consultorio === c.id}>{c.nombre}</Link>
          ))}
        </nav>
      </div>

      {rescatando && (
        <div className="tarjeta border-warning bg-warning-soft p-4 text-sm text-ink">
          <strong>Ninguna jornada del rango pasó el filtro de calidad</strong>, así que se están enseñando todas —
          incluidas las que el instrumento midió a medias. Sirven para mirar, no para concluir: el motivo de la
          exclusión está justo debajo. Para volver al criterio estricto, quita el rango o amplíalo.
        </div>
      )}

      {/* ── 1. Cómo va ───────────────────────────────────────────────────── */}
      <Seccion
        titulo="Cómo va"
        sub={`Mediana de las ${fmtNum(k?.n ?? 0)} jornadas del rango, y cómo cambió frente al periodo anterior del mismo largo (${periodoPrevio(fx).desde} → ${periodoPrevio(fx).hasta}).`}
      >
        {(k?.n ?? 0) === 0 ? (
          <Vacio titulo="Todavía no hay jornadas en este rango"
            texto="Ningún consultorio tiene un día operativo cerrado aquí. Amplía el rango, o comprueba en Inicio que los tres PCs estén en línea." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Titular label="Activo en el PC" valor={fmtMin(k.activo_med)} k={k} p={kPrevio} campo="activo_med" mejor="neutro"
              sub={`mediana de ${fmtNum(k.n)} jornadas`} hero />
            <Titular label="En SAP (HIS)" valor={fmtMin(k.his_med)} k={k} p={kPrevio} campo="his_med" mejor="menos"
              sub={`${fmtPct(k.carga_admin_med)} del tiempo activo`} />
            <Titular label="Escribiendo" valor={fmtMin(k.escritura_med)} k={k} p={kPrevio} campo="escritura_med" mejor="menos"
              sub={`${fmtNum(k.clics_med)} clics · ${fmtNum(k.cambios_med)} cambios de contexto`} />
            <Titular label="Pacientes" valor={fmtNum(k.pacientes_med)} k={k} p={kPrevio} campo="pacientes_med" mejor="mas"
              sub={`${fmtNum(k.pacientes_por_hora_med, 1)} por hora de actividad`} />
            <Titular label="Consulta (mediana)" valor={fmtMin(k.consulta_med)} k={k} p={kPrevio} campo="consulta_med" mejor="neutro"
              sub={`activo por paciente ${fmtMin(k.por_paciente_med)}`} />
            <Titular label="Post-atención" valor={fmtMin(k.post_med)} k={k} p={kPrevio} campo="post_med" mejor="menos"
              sub={`hasta el siguiente ${fmtMin(k.entre_consultas_med)}`} />
            <Titular label="Espera de SAP" valor={fmtSeg(k.espera_sap_med)} k={k} p={kPrevio} campo="espera_sap_med" mejor="menos"
              sub={`pantalla lista p95 ${fmtSeg(k.ready_p95_med)} · ${fmtNum(k.pantallas_med)} pantallas`} />
            <Titular label="Arranque y cola" valor={`${fmtMin(k.pre_med)} · ${fmtMin(k.cola_med)}`} k={k} p={kPrevio} campo="pre_med" mejor="menos"
              sub="activo antes del primer paciente · en SAP tras el último" />
            <Titular label="Encendido sin uso" valor={fmtMin(k.inactivo_med)} k={k} p={kPrevio} campo="inactivo_med" mejor="neutro"
              sub={`bloqueado ${fmtMin(k.bloqueado_med)}`} />
            <Titular label="Cobertura" valor={fmtPct(k.cobertura_med)} k={k} p={kPrevio} campo="cobertura_med" mejor="mas"
              sub={`sin datos ${fmtMin(k.sin_datos_med)} por jornada`} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-plane p-4 text-sm">
          <span className="text-ink">
            <strong>{fmtNum(cob.total)}</strong> jornadas en el rango ·{" "}
            <Insignia tono={cob.buenas === cob.total ? "ok" : "neutro"}>{fmtNum(cob.buenas)} comparables</Insignia>{" "}
            {cob.excluidas > 0 && <Insignia tono="critico">{fmtNum(cob.excluidas)} excluidas</Insignia>}{" "}
            {cob.en_curso > 0 && <span className="text-secondary">· {fmtNum(cob.en_curso)} todavía en curso hoy</span>}
          </span>
          <span className="text-secondary">Cobertura media del instrumento: <strong className="tabular text-ink">{fmtPct(cob.cobertura_media)}</strong></span>
          {motivos.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
              {motivos.map(([m, n]) => <li key={m}>{MOTIVO[m] ?? m}: <span className="tabular text-ink">{fmtNum(n)}</span></li>)}
            </ul>
          )}
        </div>
      </Seccion>

      {/* ── 2. Cómo cambia ───────────────────────────────────────────────── */}
      <Seccion
        titulo="Cómo cambia, día a día"
        sub="Una línea por consultorio sobre los días operativos del rango. Un día sin jornada corta la línea en vez de bajar a cero: no medir no es no trabajar."
        accion={
          <nav className="segmentos">
            {METRICAS.map((m) => (
              <Link key={m.id} href={"/datos" + conFiltro(f, { metrica: m.id === METRICAS[0].id ? null : m.id })} aria-current={m.id === metrica.id}>{m.label}</Link>
            ))}
          </nav>
        }
      >
        <LineasPorDia series={series} fechas={fechas} fmt={metrica.fmt} ariaLabel={`${metrica.label} por día y consultorio`} />
      </Seccion>

      {/* ── 3. Comparación entre consultorios ────────────────────────────── */}
      {hayVarios && (
        <Seccion
          titulo="Un consultorio al lado de otro"
          sub="La misma vara para los tres. «Todos» es la mediana de todas las jornadas juntas: la barra dice cuánto se separa cada consultorio de esa referencia, verde cuando se separa hacia el lado bueno de esa métrica."
        >
          <div className="caja-tabla">
            <table className="tabla">
              <thead>
                <tr>
                  <th className="pegada">Métrica</th>
                  <th className="num">Todos</th>
                  {orden.map((c) => <th key={c.consultorio_id ?? "sin"} className="num">{c.nombre}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="pegada font-medium text-ink">Jornadas</td>
                  <td className="num text-secondary">{fmtNum(k?.n ?? 0)}</td>
                  {orden.map((c) => <td key={c.consultorio_id ?? "sin"} className="num text-secondary">{fmtNum(c.n)}</td>)}
                </tr>
                {COMPARABLES.map((m) => {
                  const ref = k?.[m.clave] == null ? null : Number(k[m.clave]);
                  return (
                    <tr key={m.clave}>
                      <td className="pegada whitespace-nowrap font-medium text-ink" title={m.nota}>{m.label}</td>
                      <td className="num text-ink">{m.fmt(ref)}</td>
                      {orden.map((c) => <Celda key={c.consultorio_id ?? "sin"} c={c} m={m} ref_={ref} />)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Seccion>
      )}

      {/* ── 4. En qué se va el tiempo ────────────────────────────────────── */}
      <Seccion
        titulo="En qué se va el tiempo"
        sub="Reparto del tiempo activo por aplicación. «Delante» es la ventana al frente aunque nadie tocara nada; «activo» es con input real. Una app que no esté en el catálogo aparece con el nombre de su programa: se le pone nombre propio en Configuración → config del medidor."
      >
        {apps.length === 0 ? <p className="text-sm text-muted">Sin actividad por app en este rango.</p> : (
          <>
            <div className="caja-tabla">
              <table className="tabla tabla--cebra">
                <thead>
                  <tr>
                    <th>App</th><th className="num">Activo</th><th style={{ minWidth: "8rem" }}>Reparto</th>
                    <th className="num">Delante</th><th className="num">Escribiendo</th><th className="num">Teclas</th><th className="num">Clics</th><th className="num">Jornadas</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => {
                    const activo = num(a.activo_ms);
                    const pct = (activo / totalApp) * 100;
                    return (
                      <tr key={a.app}>
                        <td className="whitespace-nowrap text-ink"><span className="linea-dia__muestra" style={{ background: colorApp(a.app) }} aria-hidden />{etiquetaApp(a.app)}</td>
                        <td className="num">{fmtHoras(activo)}</td>
                        <td>
                          <span className="barra-pista" title={`${fmtPct(pct)} del tiempo activo del rango`}>
                            <span style={{ width: `${Math.max(1, Math.round(pct))}%`, background: colorApp(a.app) }} />
                          </span>
                        </td>
                        <td className="num">{fmtHoras(a.foreground_ms)}</td>
                        <td className="num">{fmtMin(a.typing_ms)}</td>
                        <td className="num">{fmtNum(a.keystrokes)}</td>
                        <td className="num">{fmtNum(a.clicks)}</td>
                        <td className="num">{fmtNum(a.jornadas)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {hayVarios && <RepartoPorConsultorio filas={appsC} orden={orden} />}
          </>
        )}
      </Seccion>

      {/* ── 5. La forma del día ──────────────────────────────────────────── */}
      <Seccion titulo="La forma del día" sub="Tiempo activo sumado por hora de Bogotá. Dice a qué hora arranca de verdad la consulta, dónde está el pico y hasta cuándo se documenta.">
        <BarrasPorHora
          series={orden.map((c) => ({
            id: c.consultorio_id ?? "sin", nombre: c.nombre, color: color.get(c.consultorio_id ?? "sin")!,
            horas: new Map(horasC.filter((h) => (h.consultorio_id ?? "sin") === (c.consultorio_id ?? "sin")).map((h) => [h.hora.padStart(2, "0"), num(h.activo_ms)])),
          }))}
          fmt={fmtHoras}
          ariaLabel="Tiempo activo por hora del día y consultorio"
        />
      </Seccion>

      {/* ── 6. Las consultas ─────────────────────────────────────────────── */}
      <Seccion titulo="Las consultas" sub="Aquí la unidad NO es la jornada sino el paciente: cada consulta del rango, de la primera a la última tecla sobre esa huella. Los percentiles dicen cuánto varía lo que arriba es una sola cifra.">
        {!consultas || consultas.n === 0 ? (
          <Vacio titulo="Todavía no hay consultas identificadas"
            texto="El medidor solo separa pacientes cuando puede leer la huella del encuentro en la pantalla de SAP. Revisa la regla de identidad en Configuración y que los PCs tengan SAP GUI Scripting habilitado." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Tile label="Consultas" value={fmtNum(consultas.n)} sub="pacientes-jornada en el rango" hero />
            <Tile label="p25" value={fmtMin(consultas.p25)} sub="una de cada cuatro dura menos" />
            <Tile label="Mediana" value={fmtMin(consultas.p50)} sub="la consulta típica" />
            <Tile label="p75" value={fmtMin(consultas.p75)} sub="una de cada cuatro dura más" />
            <Tile label="p90" value={fmtMin(consultas.p90)} sub="la cola larga" />
            <Tile label="Activo · SAP" value={`${fmtMin(consultas.activo_p50)} · ${fmtMin(consultas.his_p50)}`} sub="medianas por consulta" />
            <Tile label="Con interrupción" value={fmtPct(pctInterrupcion)} sub={`${fmtNum(consultas.con_interrupcion)} de ${fmtNum(consultas.n)} · post-atención ${fmtMin(consultas.post_p50)}`} />
          </div>
        )}
      </Seccion>

      {/* ── 7. Quién ─────────────────────────────────────────────────────── */}
      <Seccion titulo="Quién estuvo en SAP" sub="Por login de SAP. El médico es una ANOTACIÓN derivada del usuario que estaba en la sesión, no la unidad del estudio: la unidad es el consultorio-día, y un mismo consultorio pasa por varias manos.">
        {medicos.length === 0 ? <p className="text-sm text-muted">Sin usuarios de SAP vistos en este rango. Los logins se leen de la sesión de SAP GUI; sin scripting no aparecen.</p> : (
          <div className="caja-tabla">
            <table className="tabla tabla--cebra">
              <thead><tr><th>Usuario SAP</th><th>Nombre en el listado</th><th className="num">Jornadas</th><th className="num">Activo</th></tr></thead>
              <tbody>
                {medicos.map((m) => (
                  <tr key={m.sap_user}>
                    <td className="font-mono text-xs text-ink">{m.sap_user}</td>
                    <td className="text-secondary">{m.nombre ?? <span className="text-muted">sin asociar · se asocia en Configuración</span>}</td>
                    <td className="num">{fmtNum(m.jornadas)}</td>
                    <td className="num">{fmtHoras(m.activo_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {/* ── 8. El detalle, por si hace falta ─────────────────────────────── */}
      <details className="tarjeta p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Todas las medianas, y cada día suelto</summary>

        <h3 className="mt-4 mb-2 text-xs uppercase tracking-wide text-muted">Las 31 medianas por consultorio</h3>
        {porC.length === 0 ? <p className="text-sm text-muted">Sin consultorios con jornadas en el rango.</p> : (
          <div className="caja-tabla">
            <table className="tabla tabla--cebra">
              <thead>
                <tr>
                  <th className="pegada">Consultorio</th><th className="num">n</th><th className="num">Buenas</th>
                  {TODAS.map((col) => <th key={col.clave} className="num">{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {porC.map((c) => (
                  <tr key={c.consultorio_id ?? "sin"}>
                    <td className="pegada whitespace-nowrap font-medium text-ink">{c.nombre}</td>
                    <td className="num">{fmtNum(c.n)}</td>
                    <td className="num">{fmtNum(c.buenas)}</td>
                    {TODAS.map((col) => <td key={col.clave} className="num">{col.fmt(c[col.clave] == null ? null : Number(c[col.clave]))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mt-6 mb-2 text-xs uppercase tracking-wide text-muted">Cada jornada del rango</h3>
        {serie.length === 0 ? <p className="text-sm text-muted">Sin jornadas en el rango.</p> : (
          <div className="caja-tabla caja-tabla--alta">
            <table className="tabla tabla--cebra">
              <thead><tr><th>Día</th><th>Consultorio</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Pacientes</th><th>Calidad</th></tr></thead>
              <tbody>
                {[...serie].reverse().map((p) => (
                  <tr key={`${p.fecha}-${p.consultorio_id ?? "sin"}`}>
                    <td className="whitespace-nowrap">{p.consultorio_id
                      ? <Link href={`/consultorios/${p.consultorio_id}?fecha=${p.fecha}`} className="text-accent hover:underline">{fmtFecha(p.fecha)}</Link>
                      : <span className="text-ink">{fmtFecha(p.fecha)}</span>}</td>
                    <td className="whitespace-nowrap text-ink">{p.nombre}</td>
                    <td className="num">{fmtMin(p.activo_ms)}</td>
                    <td className="num">{fmtMin(p.his_ms)}</td>
                    <td className="num">{fmtNum(p.pacientes)}</td>
                    <td className="text-xs">{p.calidad_ok ? <span className="text-good-text">comparable</span> : <span className="text-critical">excluida</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <p className="text-sm text-muted">
        Esta página mira el rango tal cual. Para lo demás: <Link href="/comparacion" className="text-accent hover:underline">Comparación</Link> pone las fases del estudio una al lado de otra,{" "}
        <Link href="/sap" className="text-accent hover:underline">Pantallas SAP</Link> baja al detalle de cada transacción, y{" "}
        <Link href="/exportar" className="text-accent hover:underline">Exportar</Link> entrega estos mismos datos en crudo.
      </p>
    </div>
  );
}

/** Un titular con su cambio frente al periodo anterior debajo. */
function Titular({ label, valor, sub, k, p, campo, mejor, hero }: {
  label: string; valor: string; sub: string; k: Kpis; p: Kpis; campo: keyof Medianas; mejor: "mas" | "menos" | "neutro"; hero?: boolean;
}) {
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-semibold text-ink ${hero ? "text-4xl" : "text-2xl"}`}>{valor}</p>
      <p className="mt-1 text-xs">
        <Delta antes={p?.[campo] == null ? null : Number(p[campo])} ahora={k?.[campo] == null ? null : Number(k[campo])} mejor={mejor} />
      </p>
      <p className="mt-1 text-xs text-secondary">{sub}</p>
    </div>
  );
}

/** Una celda de la comparación: el valor, y una barra que dice cuánto se separa de la referencia. */
function Celda({ c, m, ref_ }: { c: FilaConsultorio; m: (typeof COMPARABLES)[number]; ref_: number | null }) {
  const v = c[m.clave] == null ? null : Number(c[m.clave]);
  if (v == null || ref_ == null || ref_ === 0) return <td className="num text-muted">{m.fmt(v)}</td>;
  const desvio = Math.max(-1, Math.min(1, (v - ref_) / Math.abs(ref_)));
  const bueno = m.mejor === "neutro" ? null : (desvio > 0) === (m.mejor === "mas");
  const color = bueno == null ? "var(--color-axis)" : bueno ? "var(--color-good)" : "var(--color-critical)";
  const ancho = Math.abs(desvio) * 50;
  return (
    <td className="num">
      <span className="tabular text-ink">{m.fmt(v)}</span>
      <span className="desvio mt-1" title={`${(desvio * 100).toFixed(0)} % respecto a la mediana de todos (${m.fmt(ref_)})`}>
        <span style={{ background: color, left: desvio >= 0 ? "50%" : `${50 - ancho}%`, width: `${Math.max(1, ancho)}%` }} />
      </span>
    </td>
  );
}

/** El reparto por app de cada consultorio, uno debajo de otro y con el mismo eje. */
function RepartoPorConsultorio({ filas, orden }: { filas: { consultorio_id: string | null; nombre: string; app: string; activo_ms: number }[]; orden: FilaConsultorio[] }) {
  const porCons = orden.map((c) => {
    const suyas = filas.filter((x) => (x.consultorio_id ?? "sin") === (c.consultorio_id ?? "sin"));
    const total = Math.max(1, suyas.reduce((s, x) => s + Number(x.activo_ms), 0));
    return { c, suyas: suyas.slice(0, 8), total };
  }).filter((x) => x.suyas.length > 0);
  if (porCons.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">El mismo reparto, consultorio por consultorio</h3>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {porCons.map(({ c, suyas, total }) => (
          <div key={c.consultorio_id ?? "sin"} className="rounded-xl border border-line p-3">
            <p className="mb-2 text-sm font-medium text-ink">{c.nombre}</p>
            <div className="mb-2 flex h-3 overflow-hidden rounded" title="Reparto del tiempo activo de este consultorio">
              {suyas.map((a) => (
                <span key={a.app} style={{ width: `${(Number(a.activo_ms) / total) * 100}%`, background: colorApp(a.app) }}
                  title={`${etiquetaApp(a.app)} · ${fmtHoras(a.activo_ms)} · ${fmtPct((Number(a.activo_ms) / total) * 100)}`} />
              ))}
            </div>
            <ul className="space-y-0.5 text-xs text-secondary">
              {suyas.slice(0, 5).map((a) => (
                <li key={a.app} className="flex items-baseline justify-between gap-2">
                  <span className="truncate"><span className="linea-dia__muestra" style={{ background: colorApp(a.app) }} aria-hidden />{etiquetaApp(a.app)}</span>
                  <span className="tabular text-ink">{fmtPct((Number(a.activo_ms) / total) * 100)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
