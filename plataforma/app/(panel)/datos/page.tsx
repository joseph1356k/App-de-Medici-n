import Link from "next/link";
import { Filtros } from "@/components/Filtros";
import { Seccion, Tile, Vacio } from "@/components/ui";
import {
  cobertura, consultoriosParaFiltro, distribucionConsultas, kpis, kpisPorConsultorio, porApp, porAppDetalle,
  porHora, porMedico, serieDiaria, type Medianas,
} from "@/lib/consultas";
import { leerFiltros, type Sp } from "@/lib/filtros";
import { colorApp, etiquetaApp, fmtFecha, fmtHoras, fmtMin, fmtNum, fmtPct, fmtSeg } from "@/lib/formato";

/** Las 31 medianas de `Medianas`, en orden de lectura y con su unidad. Es la misma lista
 * que ordena la tabla por consultorio: una columna por mediana, ninguna escondida. */
const COLUMNAS: { clave: keyof Medianas; label: string; fmt: (v: number | null) => string }[] = [
  { clave: "activo_med", label: "Activo", fmt: fmtMin },
  { clave: "his_med", label: "En SAP", fmt: fmtMin },
  { clave: "miracle_med", label: "En Miracle", fmt: fmtMin },
  { clave: "carga_admin_med", label: "Carga SAP", fmt: fmtPct },
  { clave: "escritura_med", label: "Escribiendo", fmt: fmtMin },
  { clave: "clics_med", label: "Clics", fmt: fmtNum },
  { clave: "cambios_med", label: "Cambios de contexto", fmt: fmtNum },
  { clave: "pacientes_med", label: "Pacientes", fmt: fmtNum },
  { clave: "pacientes_por_hora_med", label: "Pacientes/hora", fmt: (v) => fmtNum(v, 1) },
  { clave: "consulta_med", label: "Consulta", fmt: fmtMin },
  { clave: "por_paciente_med", label: "Activo/paciente", fmt: fmtMin },
  { clave: "entre_consultas_med", label: "Al siguiente", fmt: fmtMin },
  { clave: "post_med", label: "Post-atención", fmt: fmtMin },
  { clave: "pre_med", label: "Arranque del día", fmt: fmtMin },
  { clave: "cola_med", label: "Cola de documentación", fmt: fmtMin },
  { clave: "interrupciones_med", label: "Interrupciones", fmt: fmtNum },
  { clave: "espera_sap_med", label: "Espera SAP", fmt: fmtSeg },
  { clave: "ready_p95_med", label: "Pantalla lista p95", fmt: fmtSeg },
  { clave: "pantallas_med", label: "Pantallas distintas", fmt: fmtNum },
  { clave: "revisitas_med", label: "Revisitas SAP", fmt: fmtNum },
  { clave: "tabs_med", label: "Tab", fmt: fmtNum },
  { clave: "enters_med", label: "Enter", fmt: fmtNum },
  { clave: "correcciones_med", label: "Correcciones", fmt: fmtNum },
  { clave: "copias_med", label: "Copiar", fmt: fmtNum },
  { clave: "pegados_med", label: "Pegar", fmt: fmtNum },
  { clave: "guardados_med", label: "Guardados", fmt: fmtNum },
  { clave: "tramos_ms_med", label: "En tramos de actividad", fmt: fmtMin },
  { clave: "bloqueado_med", label: "Bloqueado", fmt: fmtMin },
  { clave: "inactivo_med", label: "Inactivo", fmt: fmtMin },
  { clave: "sin_datos_med", label: "Sin datos", fmt: fmtMin },
  { clave: "cobertura_med", label: "Cobertura", fmt: fmtPct },
];

// Los motivos de exclusión de `calidad_motivos`, en palabras. Uno que no esté aquí se
// muestra tal cual: es preferible un tecnicismo a esconder una jornada excluida.
const MOTIVO: Record<string, string> = {
  cobertura: "Cobertura < 80 % (faltan cubetas del día)",
  clock_jumps: "Reloj del PC inestable (> 2 saltos)",
  spool_dropped: "El PC descartó datos (disco lleno)",
  hooks_degradados: "Ganchos de teclado/ratón degradados",
  sin_actividad: "Jornada sin actividad",
  en_curso: "Jornada todavía en curso",
};

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));

/**
 * DATOS: todo lo del rango filtrado en una sola página, para mirar y comparar. Ocho bloques
 * que van de lo general a lo particular — el rango entero, cada consultorio, cada día, cada
 * consulta, cada app, cada hora y cada usuario SAP — sobre la MISMA rebanada de filtros, así
 * que los números de un bloque explican los del otro. Todas las medianas son POR JORNADA
 * (un consultorio en un día operativo), que es la unidad del estudio.
 *
 * Las consultas van en tres tandas y no todas de golpe: la base corta a los 20 s, el pool
 * tiene diez conexiones y en Vercel casi toda visita es un arranque en frío.
 */
