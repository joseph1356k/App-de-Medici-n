import Link from "next/link";
import { Alcance, Conmutador } from "@/components/Alcance";
import { Cifra } from "@/components/Cifra";
import { Filtros } from "@/components/Filtros";
import { RejillaCalor } from "@/components/RejillaCalor";
import { Barras } from "@/components/graficos/Barras";
import { Columnas } from "@/components/graficos/Columnas";
import { Histograma } from "@/components/graficos/Histograma";
import { Interactivo } from "@/components/graficos/Interactivo";
import { Lineas } from "@/components/graficos/Lineas";
import { CabeceraPagina, Insignia, Seccion, Vacio } from "@/components/ui";
import {
  cobertura, consultoriosParaFiltro, distribucionEsperaSap, kpis, kpisPorConsultorio, perfilHorario,
  porAppYConsultorio, porFase, serieDiaria, tcodesPorEspera, type FilaConsultorio, type Kpis, type Medianas,
} from "@/lib/consultas";
import { conFiltro, leerFiltros, periodoPrevio, type Filtros as F, type Sp } from "@/lib/filtros";
import { colorConsultorio, medianaPorDia, topN, topeBonito, type SerieXY } from "@/lib/graficos";
import { COLOR_FASE, ETIQUETA_FASE, colorApp, etiquetaApp, fmtDiaCorto, fmtFecha, fmtHoras, fmtMin, fmtNum, fmtPct, fmtSeg } from "@/lib/formato";

