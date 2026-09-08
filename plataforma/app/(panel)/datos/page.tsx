import Link from "next/link";
import { Alcance } from "@/components/Alcance";
import { Cifra } from "@/components/Cifra";
import { Filtros } from "@/components/Filtros";
import { CabeceraPagina, Insignia, Seccion, Vacio } from "@/components/ui";
import {
  cobertura, consultoriosParaFiltro, distribucionConsultas, kpis, kpisPorConsultorio, porAppDetalle,
  porMedico, serieDiaria, type Medianas,
} from "@/lib/consultas";
import { leerFiltros, periodoPrevio, type Filtros as F, type Sp } from "@/lib/filtros";
import { colorApp, etiquetaApp, fmtFecha, fmtHoras, fmtMin, fmtNum, fmtPct, fmtSeg } from "@/lib/formato";

/**
 * DATOS: los números en crudo, sin interpretar.
 *
 * Esta página y el Tablero son a propósito distintas y no se pisan: el Tablero CUENTA el rango con
 * gráficos —para mirar y decidir—, y aquí están las cifras exactas, las 31 medianas de cada
 * consultorio, cada jornada suelta y cada app, para comprobar un número, copiarlo o exportarlo.
 * Cuando alguien pregunta «¿de dónde sale eso?», la respuesta está en esta página.
 */

/** Las 31 medianas de `Medianas`, en orden de lectura y con su unidad. Ninguna escondida. */
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

// Los motivos de exclusión de `calidad_motivos`, en palabras. Uno que no esté aquí se muestra tal
// cual: es preferible un tecnicismo a esconder una jornada excluida.
const MOTIVO: Record<string, string> = {
  cobertura: "Cobertura por debajo del 80 % (faltaban cubetas del día)",
  clock_jumps: "Reloj del PC inestable (más de 2 saltos)",
  spool_dropped: "El PC descartó datos (disco lleno)",
  hooks_degradados: "Ganchos de teclado y ratón degradados",
  sin_actividad: "Jornada sin ninguna actividad",
  en_curso: "Jornada todavía en curso",
};

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));