export default async function DatosPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const f = leerFiltros(await searchParams);
  const [consultorios, k, cob, porC] = await Promise.all([consultoriosParaFiltro(), kpis(f), cobertura(f), kpisPorConsultorio(f)]);
  const [serie, consultas, apps, appsDetalle] = await Promise.all([serieDiaria(f), distribucionConsultas(f), porApp(f), porAppDetalle(f)]);
  const [horas, medicos] = await Promise.all([porHora(f), porMedico(f)]);

  const motivos = Object.entries(cob.motivos ?? {}).sort((a, b) => b[1] - a[1]);
  const maxDia = Math.max(1, ...serie.map((p) => num(p.activo_ms)));
  const totalApp = Math.max(1, apps.reduce((s, a) => s + num(a.ms), 0));
  const porHoraMs = new Map(horas.map((h) => [h.hora.padStart(2, "0"), num(h.activo_ms)]));
  const maxHora = Math.max(1, ...porHoraMs.values());
  const rejilla = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const pctInterrupcion = consultas && consultas.n > 0 ? (num(consultas.con_interrupcion) / consultas.n) * 100 : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Datos</h1>
        <p className="sub-pagina">Todo lo que hay del rango elegido, junto y comparable: el resumen, cada consultorio, cada día, la distribución de las consultas, las apps, la forma del día por horas y los usuarios de SAP. Salvo donde diga otra cosa, cada número es una <strong>mediana por jornada</strong> (un consultorio en un día operativo) sobre jornadas de buena calidad.</p>
      </div>
      <Filtros f={f} consultorios={consultorios} ruta="/datos" />

      {/* ── 1. Resumen del rango ─────────────────────────────────────────── */}
      <Seccion titulo="Resumen del rango" sub={`Medianas por jornada de las ${fmtNum(k?.n ?? 0)} jornadas comparables del rango. La mediana es de la jornada, no del rango entero: «activo 6 h» quiere decir que la jornada típica tuvo 6 h de PC activo, no que se sumaran 6 h en total.`}>
        {(k?.n ?? 0) === 0 ? (
          <Vacio titulo="Sin jornadas comparables" texto="No hay jornadas de buena calidad con estos filtros. Amplía el rango, o marca «incluir jornadas de mala calidad» para ver también las que el instrumento midió a medias." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Tile label="Activo en el PC" value={fmtMin(k.activo_med)} sub={`mediana de ${fmtNum(k.n)} jornadas`} hero />
            <Tile label="En SAP (HIS)" value={fmtMin(k.his_med)} sub={`${fmtPct(k.carga_admin_med)} del activo · Miracle ${fmtMin(k.miracle_med)}`} />
            <Tile label="Escribiendo" value={fmtMin(k.escritura_med)} sub={`${fmtNum(k.clics_med)} clics · ${fmtNum(k.cambios_med)} cambios de contexto`} />
            <Tile label="Pacientes" value={fmtNum(k.pacientes_med)} sub={`${fmtNum(k.pacientes_por_hora_med, 1)} por hora de actividad`} />
            <Tile label="Consulta" value={fmtMin(k.consulta_med)} sub={`activo por paciente ${fmtMin(k.por_paciente_med)}`} />
            <Tile label="Post-atención" value={fmtMin(k.post_med)} sub={`hasta el siguiente ${fmtMin(k.entre_consultas_med)}`} />
            <Tile label="Espera de SAP" value={fmtSeg(k.espera_sap_med)} sub={`pantalla lista p95 ${fmtSeg(k.ready_p95_med)} · ${fmtNum(k.pantallas_med)} pantallas`} />
            <Tile label="Arranque y cola" value={`${fmtMin(k.pre_med)} · ${fmtMin(k.cola_med)}`} sub="activo antes del primer paciente · en SAP tras el último" />
            <Tile label="Bloqueado e inactivo" value={`${fmtMin(k.bloqueado_med)} · ${fmtMin(k.inactivo_med)}`} sub="sesión bloqueada · encendido sin input" />
            <Tile label="Cobertura" value={fmtPct(k.cobertura_med)} sub={`sin datos ${fmtMin(k.sin_datos_med)} por jornada`} />
          </div>
        )}

        <div className="mt-4 rounded-xl border border-line bg-plane p-4">
          <p className="text-sm text-ink">
            <strong>{fmtNum(cob.total)}</strong> jornadas en el rango: <strong>{fmtNum(cob.buenas)}</strong> comparables y <strong>{fmtNum(cob.excluidas)}</strong> excluidas por calidad
            {cob.en_curso > 0 && <> · {fmtNum(cob.en_curso)} todavía en curso hoy</>}. Cobertura media del instrumento: {fmtPct(cob.cobertura_media)}.
          </p>
          {motivos.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
              {motivos.map(([m, n]) => <li key={m}>{MOTIVO[m] ?? m}: <span className="tabular text-ink">{fmtNum(n)}</span></li>)}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted">Ninguna jornada quedó fuera: el instrumento midió el rango entero.</p>
          )}
        </div>
      </Seccion>

      {/* ── 2. Por consultorio ───────────────────────────────────────────── */}
      <Seccion titulo="Por consultorio" sub="La misma vara para cada consultorio: n = jornadas que entran en el cálculo, «buenas» = cuántas de ellas pasaron el filtro de calidad (con el interruptor de mala calidad apagado son las mismas, por eso n = buenas), y después las 31 medianas por jornada. La tabla se desplaza a lo ancho y la primera columna se queda quieta.">
        {porC.length === 0 ? <p className="text-sm text-muted">Sin consultorios con jornadas en el rango.</p> : (
          <div className="caja-tabla">
            <table className="tabla tabla--cebra">
              <thead>
                <tr>
                  <th className="pegada">Consultorio</th>
                  <th className="num">n</th>
                  <th className="num">Buenas</th>
                  {COLUMNAS.map((col) => <th key={col.clave} className="num">{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {porC.map((c) => (
                  <tr key={c.consultorio_id ?? "sin"}>
                    <td className="pegada whitespace-nowrap font-medium text-ink">{c.nombre}</td>
                    <td className="num">{fmtNum(c.n)}</td>
                    <td className="num">{fmtNum(c.buenas)}</td>
                    {COLUMNAS.map((col) => <td key={col.clave} className="num">{col.fmt(c[col.clave] == null ? null : Number(c[col.clave]))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {/* ── 3. Por día ───────────────────────────────────────────────────── */}
      <Seccion titulo="Por día" sub="Una fila por día operativo y consultorio, en orden. La barra es el tiempo activo en proporción al día más cargado del rango; el número es el dato. Clic en el día para ver su línea de tiempo.">
        {serie.length === 0 ? <p className="text-sm text-muted">Sin jornadas en el rango.</p> : (
          <div className="caja-tabla caja-tabla--alta">
            <table className="tabla tabla--cebra">
              <thead><tr><th>Día</th><th>Consultorio</th><th className="num">Activo</th><th style={{ minWidth: "8rem" }}>Activo (proporción)</th><th className="num">En SAP</th><th className="num">Pacientes</th><th>Calidad</th></tr></thead>
              <tbody>
                {serie.map((p) => {
                  const activo = num(p.activo_ms);
                  return (
                    <tr key={`${p.fecha}-${p.consultorio_id ?? "sin"}`}>
                      <td className="whitespace-nowrap">{p.consultorio_id
                        ? <Link href={`/consultorios/${p.consultorio_id}?fecha=${p.fecha}`} className="text-accent hover:underline">{fmtFecha(p.fecha)}</Link>
                        : <span className="text-ink">{fmtFecha(p.fecha)}</span>}</td>
                      <td className="whitespace-nowrap text-ink">{p.nombre}</td>
                      <td className="num">{fmtMin(activo)}</td>
                      <td>
                        <span className="barra-pista" title={`${fmtHoras(activo)} de ${fmtHoras(maxDia)} (el día más cargado del rango)`}>
                          <span style={{ width: `${Math.max(1, Math.round((activo / maxDia) * 100))}%` }} />
                        </span>
                      </td>
                      <td className="num">{fmtMin(p.his_ms)}</td>
                      <td className="num">{fmtNum(p.pacientes)}</td>
                      <td className="text-xs">{p.calidad_ok ? <span className="text-good-text">comparable</span> : <span className="text-critical" title="Cobertura &lt; 80 %, reloj inestable o datos descartados">excluida</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {/* ── 4. Consultas ─────────────────────────────────────────────────── */}
      <Seccion titulo="Consultas" sub="Aquí la unidad NO es la jornada sino el paciente: cada consulta del rango (solo de jornadas comparables), de la primera a la última tecla sobre esa huella. Los percentiles dicen cuánto varía lo que en el resumen es una sola cifra.">
        {!consultas || consultas.n === 0 ? (
          <Vacio titulo="Todavía no hay consultas identificadas"
            texto="El medidor solo separa pacientes cuando puede leer la huella del encuentro en la pantalla de SAP. Si SAP se usó igual, revisa la regla de identidad en Configuración → reglas de identidad, y que los PCs tengan SAP GUI Scripting habilitado." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Tile label="Consultas" value={fmtNum(consultas.n)} sub="pacientes-jornada en el rango" hero />
            <Tile label="p25" value={fmtMin(consultas.p25)} sub="una de cada cuatro dura menos" />
            <Tile label="Mediana (p50)" value={fmtMin(consultas.p50)} sub="la consulta típica" />
            <Tile label="p75" value={fmtMin(consultas.p75)} sub="una de cada cuatro dura más" />
            <Tile label="p90" value={fmtMin(consultas.p90)} sub="la cola larga" />
            <Tile label="Activo · SAP" value={`${fmtMin(consultas.activo_p50)} · ${fmtMin(consultas.his_p50)}`} sub="medianas por consulta" />
            <Tile label="Con interrupción" value={fmtPct(pctInterrupcion)} sub={`${fmtNum(consultas.con_interrupcion)} de ${fmtNum(consultas.n)} · post-atención ${fmtMin(consultas.post_p50)}`} />
          </div>
        )}
      </Seccion>

      {/* ── 5. Por app ───────────────────────────────────────────────────── */}
      <Seccion titulo="Por app" sub="Dónde se va el tiempo activo, y qué se hizo dentro de cada app. «Delante» es el tiempo con la ventana al frente aunque nadie tocara nada; «activo» es con input real.">
        {appsDetalle.length === 0 ? <p className="text-sm text-muted">Sin actividad por app en el rango.</p> : (
          <div className="caja-tabla">
            <table className="tabla tabla--cebra">
              <thead><tr><th>App</th><th className="num">Activo</th><th style={{ minWidth: "7rem" }}>Reparto</th><th className="num">Delante</th><th className="num">Escribiendo</th><th className="num">Teclas</th><th className="num">Clics</th><th className="num">Jornadas</th></tr></thead>
              <tbody>
                {appsDetalle.map((a) => {
                  const activo = num(a.activo_ms);
                  return (
                    <tr key={a.app}>
                      <td className="whitespace-nowrap text-ink"><span className="linea-dia__muestra" style={{ background: colorApp(a.app) }} aria-hidden />{etiquetaApp(a.app)}</td>
                      <td className="num">{fmtHoras(activo)}</td>
                      <td>
                        <span className="barra-pista" title={`${fmtPct((activo / totalApp) * 100)} del activo del rango`}>
                          <span style={{ width: `${Math.max(1, Math.round((activo / totalApp) * 100))}%`, background: colorApp(a.app) }} />
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
        )}
      </Seccion>

      {/* ── 6. Por hora ──────────────────────────────────────────────────── */}
      <Seccion titulo="Por hora" sub="La forma del día: tiempo activo sumado por hora de Bogotá sobre todas las jornadas comparables del rango. Pasa el cursor por una barra para el total de esa hora.">
        {porHoraMs.size === 0 ? <p className="text-sm text-muted">Sin actividad por hora en el rango.</p> : (
          <div className="horas" role="img" aria-label="Tiempo activo por hora del día">
            {rejilla.map((h) => {
              const v = porHoraMs.get(h) ?? 0;
              return (
                <div key={h}>
                  <div className="horas__barra" title={`${h}:00 – ${h}:59 · ${fmtHoras(v)} activas`}>
                    <span style={{ height: `${v === 0 ? 0 : Math.max(2, Math.round((v / maxHora) * 100))}%` }} />
                  </div>
                  <div className="horas__etiqueta">{h}</div>
                </div>
              );
            })}
          </div>
        )}
      </Seccion>

      {/* ── 7. Por médico ────────────────────────────────────────────────── */}
      <Seccion titulo="Por médico (usuario SAP)" sub="Quién acumuló actividad, por login de SAP. El médico es una ANOTACIÓN derivada del usuario que estaba en SAP, no la unidad del estudio: la unidad es el consultorio-día, y un mismo consultorio puede pasar por varias manos.">
        {medicos.length === 0 ? <p className="text-sm text-muted">Sin usuarios de SAP vistos en el rango. Los logins se leen de la sesión de SAP GUI; sin scripting no aparecen.</p> : (
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

      <p className="text-sm text-muted">
        Esta página mira el rango tal cual. Para lo demás: <Link href="/comparacion" className="text-accent hover:underline">Comparación</Link> pone las fases una al lado de otra,{" "}
        <Link href="/sap" className="text-accent hover:underline">Pantallas SAP</Link> baja al detalle de cada transacción, y{" "}
        <Link href="/exportar" className="text-accent hover:underline">Exportar</Link> entrega estos mismos datos en crudo (CSV y JSON autodescriptivo).
      </p>
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