/**
 * EL TABLERO: los datos contados con gráficos, no con tablas.
 *
 * Está construido sobre tres preguntas y en este orden, que es el orden en que se miran los datos
 * de verdad: cómo va (los titulares), cómo es un día (el perfil por horas y la comparación entre
 * consultorios), y dónde duele (la espera de SAP, el tiempo fuera del HIS).
 *
 * Reglas de la casa, para que un gráfico nuevo no rompa el conjunto:
 *   · Todo cuelga de UNA fila de filtros y UN alcance. Si dos bloques no cuadran es un fallo, no
 *     un filtro distinto.
 *   · Cada gráfico lleva su tabla («ver tabla»): ningún número vive solo dentro de un globo.
 *   · El color va con la entidad — el Consultorio 2 es el mismo naranja en las cinco secciones.
 *   · Lo que no se puede medir todavía se dice, con el motivo. Una casilla vacía sin explicación
 *     hace desconfiar de las que sí tienen número.
 */

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));
const uno = (sp: Sp, k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

/** Las seis medianas que se comparan entre consultorios, con lo que significa subir en cada una. */
const COMPARABLES: { clave: keyof Medianas; label: string; fmt: (v: number | null) => string; mejor: "mas" | "menos" | "neutro" }[] = [
  { clave: "activo_med", label: "Activo en el PC", fmt: fmtMin, mejor: "neutro" },
  { clave: "his_med", label: "En SAP", fmt: fmtMin, mejor: "menos" },
  { clave: "carga_admin_med", label: "Carga de SAP", fmt: fmtPct, mejor: "menos" },
  { clave: "escritura_med", label: "Escribiendo", fmt: fmtMin, mejor: "menos" },
  { clave: "espera_sap_med", label: "Espera de SAP", fmt: fmtSeg, mejor: "menos" },
  { clave: "ready_p95_med", label: "Pantalla lista p95", fmt: fmtSeg, mejor: "menos" },
];

const CALORES = [
  { id: "activo", etiqueta: "Activo", campo: "activo_ms" as const, fmt: fmtHoras, tono: "var(--color-estado-activo)" },
  { id: "sap", etiqueta: "En SAP", campo: "his_ms" as const, fmt: fmtHoras, tono: "var(--color-s1)" },
  { id: "espera", etiqueta: "Espera SAP", campo: "sap_wait_ms" as const, fmt: fmtMin, tono: "var(--color-serious)" },
];

const MOTIVO_PACIENTE = "La regla todavía no encuentra al paciente en SAP. Ver abajo.";

export default async function TableroPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const f = leerFiltros(sp);
  const calor = CALORES.find((c) => c.id === uno(sp, "calor")) ?? CALORES[0];
  const calorEnUrl = calor.id === CALORES[0].id ? null : calor.id;
  const perfilUno = uno(sp, "perfil") ?? null;

  // La cobertura primero y sola: decide si hay algo que enseñar. Si el filtro de calidad dejaría
  // la página en blanco teniendo jornadas, se enseñan igual con el aviso — una página vacía no
  // informa de nada.
  const cob = await cobertura(f);
  const rescatando = !f.incluirMala && cob.buenas === 0 && cob.total > 0;
  const fx: F = rescatando ? { ...f, incluirMala: true } : f;

  const [consultorios, k, kPrevio, porC] = await Promise.all([
    consultoriosParaFiltro(), kpis(fx), kpis(periodoPrevio(fx)), kpisPorConsultorio(fx),
  ]);
  const [serie, perfil, appsC, fases] = await Promise.all([
    serieDiaria(fx), perfilHorario(fx), porAppYConsultorio(fx), porFase(fx),
  ]);
  const [espera, tcodes] = await Promise.all([distribucionEsperaSap(fx), tcodesPorEspera(fx)]);

  const elegido = consultorios.find((c) => c.id === f.consultorio) ?? null;
  const varios = porC.length > 1 && !elegido;
  const orden = [...porC].sort((a, b) => a.orden - b.orden);
  const color = (c: { consultorio_id: string | null; orden: number }) => colorConsultorio(c.orden);
  const enlaces = { calor: calorEnUrl, perfil: perfilUno };

  // ── Las series por día, para las chispas y la tendencia ───────────────────
  const fechas = [...new Set(serie.map((p) => p.fecha))].sort();
  const buenas = serie.filter((p) => fx.incluirMala || p.calidad_ok);
  const porDia = (campo: (p: (typeof serie)[number]) => number | null) =>
    medianaPorDia(buenas.map((p) => ({ fecha: p.fecha, valor: campo(p) })), fechas);
  const chispa = {
    activo: porDia((p) => num(p.activo_ms)), his: porDia((p) => num(p.his_ms)),
    typing: porDia((p) => num(p.typing_ms)), espera: porDia((p) => num(p.sap_wait_ms)),
    ready: porDia((p) => (p.ready_ms_p95 == null ? null : Number(p.ready_ms_p95))),
  };

  // ── El día típico: minutos por hora en una jornada típica ─────────────────
  const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const consPerfil = [...new Map(perfil.map((p) => [p.consultorio_id ?? "sin", p])).values()].sort((a, b) => a.orden - b.orden);
  const perfilDe = (id: string | null): SerieXY[] => {
    const filas = perfil.filter((p) => (p.consultorio_id ?? "sin") === (id ?? "sin"));
    const n = Math.max(1, filas[0]?.jornadas ?? 1);
    const busca = (h: string) => filas.find((x) => x.hora.padStart(2, "0") === h);
    return [
      { id: "sap", nombre: "SAP (HIS)", color: "var(--color-perfil-sap)", valores: HORAS.map((h) => num(busca(h)?.sap_ms) / n) },
      { id: "otras", nombre: "Otras apps", color: "var(--color-perfil-otras)", valores: HORAS.map((h) => num(busca(h)?.otras_ms) / n) },
      { id: "inactivo", nombre: "Encendido sin uso", color: "var(--color-perfil-inactivo)", valores: HORAS.map((h) => num(busca(h)?.inactivo_ms) / n) },
    ];
  };
  const topePerfil = topeBonito(Math.max(1, ...consPerfil.map((c) =>
    Math.max(...HORAS.map((_, i) => perfilDe(c.consultorio_id).reduce((s, x) => s + (x.valores[i] ?? 0), 0))))));
  const mostrarPerfil = perfilUno ? consPerfil.filter((c) => c.consultorio_id === perfilUno) : consPerfil;

  // ── El reparto por app de cada consultorio ────────────────────────────────
  const appsDe = (id: string | null) => appsC.filter((a) => (a.consultorio_id ?? "sin") === (id ?? "sin"));
  const filasApps = orden.map((c) => {
    const suyas = topN(appsDe(c.consultorio_id), 6, (a) => num(a.activo_ms),
      (suma, cuantos) => ({ consultorio_id: c.consultorio_id, nombre: c.nombre, orden: c.orden, app: `resto (${cuantos})`, activo_ms: suma }));
    const total = Math.max(1, suyas.reduce((s, a) => s + num(a.activo_ms), 0));
    return {
      id: c.consultorio_id ?? "sin", etiqueta: c.nombre, texto: fmtHoras(total),
      partes: suyas.map((a) => ({
        id: a.app, nombre: etiquetaApp(a.app), valor: num(a.activo_ms),
        color: a.app.startsWith("resto") ? "var(--color-otro)" : colorApp(a.app),
        texto: fmtPct((num(a.activo_ms) / total) * 100), extra: fmtHoras(a.activo_ms),
      })),
    };
  });
  const sinIdentificar = appsC.filter((a) => a.app === "otro").reduce((s, a) => s + num(a.activo_ms), 0);

  const fasesConDatos = fases.filter((x) => x.n > 0);
  const hayPacientes = num(k?.pacientes_med) > 0;

  return (
    <div className="space-y-6">
      <CabeceraPagina
        eyebrow="Tablero"
        titulo={elegido ? elegido.nombre : "Los tres consultorios"}
        sub={<>Lo medido en el rango, contado con gráficos. Cada número es una <strong>mediana por jornada</strong> —un consultorio en un día operativo—, que es la unidad del estudio. Pasa el cursor por un gráfico para ver sus valores, o abre «ver tabla» para leerlos todos.</>}
      />

      <Filtros f={f} consultorios={consultorios} ruta="/tablero" ocultarConsultorio />
      <Alcance f={f} ruta="/tablero" consultorios={consultorios} extra={enlaces} />

      {rescatando && (
        <div className="tarjeta border-warning bg-warning-soft p-4 text-sm text-ink">
          <strong>Ninguna jornada del rango pasó el filtro de calidad</strong>, así que se están enseñando todas —
          incluidas las que el instrumento midió a medias. Sirven para mirar, no para concluir.
        </div>
      )}

      {/* ── 1. Cómo va ───────────────────────────────────────────────────── */}
      <Seccion
        titulo="Cómo va"
        sub={`Mediana de las ${fmtNum(k?.n ?? 0)} jornadas del rango, con su tendencia día a día y el cambio frente al periodo anterior del mismo largo.`}
        accion={
          <span className="text-xs text-muted">
            {fmtNum(cob.buenas)} de {fmtNum(cob.total)} jornadas comparables · cobertura {fmtPct(cob.cobertura_media)}
          </span>
        }
      >
        {(k?.n ?? 0) === 0 ? (
          <Vacio titulo="Todavía no hay jornadas en este rango"
            texto="Ningún consultorio tiene un día operativo cerrado aquí. Amplía el rango, o comprueba en Inicio que los tres PCs estén en línea." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
            <Cifra clase="xl:col-span-2" etiqueta="Activo en el PC" valor={fmtMin(k.activo_med)} variante="hero"
              delta={{ antes: kPrevio?.activo_med ?? null, ahora: k.activo_med, mejor: "neutro" }}
              tendencia={{ valores: chispa.activo }}
              reparto={[
                { nombre: "SAP", valor: num(k.his_med), color: "var(--color-perfil-sap)" },
                { nombre: "Otras apps", valor: Math.max(0, num(k.activo_med) - num(k.his_med) - num(k.miracle_med)), color: "var(--color-perfil-otras)" },
                { nombre: "Miracle", valor: num(k.miracle_med), color: "var(--color-s2)" },
              ]}
              sub="por jornada" />
            <Cifra etiqueta="En SAP (HIS)" valor={fmtMin(k.his_med)}
              delta={{ antes: kPrevio?.his_med ?? null, ahora: k.his_med, mejor: "menos" }}
              tendencia={{ valores: chispa.his }} sub={`${fmtPct(k.carga_admin_med)} del tiempo activo`} />
            <Cifra etiqueta="Escribiendo" valor={fmtMin(k.escritura_med)}
              delta={{ antes: kPrevio?.escritura_med ?? null, ahora: k.escritura_med, mejor: "menos" }}
              tendencia={{ valores: chispa.typing }} sub={`${fmtNum(k.clics_med)} clics · ${fmtNum(k.cambios_med)} cambios de contexto`} />
            <Cifra etiqueta="Espera de SAP" valor={fmtSeg(k.espera_sap_med)}
              delta={{ antes: kPrevio?.espera_sap_med ?? null, ahora: k.espera_sap_med, mejor: "menos" }}
              tendencia={{ valores: chispa.espera }} sub="esperando al servidor, por jornada" />
            <Cifra etiqueta="Pantalla lista p95" valor={fmtSeg(k.ready_p95_med)}
              delta={{ antes: kPrevio?.ready_p95_med ?? null, ahora: k.ready_p95_med, mejor: "menos" }}
              tendencia={{ valores: chispa.ready }} sub={`una de cada veinte tarda esto o más · ${fmtNum(k.pantallas_med)} pantallas`} />
            {hayPacientes ? (
              <Cifra etiqueta="Pacientes" valor={fmtNum(k.pacientes_med)}
                delta={{ antes: kPrevio?.pacientes_med ?? null, ahora: k.pacientes_med, mejor: "mas" }}
                sub={`${fmtNum(k.pacientes_por_hora_med, 1)} por hora de actividad · consulta ${fmtMin(k.consulta_med)}`} />
            ) : (
              <Cifra etiqueta="Pacientes" valor="—" variante="apagada" motivo={MOTIVO_PACIENTE} />
            )}
          </div>
        )}
      </Seccion>

      {/* ── 2. El día típico ─────────────────────────────────────────────── */}
      <Seccion
        titulo="El día típico"
        sub="Minutos por hora de Bogotá en una jornada típica: cuánto en SAP, cuánto en otras apps y cuánto con el PC encendido sin que nadie lo toque. No suma 60 min por hora a propósito — lo que sobra de una cubeta con actividad no se le atribuye a nadie, igual que en los totales del día."
        accion={varios && consPerfil.length > 1 ? (
          <Conmutador f={f} ruta="/tablero" parametro="perfil" actual={perfilUno ?? "todos"} extra={{ calor: calorEnUrl }}
            opciones={[{ id: "todos", etiqueta: "Los tres" }, ...consPerfil.map((c) => ({ id: c.consultorio_id ?? "sin", etiqueta: c.nombre }))]} />
        ) : undefined}
      >
        {mostrarPerfil.length === 0 ? (
          <p className="text-sm text-muted">Todavía sin perfil por horas. Se calcula al resumir cada jornada; las de antes de este cambio lo tendrán tras el resumen de las 06:30.</p>
        ) : (
          <div className={mostrarPerfil.length > 1 ? "grid gap-5 lg:grid-cols-3" : ""}>
            {mostrarPerfil.map((c) => (
              <div key={c.consultorio_id ?? "sin"}>
                {mostrarPerfil.length > 1 && (
                  <p className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color(c) }} aria-hidden />
                    {c.nombre}
                  </p>
                )}
                <Interactivo modo="cruceta">
                  <Columnas
                    ancho={mostrarPerfil.length > 1 ? 420 : 1100}
                    xs={HORAS} etiquetaX={(h) => h} etiquetaLarga={(h) => `${h}:00 – ${h}:59 · ${c.nombre}`}
                    series={perfilDe(c.consultorio_id)} tope={topePerfil} alto={mostrarPerfil.length > 1 ? 180 : 260}
                    fmt={(v) => `${Math.round(v / 60000)} min`} ariaLabel={`El día típico de ${c.nombre}, por hora`}
                    cabeceraTabla="Hora" notaTabla={`Media de ${fmtNum(c.jornadas)} jornadas.`}
                  />
                </Interactivo>
              </div>
            ))}
          </div>
        )}
      </Seccion>

      {/* ── 3. Consultorio frente a consultorio ──────────────────────────── */}
      {varios && (
        <Seccion titulo="Un consultorio al lado de otro"
          sub="La misma vara para los tres. El pelo vertical es la mediana de todas las jornadas juntas: dice de un vistazo quién se separa del conjunto, y hacia qué lado.">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {COMPARABLES.map((m) => {
              const ref = k?.[m.clave] == null ? null : Number(k[m.clave]);
              const filas = orden.map((c: FilaConsultorio) => {
                const v = c[m.clave] == null ? 0 : Number(c[m.clave]);
                return { id: c.consultorio_id ?? "sin", etiqueta: c.nombre, texto: m.fmt(v || null),
                  partes: [{ id: "v", nombre: m.label, valor: v, color: color(c), texto: m.fmt(v || null) }] };
              });
              const tope = topeBonito(Math.max(1, ...filas.map((x) => x.partes[0].valor), ref ?? 0));
              return (
                <div key={m.clave}>
                  <p className="mb-2 text-sm font-medium text-ink">{m.label}</p>
                  <Interactivo modo="marca">
                    <Barras filas={filas} tope={tope} ariaLabel={`${m.label} por consultorio`} cabeceraTabla="Consultorio"
                      referencia={ref == null ? undefined : { valor: ref, etiqueta: `mediana de todos: ${m.fmt(ref)}` }} />
                  </Interactivo>
                </div>
              );
            })}
          </div>
        </Seccion>
      )}

      {/* ── 4. En qué se va el tiempo ────────────────────────────────────── */}
      <Seccion titulo="En qué se va el tiempo"
        sub="El reparto del tiempo activo por aplicación, con el mismo ancho para cada consultorio: lo que cambia entre ellos es la proporción, no el total.">
        {filasApps.length === 0 ? <p className="text-sm text-muted">Sin actividad por app en este rango.</p> : (
          <>
            <Interactivo modo="marca">
              <Barras filas={filasApps} modo="cien" leyenda ariaLabel="Reparto del tiempo activo por app y consultorio" cabeceraTabla="Consultorio" />
            </Interactivo>
            {sinIdentificar > 0 && (
              <p className="mt-3 text-xs text-secondary">
                <Insignia tono="aviso">Sin identificar: {fmtHoras(sinIdentificar)}</Insignia>{" "}
                son programas que el catálogo no conocía cuando se midieron. Desde el medidor 2.0.5 cada uno viaja con su
                propio nombre; se le pone nombre bonito en <Link href="/configuracion" className="text-accent hover:underline">Configuración</Link>.
              </p>
            )}
          </>
        )}
      </Seccion>

      {/* ── 5. Cuánto se espera a SAP ────────────────────────────────────── */}
      <Seccion titulo="Cuánto se espera a SAP"
        sub="Cuánto tarda una pantalla en quedar lista, repartido en tramos. La mediana sola escondería la cola: aquí se ve cuántas pantallas pasan de un minuto.">
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Interactivo modo="cruceta">
              <Histograma ancho={700} conteos={espera.conteos} p50={espera.p50} p95={espera.p95} ariaLabel="Distribución de la espera de SAP" />
            </Interactivo>
          </div>
          <div className="lg:col-span-2">
            <p className="mb-2 text-sm font-medium text-ink">Dónde se acumula</p>
            {tcodes.length === 0 ? <p className="text-sm text-muted">Sin transacciones en este rango.</p> : (
              <Interactivo modo="marca">
                <Barras ariaLabel="Transacciones con más espera acumulada" cabeceraTabla="Transacción"
                  notaTabla="Total esperado al servidor en el rango, sumando todas las visitas de esa transacción."
                  filas={tcodes.map((t) => ({
                    id: t.tcode, etiqueta: t.tcode, texto: fmtMin(t.espera_total_ms),
                    partes: [{
                      id: "espera", nombre: "Espera acumulada", valor: num(t.espera_total_ms), color: "var(--color-serious)",
                      texto: fmtMin(t.espera_total_ms), extra: `${fmtNum(t.visitas)} visitas · p95 ${fmtSeg(t.ready_p95)}`,
                    }],
                  }))} />
              </Interactivo>
            )}
          </div>
        </div>
      </Seccion>

      {/* ── 6. Día a día ─────────────────────────────────────────────────── */}
      <Seccion titulo="Día a día"
        sub="Cada consultorio y cada día operativo del rango. Clic en una celda para abrir ese día."
        accion={<Conmutador f={f} ruta="/tablero" parametro="calor" actual={calor.id} opciones={CALORES} extra={{ perfil: perfilUno }} />}
      >
        {serie.length === 0 ? <p className="text-sm text-muted">Sin jornadas en el rango.</p> : (
          <>
            <RejillaCalor puntos={serie} fechas={fechas.slice(-60)} campo={calor.campo} fmt={calor.fmt} tono={calor.tono} />
            <div className="mt-5">
              <Interactivo modo="cruceta">
                <Lineas
                  xs={fechas}
                  etiquetaX={(d) => fmtDiaCorto(d)}
                  etiquetaLarga={(d) => fmtFecha(d)}
                  series={orden.map((c) => ({
                    id: c.consultorio_id ?? "sin", nombre: c.nombre, color: color(c),
                    valores: fechas.map((d) => {
                      const p = serie.find((x) => x.fecha === d && (x.consultorio_id ?? "sin") === (c.consultorio_id ?? "sin"));
                      return p ? num(p[calor.campo]) : null;
                    }),
                  }))}
                  ancho={1200} fmt={calor.fmt} ariaLabel={`${calor.etiqueta} por día y consultorio`} cabeceraTabla="Día" alto={280}
                />
              </Interactivo>
            </div>
          </>
        )}
      </Seccion>

      {/* ── 7. Las fases del estudio ─────────────────────────────────────── */}
      <Seccion titulo="Las fases del estudio"
        sub="Lo que el estudio quiere responder: qué cambia entre el antes y el después de Miracle, con la misma medida.">
        {fasesConDatos.length < 2 ? (
          <p className="text-sm text-muted">
            Todavía hay una sola fase con jornadas ({fasesConDatos.map((x) => ETIQUETA_FASE[x.phase] ?? x.phase).join(", ") || "ninguna"}).
            La comparación aparece sola en cuanto haya jornadas en una segunda fase; el calendario se define en{" "}
            <Link href="/configuracion" className="text-accent hover:underline">Configuración</Link>.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {COMPARABLES.map((m) => (
              <div key={m.clave}>
                <p className="mb-2 text-sm font-medium text-ink">{m.label}</p>
                <Interactivo modo="marca">
                  <Barras ariaLabel={`${m.label} por fase`} cabeceraTabla="Fase"
                    filas={fasesConDatos.map((x) => {
                      const v = x[m.clave] == null ? 0 : Number(x[m.clave]);
                      return { id: x.phase, etiqueta: ETIQUETA_FASE[x.phase] ?? x.phase, texto: m.fmt(v || null),
                        partes: [{ id: "v", nombre: m.label, valor: v, color: COLOR_FASE[x.phase] ?? "var(--color-otro)", texto: m.fmt(v || null), extra: `${fmtNum(x.n)} jornadas` }] };
                    })} />
                </Interactivo>
              </div>
            ))}
          </div>
        )}
      </Seccion>

      {/* ── 8. Por paciente ──────────────────────────────────────────────── */}
      <Seccion titulo="Por paciente"
        sub="Lo que cuesta una consulta. Es la unidad más fina del estudio: no la jornada, sino cada encuentro.">
        {hayPacientes ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Cifra etiqueta="Consulta (mediana)" valor={fmtMin(k.consulta_med)} sub="de la primera a la última tecla" />
            <Cifra etiqueta="Activo por paciente" valor={fmtMin(k.por_paciente_med)} sub="solo el tiempo con input" />
            <Cifra etiqueta="Hasta el siguiente" valor={fmtMin(k.entre_consultas_med)} sub="hueco entre una consulta y otra" />
            <Cifra etiqueta="Post-atención" valor={fmtMin(k.post_med)} sub="trabajo sobre un paciente ya cerrado" />
            <Cifra etiqueta="Interrupciones" valor={fmtNum(k.interrupciones_med)} sub="consultas retomadas después de otra" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {["Pacientes", "Consulta (mediana)", "Activo por paciente", "Hasta el siguiente", "Post-atención"].map((e) => (
                <Cifra key={e} etiqueta={e} valor="—" variante="apagada" />
              ))}
            </div>
            <p className="mt-3 text-sm text-secondary">
              Estas cinco —y «arranque del día», «cola de documentación» e «interrupciones» en la vista de un día— dependen todas de
              lo mismo: identificar al paciente en la pantalla de SAP. La regla actual busca un número en el título de la ventana y
              no lo encuentra nunca. Se arregla sin reinstalar nada desde{" "}
              <Link href="/configuracion" className="text-accent hover:underline">Configuración → Identidad del paciente</Link>,
              que enseña qué forma tiene ese título en los PCs.
            </p>
          </>
        )}
      </Seccion>

      <p className="text-sm text-muted">
        Este tablero cuenta el rango con gráficos. Para el detalle: <Link href="/datos" className="text-accent hover:underline">Datos</Link> trae
        las 31 medianas y cada jornada suelta, <Link href="/sap" className="text-accent hover:underline">Pantallas SAP</Link> baja a cada
        transacción, y <Link href="/exportar" className="text-accent hover:underline">Exportar</Link> entrega todo en crudo.
      </p>
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto.
export const maxDuration = 30;