export default async function DatosPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const f = leerFiltros(await searchParams);

  const cob = await cobertura(f);
  const rescatando = !f.incluirMala && cob.buenas === 0 && cob.total > 0;
  const fx: F = rescatando ? { ...f, incluirMala: true } : f;

  const [consultorios, k, kPrevio, porC] = await Promise.all([
    consultoriosParaFiltro(), kpis(fx), kpis(periodoPrevio(fx)), kpisPorConsultorio(fx),
  ]);
  const [serie, apps, consultas, medicos] = await Promise.all([
    serieDiaria(fx), porAppDetalle(fx), distribucionConsultas(fx), porMedico(fx),
  ]);

  const motivos = Object.entries(cob.motivos ?? {}).sort((a, b) => b[1] - a[1]);
  const totalApp = Math.max(1, apps.reduce((s, a) => s + num(a.activo_ms), 0));
  const pctInterrupcion = consultas && consultas.n > 0 ? (num(consultas.con_interrupcion) / consultas.n) * 100 : null;
  const elegido = consultorios.find((c) => c.id === f.consultorio) ?? null;
  const hayPacientes = num(k?.pacientes_med) > 0;

  return (
    <div className="space-y-6">
      <CabeceraPagina
        eyebrow="Datos"
        titulo={elegido ? elegido.nombre : "Los números en crudo"}
        sub={<>Las cifras exactas del rango, para comprobar un número o copiarlo. Cada una es una <strong>mediana por jornada</strong> —un consultorio en un día operativo—. Para verlas contadas con gráficos, el <Link href="/tablero" className="text-accent hover:underline">Tablero</Link>.</>}
      />

      <Filtros f={f} consultorios={consultorios} ruta="/datos" ocultarConsultorio />
      <Alcance f={f} ruta="/datos" consultorios={consultorios} />

      {rescatando && (
        <div className="tarjeta border-warning bg-warning-soft p-4 text-sm text-ink">
          <strong>Ninguna jornada del rango pasó el filtro de calidad</strong>, así que se están enseñando todas —
          incluidas las que el instrumento midió a medias. Sirven para mirar, no para concluir.
        </div>
      )}

      {/* ── 1. El resumen del rango ──────────────────────────────────────── */}
      <Seccion titulo="Resumen del rango"
        sub={`Medianas por jornada de las ${fmtNum(k?.n ?? 0)} jornadas del rango. La mediana es de la jornada, no del rango entero: «activo 6 h» quiere decir que la jornada típica tuvo 6 h de PC activo, no que se sumaran 6 h en total.`}>
        {(k?.n ?? 0) === 0 ? (
          <Vacio titulo="Sin jornadas en este rango"
            texto="Amplía el rango, o comprueba en Inicio que los PCs estén en línea." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Cifra etiqueta="Activo en el PC" valor={fmtMin(k.activo_med)} variante="hero"
              delta={{ antes: kPrevio?.activo_med ?? null, ahora: k.activo_med, mejor: "neutro" }}
              sub={`mediana de ${fmtNum(k.n)} jornadas`} />
            <Cifra etiqueta="En SAP (HIS)" valor={fmtMin(k.his_med)}
              delta={{ antes: kPrevio?.his_med ?? null, ahora: k.his_med, mejor: "menos" }}
              sub={`${fmtPct(k.carga_admin_med)} del activo · Miracle ${fmtMin(k.miracle_med)}`} />
            <Cifra etiqueta="Escribiendo" valor={fmtMin(k.escritura_med)}
              delta={{ antes: kPrevio?.escritura_med ?? null, ahora: k.escritura_med, mejor: "menos" }}
              sub={`${fmtNum(k.clics_med)} clics · ${fmtNum(k.cambios_med)} cambios de contexto`} />
            <Cifra etiqueta="Espera de SAP" valor={fmtSeg(k.espera_sap_med)}
              delta={{ antes: kPrevio?.espera_sap_med ?? null, ahora: k.espera_sap_med, mejor: "menos" }}
              sub={`pantalla lista p95 ${fmtSeg(k.ready_p95_med)} · ${fmtNum(k.pantallas_med)} pantallas`} />
            {hayPacientes
              ? <Cifra etiqueta="Pacientes" valor={fmtNum(k.pacientes_med)} sub={`consulta ${fmtMin(k.consulta_med)} · ${fmtNum(k.pacientes_por_hora_med, 1)} por hora`} />
              : <Cifra etiqueta="Pacientes" valor="—" variante="apagada" motivo="La regla no encuentra al paciente en SAP." />}
            <Cifra etiqueta="Encendido sin uso" valor={fmtMin(k.inactivo_med)} sub={`bloqueado ${fmtMin(k.bloqueado_med)}`} />
            <Cifra etiqueta="Cobertura" valor={fmtPct(k.cobertura_med)} sub={`sin datos ${fmtMin(k.sin_datos_med)} por jornada`} />
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

      {/* ── 2. Las 31 medianas, por consultorio ──────────────────────────── */}
      <Seccion titulo="Las 31 medianas, consultorio por consultorio"
        sub="La misma vara para cada uno: n = jornadas que entran en el cálculo, «buenas» = cuántas pasaron el filtro de calidad. La tabla se desplaza a lo ancho y la primera columna se queda quieta.">
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
      </Seccion>

      {/* ── 3. Cada jornada ──────────────────────────────────────────────── */}
      <Seccion titulo="Cada jornada del rango"
        sub="Una fila por día operativo y consultorio, la más reciente arriba. Clic en el día para abrir su línea de tiempo.">
        {serie.length === 0 ? <p className="text-sm text-muted">Sin jornadas en el rango.</p> : (
          <div className="caja-tabla caja-tabla--alta">
            <table className="tabla tabla--cebra">
              <thead><tr><th>Día</th><th>Consultorio</th><th className="num">Activo</th><th className="num">En SAP</th><th className="num">Escribiendo</th><th className="num">Espera SAP</th><th className="num">Pacientes</th><th>Calidad</th></tr></thead>
              <tbody>
                {[...serie].reverse().map((p) => (
                  <tr key={`${p.fecha}-${p.consultorio_id ?? "sin"}`}>
                    <td className="whitespace-nowrap">{p.consultorio_id
                      ? <Link href={`/consultorios/${p.consultorio_id}?fecha=${p.fecha}`} className="text-accent hover:underline">{fmtFecha(p.fecha)}</Link>
                      : <span className="text-ink">{fmtFecha(p.fecha)}</span>}</td>
                    <td className="whitespace-nowrap text-ink">{p.nombre}</td>
                    <td className="num">{fmtMin(p.activo_ms)}</td>
                    <td className="num">{fmtMin(p.his_ms)}</td>
                    <td className="num">{fmtMin(p.typing_ms)}</td>
                    <td className="num">{fmtMin(p.sap_wait_ms)}</td>
                    <td className="num">{fmtNum(p.pacientes)}</td>
                    <td className="text-xs">{p.calidad_ok ? <span className="text-good-text">comparable</span> : <span className="text-critical">excluida</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {/* ── 4. Por app ───────────────────────────────────────────────────── */}
      <Seccion titulo="Por aplicación"
        sub="Dónde se va el tiempo activo y qué se hizo dentro de cada app. «Delante» es la ventana al frente aunque nadie tocara nada; «activo» es con input real.">
        {apps.length === 0 ? <p className="text-sm text-muted">Sin actividad por app en este rango.</p> : (
          <div className="caja-tabla">
            <table className="tabla tabla--cebra">
              <thead><tr><th>App</th><th className="num">Activo</th><th style={{ minWidth: "7rem" }}>Reparto</th><th className="num">Delante</th><th className="num">Escribiendo</th><th className="num">Teclas</th><th className="num">Clics</th><th className="num">Jornadas</th></tr></thead>
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
        )}
      </Seccion>

      {/* ── 5. Las consultas ─────────────────────────────────────────────── */}
      <Seccion titulo="Las consultas"
        sub="Aquí la unidad NO es la jornada sino el paciente: cada consulta del rango, de la primera a la última tecla sobre esa huella.">
        {!consultas || consultas.n === 0 ? (
          <Vacio titulo="Todavía no hay consultas identificadas"
            texto="El medidor solo separa pacientes cuando puede leer la huella del encuentro en la pantalla de SAP. Se arregla en Configuración → Identidad del paciente." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Cifra etiqueta="Consultas" valor={fmtNum(consultas.n)} variante="hero" sub="pacientes-jornada en el rango" />
            <Cifra etiqueta="p25" valor={fmtMin(consultas.p25)} sub="una de cada cuatro dura menos" />
            <Cifra etiqueta="Mediana" valor={fmtMin(consultas.p50)} sub="la consulta típica" />
            <Cifra etiqueta="p75" valor={fmtMin(consultas.p75)} sub="una de cada cuatro dura más" />
            <Cifra etiqueta="p90" valor={fmtMin(consultas.p90)} sub="la cola larga" />
            <Cifra etiqueta="Activo · SAP" valor={`${fmtMin(consultas.activo_p50)} · ${fmtMin(consultas.his_p50)}`} sub="medianas por consulta" />
            <Cifra etiqueta="Con interrupción" valor={fmtPct(pctInterrupcion)} sub={`${fmtNum(consultas.con_interrupcion)} de ${fmtNum(consultas.n)} · post-atención ${fmtMin(consultas.post_p50)}`} />
          </div>
        )}
      </Seccion>

      {/* ── 6. Quién ─────────────────────────────────────────────────────── */}
      <Seccion titulo="Quién estuvo en SAP"
        sub="Por login de SAP. El médico es una ANOTACIÓN derivada del usuario que estaba en la sesión, no la unidad del estudio: la unidad es el consultorio-día, y un mismo consultorio pasa por varias manos.">
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

      <p className="text-sm text-muted">
        <Link href="/tablero" className="text-accent hover:underline">Tablero</Link> cuenta esto mismo con gráficos,{" "}
        <Link href="/comparacion" className="text-accent hover:underline">Comparación</Link> pone las fases del estudio una al lado de otra,{" "}
        <Link href="/sap" className="text-accent hover:underline">Pantallas SAP</Link> baja a cada transacción, y{" "}
        <Link href="/exportar" className="text-accent hover:underline">Exportar</Link> entrega todo en crudo (CSV y JSON autodescriptivo).
      </p>
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto.
export const maxDuration = 30;
