// Las consultas del panel. Todo sale de jornada_summary (agregado por consultorio y día, sin
// PHI) y, para el día de un consultorio, del crudo (samples/events/sap_visits) convertido en
// segmentos por lib/segmentos.ts. Las jornadas de mala calidad se EXCLUYEN por defecto de
// medianas y comparaciones — una mediana sobre días a medio medir miente — pero siempre se
// cuentan en el bloque de cobertura.
//
// Las fechas `date` de Postgres se piden como texto (::text): postgres.js las convertiría
// en un Date a medianoche UTC, que en Bogotá es «ayer».
import { sql } from "./db";
import type { Filtros } from "./filtros";
import { finDiaOperativo, hoyOperativo, inicioDiaOperativo } from "./fechas";
import {
  medicosVistos, pacientesDelDia, segmentar,
  type Bucket, type Estado, type Marca, type MedicoVisto, type PacienteDelDia, type Segmento,
} from "./segmentos";

export type { Estado, Marca, MedicoVisto, PacienteDelDia, Segmento } from "./segmentos";

const iso = (t: unknown): string | null => (t == null ? null : new Date(t as string).toISOString());

export const filtroJornadas = (f: Filtros) => sql`
  j.dia_operativo between ${f.desde}::date and ${f.hasta}::date
  ${f.fase ? sql`and j.phase = ${f.fase}` : sql``}
  ${f.consultorio ? sql`and j.consultorio_id = ${f.consultorio}::uuid` : sql``}
  ${f.dispositivo ? sql`and j.device_id = ${f.dispositivo}::uuid` : sql``}`;

const buenas = (f: Filtros) => sql`${filtroJornadas(f)} ${f.incluirMala ? sql`` : sql`and j.calidad_ok`}`;

// ── El resumen de una jornada (fila de jornada_summary con nombres) ─────────

export type JornadaResumen = {
  device_id: string; dia_operativo: string; consultorio_id: string | null; consultorio: string | null; machine_name: string | null; phase: string;
  primera_actividad: string | null; ultima_actividad: string | null; primera_muestra: string | null; ultima_muestra: string | null; ventana_ms: number;
  foreground_ms: number; activo_ms: number; his_ms: number; miracle_ms: number;
  activo_por_app: Record<string, number>; sap_users: Record<string, number>;
  typing_ms: number; keystrokes: number; clicks: number; scroll_ticks: number; context_switches: number;
  tabs: number; enters: number; correcciones: number; copias: number; pegados: number; guardados: number;
  pacientes: number; consulta_ms_mediana: number | null; activo_por_paciente_mediana: number | null; entre_consultas_ms_mediana: number | null;
  post_atencion_ms: number; interrupciones: number; pacientes_por_hora: number | null;
  visitas: number; pantallas_distintas: number; revisitas_sap: number; sap_wait_ms: number; sap_roundtrips: number;
  ready_ms_p50: number | null; ready_ms_p95: number | null;
  bloqueado_ms: number; inactivo_ms: number; sin_datos_ms: number; cobertura_pct: number | null; carga_admin_pct: number | null;
  tramos: number; tramos_ms: number; procesos: number; app_version: string;
  pre_atencion_ms: number; cola_post_jornada_ms: number; consulta_ms_p25: number | null; consulta_ms_p75: number | null;
  por_app: Record<string, { activo_ms: number; foreground_ms: number; typing_ms: number; keystrokes: number; clicks: number }>;
  por_hora: Record<string, number>;
  calidad: Record<string, number | boolean | null>; calidad_ok: boolean; calidad_motivos: string[];
  sucia: boolean; resumido_en: string | null; algo_version: number;
};

const columnasResumen = sql`j.*, j.dia_operativo::text as dia_operativo, c.nombre as consultorio, d.machine_name`;
const desdeResumen = sql`from jornada_summary j left join consultorios c on c.id = j.consultorio_id left join devices d on d.id = j.device_id`;

export async function jornada(deviceId: string, fecha: string): Promise<JornadaResumen | null> {
  const [r] = await sql<JornadaResumen[]>`select ${columnasResumen} ${desdeResumen} where j.device_id = ${deviceId}::uuid and j.dia_operativo = ${fecha}::date`;
  return r ?? null;
}

export async function jornadas(f: Filtros, page: number, tamano = 25): Promise<{ filas: JornadaResumen[]; total: number }> {
  const [filas, [{ total }]] = await Promise.all([
    sql<JornadaResumen[]>`select ${columnasResumen} ${desdeResumen}
      where ${filtroJornadas(f)}
      order by j.dia_operativo desc, c.orden nulls last, c.nombre, d.machine_name
      limit ${tamano} offset ${(page - 1) * tamano}`,
    sql<{ total: number }[]>`select count(*)::int as total from jornada_summary j where ${filtroJornadas(f)}`,
  ]);
  return { filas, total };
}

// ── El estado de cada consultorio, ahora ────────────────────────────────────

export type EstadoConsultorio = {
  consultorio: { id: string; nombre: string; orden: number };
  device: { id: string; machine_name: string; app_version: string; last_seen_at: string | null; last_sample_at: string | null } | null;
  en_linea: boolean;                       // latido hace menos de 3 minutos
  estado_actual: Estado | "sin_pc";
  ultima_cubeta: string | null;
  app_actual: string | null; tcode_actual: string | null; sap_user: string | null;
  medico: { id: string; nombre: string } | null;
  hoy: { activo_ms: number; his_ms: number; pacientes: number; ultima_actividad: string | null; tramos: number; calidad_ok: boolean; calidad: Record<string, number | boolean | null> } | null;
  alertas: string[];
};

type FilaEstado = {
  id: string; nombre: string; orden: number;
  device_id: string | null; machine_name: string | null; app_version: string | null; last_seen_at: string | null; last_sample_at: string | null;
  en_linea: boolean; ultima_cubeta: string | null; app: string | null; surface: string | null; sap_user: string | null; active_ms: number | null;
  tcode: string | null; medico_id: string | null; medico: string | null;
  pacientes: number | null; activo_ms: number | null; his_ms: number | null; ultima_actividad: string | null; tramos: number | null;
  calidad_ok: boolean | null; calidad: Record<string, number | boolean | null> | null;
};

export async function estadoConsultorios(): Promise<EstadoConsultorio[]> {
  const filas = await sql<FilaEstado[]>`
    select c.id, c.nombre, c.orden,
      d.id as device_id, d.machine_name, d.app_version, d.last_seen_at, d.last_sample_at,
      (d.id is not null and d.last_seen_at > now() - interval '3 minutes') as en_linea,
      u.bucket_start as ultima_cubeta, u.app, u.surface, u.sap_user, u.active_ms,
      substring(u.surface from '^sapgui://[^/]+/([^/]*)') as tcode,
      r.id as medico_id, r.display_name as medico,
      j.pacientes, j.activo_ms, j.his_ms, j.ultima_actividad, j.tramos, j.calidad_ok, j.calidad
    from consultorios c
    left join lateral (select * from devices x where x.consultorio_id = c.id and x.status = 'active' order by x.last_seen_at desc limit 1) d on true
    left join lateral (select s.bucket_start, s.app, s.surface, s.sap_user, s.active_ms from samples s
                       where s.device_id = d.id order by s.bucket_start desc, s.seq desc limit 1) u on true
    left join roster r on r.id = medico_de(u.sap_user)
    left join jornada_summary j on j.device_id = d.id and j.dia_operativo = dia_operativo_de(now())
    where c.activo
    order by c.orden, c.nombre`;
  const ahora = Date.now();
  return filas.map((x) => {
    const ultima = iso(x.ultima_cubeta);
    const haceMin = (t: string | null) => (t ? Math.round((ahora - Date.parse(t)) / 60000) : null);
    let estado: EstadoConsultorio["estado_actual"] = "sin_pc";
    if (x.device_id) {
      if (!ultima || ahora - Date.parse(ultima) > 3 * 60000) estado = "sin_datos";
      else if (x.app === "bloqueado") estado = "bloqueado";
      else if ((x.active_ms ?? 0) > 0) estado = "activo";
      else estado = "inactivo";
    }
    const cal = x.calidad ?? {};
    const alertas: string[] = [];
    const latido = haceMin(iso(x.last_seen_at));
    if (!x.device_id) alertas.push("Sin PC asignado: asígnalo en Dispositivos");
    else if (latido != null && latido > 20) alertas.push(`PC callado hace ${latido} min`);
    else if (!x.en_linea && latido != null) alertas.push(`Último latido hace ${latido} min`);
    if (cal.hooks_degradados === true) alertas.push("Ganchos de teclado y ratón degradados (antivirus)");
    if (cal.sap_scripting === false) alertas.push("SAP GUI Scripting no disponible: sin pantallas ni pacientes");
    if (typeof cal.spool_dropped === "number" && cal.spool_dropped > 0) alertas.push("La cola local del PC descartó datos");
    if (typeof cal.clock_jumps === "number" && cal.clock_jumps > 2) alertas.push("Reloj del PC inestable");
    if (typeof cal.procesos === "number" && cal.procesos > 1) alertas.push(`Medidor relanzado ${cal.procesos - 1} ${cal.procesos - 1 === 1 ? "vez" : "veces"} hoy`);
    return {
      consultorio: { id: x.id, nombre: x.nombre, orden: x.orden },
      device: x.device_id ? { id: x.device_id, machine_name: x.machine_name ?? "", app_version: x.app_version ?? "", last_seen_at: iso(x.last_seen_at), last_sample_at: iso(x.last_sample_at) } : null,
      en_linea: !!x.en_linea,
      estado_actual: estado,
      ultima_cubeta: ultima,
      app_actual: estado === "activo" || estado === "inactivo" ? x.app : null,
      tcode_actual: estado === "activo" || estado === "inactivo" ? x.tcode : null,
      sap_user: x.sap_user,
      medico: x.medico_id && x.medico ? { id: x.medico_id, nombre: x.medico } : null,
      hoy: x.pacientes == null ? null : {
        activo_ms: x.activo_ms ?? 0, his_ms: x.his_ms ?? 0, pacientes: x.pacientes, ultima_actividad: iso(x.ultima_actividad),
        tramos: x.tramos ?? 0, calidad_ok: !!x.calidad_ok, calidad: cal,
      },
      alertas,
    };
  });
}

// ── El día de un consultorio: la línea de tiempo ────────────────────────────

export type VisitaSap = {
  visit_uid: string; tcode: string; surface: string; dynpro: string; entered_at: string; left_at: string | null; dwell_ms: number;
  ready_ms: number | null; sap_wait_ms: number; roundtrips: number; exit_to: string | null; encounter_key: string | null; sap_user: string | null;
};

export type LineaDeTiempoDia = {
  consultorio: { id: string; nombre: string };
  device: { id: string; machine_name: string } | null;
  fecha: string; desde: string; hasta: string;
  segmentos: Segmento[]; marcas: Marca[]; visitas: VisitaSap[]; pacientes: PacienteDelDia[];
  resumen: JornadaResumen | null; medicos_vistos: MedicoVisto[];
};

export async function visitasDelDia(consultorioId: string, fecha: string): Promise<VisitaSap[]> {
  const filas = await sql<VisitaSap[]>`
    select visit_uid, tcode, surface, dynpro, entered_at, left_at, dwell_ms, ready_ms, sap_wait_ms, roundtrips, exit_to, encounter_key, sap_user
    from sap_visits where consultorio_id = ${consultorioId}::uuid and dia_operativo = ${fecha}::date order by entered_at`;
  return filas.map((v) => ({ ...v, entered_at: iso(v.entered_at)!, left_at: iso(v.left_at) }));
}

export async function eventosDelDia(consultorioId: string, fecha: string): Promise<Marca[]> {
  const filas = await sql<{ t: string; kind: string; detail: Marca["detail"] }[]>`
    select occurred_at as t, kind, detail from events
    where consultorio_id = ${consultorioId}::uuid and dia_operativo = ${fecha}::date order by occurred_at`;
  return filas.map((e) => ({ t: iso(e.t)!, kind: e.kind, detail: e.detail ?? {} }));
}

export async function lineaDeTiempoDia(consultorioId: string, fecha: string): Promise<LineaDeTiempoDia | null> {
  const [c] = await sql<{ id: string; nombre: string }[]>`select id, nombre from consultorios where id = ${consultorioId}::uuid`;
  if (!c) return null;
  const desde = inicioDiaOperativo(fecha);
  const finDia = finDiaOperativo(fecha);
  const hasta = finDia < new Date().toISOString() ? finDia : new Date().toISOString();

  const [buckets, marcas, visitas, resumenes, roster] = await Promise.all([
    sql<Bucket[]>`select bucket_start, bucket_ms, seq, app, surface, encounter_key, sap_user, foreground_ms, active_ms, typing_ms, keystrokes, clicks, sap_wait_ms
      from samples where consultorio_id = ${consultorioId}::uuid and dia_operativo = ${fecha}::date order by bucket_start, seq`,
    eventosDelDia(consultorioId, fecha),
    visitasDelDia(consultorioId, fecha),
    sql<JornadaResumen[]>`select ${columnasResumen} ${desdeResumen}
      where j.consultorio_id = ${consultorioId}::uuid and j.dia_operativo = ${fecha}::date order by j.activo_ms desc`,
    sql<{ id: string; display_name: string; sap_users: string[] }[]>`select id, display_name, sap_users from roster`,
  ]);
  const segmentos = segmentar(buckets);
  const resumen = resumenes[0] ?? null;
  return {
    consultorio: c,
    device: resumen ? { id: resumen.device_id, machine_name: resumen.machine_name ?? "" } : null,
    fecha, desde, hasta,
    segmentos, marcas, visitas,
    pacientes: pacientesDelDia(segmentos, visitas),
    resumen,
    medicos_vistos: medicosVistos(segmentos, roster),
  };
}

// ── KPIs y comparaciones (medianas por jornada) ─────────────────────────────

const medianas = sql`
  percentile_cont(0.5) within group (order by j.activo_ms) as activo_med,
  percentile_cont(0.5) within group (order by j.his_ms) as his_med,
  percentile_cont(0.5) within group (order by j.miracle_ms) as miracle_med,
  percentile_cont(0.5) within group (order by j.typing_ms) as escritura_med,
  percentile_cont(0.5) within group (order by j.clicks) as clics_med,
  percentile_cont(0.5) within group (order by j.context_switches) as cambios_med,
  percentile_cont(0.5) within group (order by j.pacientes) as pacientes_med,
  percentile_cont(0.5) within group (order by j.activo_por_paciente_mediana) filter (where j.activo_por_paciente_mediana is not null) as por_paciente_med,
  percentile_cont(0.5) within group (order by j.post_atencion_ms) as post_med,
  percentile_cont(0.5) within group (order by j.sap_wait_ms) as espera_sap_med,
  percentile_cont(0.5) within group (order by j.ready_ms_p95) filter (where j.ready_ms_p95 is not null) as ready_p95_med,
  percentile_cont(0.5) within group (order by j.tramos_ms) as tramos_ms_med,
  percentile_cont(0.5) within group (order by j.pantallas_distintas) as pantallas_med,
  percentile_cont(0.5) within group (order by j.tabs) as tabs_med,
  percentile_cont(0.5) within group (order by j.enters) as enters_med,
  percentile_cont(0.5) within group (order by j.correcciones) as correcciones_med,
  percentile_cont(0.5) within group (order by j.copias) as copias_med,
  percentile_cont(0.5) within group (order by j.pegados) as pegados_med,
  percentile_cont(0.5) within group (order by j.guardados) as guardados_med,
  percentile_cont(0.5) within group (order by j.interrupciones) as interrupciones_med,
  percentile_cont(0.5) within group (order by j.revisitas_sap) as revisitas_med,
  percentile_cont(0.5) within group (order by j.pacientes_por_hora) filter (where j.pacientes_por_hora is not null) as pacientes_por_hora_med,
  percentile_cont(0.5) within group (order by j.consulta_ms_mediana) filter (where j.consulta_ms_mediana is not null) as consulta_med,
  percentile_cont(0.5) within group (order by j.entre_consultas_ms_mediana) filter (where j.entre_consultas_ms_mediana is not null) as entre_consultas_med,
  percentile_cont(0.5) within group (order by j.carga_admin_pct) filter (where j.carga_admin_pct is not null) as carga_admin_med,
  percentile_cont(0.5) within group (order by j.bloqueado_ms) as bloqueado_med,
  percentile_cont(0.5) within group (order by j.inactivo_ms) as inactivo_med,
  percentile_cont(0.5) within group (order by j.sin_datos_ms) as sin_datos_med,
  percentile_cont(0.5) within group (order by j.cobertura_pct) filter (where j.cobertura_pct is not null) as cobertura_med,
  percentile_cont(0.5) within group (order by j.pre_atencion_ms) as pre_med,
  percentile_cont(0.5) within group (order by j.cola_post_jornada_ms) as cola_med`;

export type Medianas = {
  activo_med: number | null; his_med: number | null; miracle_med: number | null; escritura_med: number | null; clics_med: number | null;
  cambios_med: number | null; pacientes_med: number | null; por_paciente_med: number | null; post_med: number | null; espera_sap_med: number | null;
  ready_p95_med: number | null; tramos_ms_med: number | null; pantallas_med: number | null;
  tabs_med: number | null; enters_med: number | null; correcciones_med: number | null; copias_med: number | null; pegados_med: number | null; guardados_med: number | null;
  interrupciones_med: number | null; revisitas_med: number | null; pacientes_por_hora_med: number | null; consulta_med: number | null;
  entre_consultas_med: number | null; carga_admin_med: number | null; bloqueado_med: number | null; inactivo_med: number | null; sin_datos_med: number | null; cobertura_med: number | null;
  pre_med: number | null; cola_med: number | null;
};

export type Kpis = Medianas & { n: number };

export async function kpis(f: Filtros): Promise<Kpis> {
  const [k] = await sql<Kpis[]>`select count(*)::int as n, ${medianas} from jornada_summary j where ${buenas(f)}`;
  return k;
}

export type FilaConsultorio = Medianas & { consultorio_id: string | null; nombre: string; orden: number; n: number; buenas: number };

export async function kpisPorConsultorio(f: Filtros): Promise<FilaConsultorio[]> {
  return sql<FilaConsultorio[]>`
    select j.consultorio_id, coalesce(c.nombre, 'Sin consultorio') as nombre, coalesce(c.orden, 999) as orden,
      count(*)::int as n, count(*) filter (where j.calidad_ok)::int as buenas, ${medianas}
    from jornada_summary j left join consultorios c on c.id = j.consultorio_id
    where ${buenas(f)}
    group by j.consultorio_id, c.nombre, c.orden order by orden, nombre`;
}

export type Cobertura = { total: number; buenas: number; excluidas: number; cobertura_media: number | null; en_curso: number; motivos: Record<string, number> };

export async function cobertura(f: Filtros): Promise<Cobertura> {
  const [[c], motivos] = await Promise.all([
    sql<Omit<Cobertura, "motivos">[]>`
      select count(*)::int as total,
        count(*) filter (where j.calidad_ok)::int as buenas,
        count(*) filter (where not j.calidad_ok)::int as excluidas,
        round(avg(j.cobertura_pct), 1) as cobertura_media,
        count(*) filter (where j.dia_operativo = dia_operativo_de(now()))::int as en_curso
      from jornada_summary j where ${filtroJornadas(f)}`,
    sql<{ motivo: string; n: number }[]>`
      select m as motivo, count(*)::int as n from jornada_summary j, unnest(j.calidad_motivos) m
      where ${filtroJornadas(f)} and not j.calidad_ok group by m order by n desc`,
  ]);
  return { ...c, motivos: Object.fromEntries(motivos.map((m) => [m.motivo, m.n])) };
}

export type PuntoDiario = { fecha: string; consultorio_id: string | null; nombre: string; activo_ms: number; his_ms: number; pacientes: number; calidad_ok: boolean };

/** Una fila por día operativo y consultorio (todas las jornadas, con su bandera de calidad). */
export async function serieDiaria(f: Filtros): Promise<PuntoDiario[]> {
  return sql<PuntoDiario[]>`
    select j.dia_operativo::text as fecha, j.consultorio_id, coalesce(c.nombre, 'Sin consultorio') as nombre,
      sum(j.activo_ms)::bigint as activo_ms, sum(j.his_ms)::bigint as his_ms, sum(j.pacientes)::int as pacientes, bool_and(j.calidad_ok) as calidad_ok
    from jornada_summary j left join consultorios c on c.id = j.consultorio_id
    where ${filtroJornadas(f)}
    group by j.dia_operativo, j.consultorio_id, c.nombre, c.orden order by j.dia_operativo, c.orden nulls last`;
}

export type FilaApp = { app: string; ms: number; jornadas: number };

export async function porApp(f: Filtros): Promise<FilaApp[]> {
  return sql<FilaApp[]>`
    select a.key as app, sum(a.value::bigint)::bigint as ms, count(*)::int as jornadas
    from jornada_summary j, lateral jsonb_each_text(j.activo_por_app) a
    where ${buenas(f)} and a.key <> 'bloqueado'
    group by a.key order by sum(a.value::bigint) desc limit 8`;
}

export type FilaMedico = { sap_user: string; medico_id: string | null; nombre: string | null; jornadas: number; activo_ms: number };

/** El médico como anotación: quién (por login SAP) acumuló actividad en el rango. */
export async function porMedico(f: Filtros): Promise<FilaMedico[]> {
  return sql<FilaMedico[]>`
    select u.key as sap_user, r.id as medico_id, r.display_name as nombre, count(*)::int as jornadas, sum(u.value::bigint)::bigint as activo_ms
    from jornada_summary j, lateral jsonb_each_text(j.sap_users) u
    left join roster r on r.id = medico_de(u.key)
    where ${buenas(f)}
    group by u.key, r.id, r.display_name order by sum(u.value::bigint) desc limit 30`;
}

export type FilaFase = Medianas & { phase: string; n: number; consultorios: number };

export async function porFase(f: Filtros): Promise<FilaFase[]> {
  return sql<FilaFase[]>`
    select j.phase, count(*)::int as n, count(distinct j.consultorio_id)::int as consultorios, ${medianas}
    from jornada_summary j where ${buenas({ ...f, fase: null })}
    group by j.phase order by array_position(array['baseline','notes','notes_ops'], j.phase)`;
}

export type FilaConsultorioFase = {
  consultorio_id: string | null; nombre: string; orden: number; phase: string; n: number;
  activo_med: number | null; his_med: number | null; pacientes_med: number | null; consulta_med: number | null; post_med: number | null; espera_sap_med: number | null;
};

/** Consultorio × fase, más una fila «Todos los consultorios» por fase (consultorio_id null, orden 0). */
export async function porConsultorioYFase(f: Filtros): Promise<FilaConsultorioFase[]> {
  return sql<FilaConsultorioFase[]>`
    select case when grouping(j.consultorio_id) = 1 then null else j.consultorio_id end as consultorio_id,
      case when grouping(j.consultorio_id) = 1 then 'Todos los consultorios' else coalesce(c.nombre, 'Sin consultorio') end as nombre,
      case when grouping(j.consultorio_id) = 1 then 0 else coalesce(c.orden, 999) end as orden,
      j.phase, count(*)::int as n,
      percentile_cont(0.5) within group (order by j.activo_ms) as activo_med,
      percentile_cont(0.5) within group (order by j.his_ms) as his_med,
      percentile_cont(0.5) within group (order by j.pacientes) as pacientes_med,
      percentile_cont(0.5) within group (order by j.consulta_ms_mediana) filter (where j.consulta_ms_mediana is not null) as consulta_med,
      percentile_cont(0.5) within group (order by j.post_atencion_ms) as post_med,
      percentile_cont(0.5) within group (order by j.sap_wait_ms) as espera_sap_med
    from jornada_summary j left join consultorios c on c.id = j.consultorio_id
    where ${buenas({ ...f, fase: null })}
    group by grouping sets ((j.consultorio_id, c.nombre, c.orden, j.phase), (j.phase))
    order by orden, nombre, array_position(array['baseline','notes','notes_ops'], j.phase)`;
}

// ── SAP ────────────────────────────────────────────────────────────────────

const visitasEnRango = (f: Filtros) => sql`
  v.dia_operativo between ${f.desde}::date and ${f.hasta}::date
  ${f.consultorio ? sql`and v.consultorio_id = ${f.consultorio}::uuid` : sql``}
  ${f.dispositivo ? sql`and v.device_id = ${f.dispositivo}::uuid` : sql``}
  ${f.fase ? sql`and exists (select 1 from jornada_summary j where j.device_id = v.device_id and j.dia_operativo = v.dia_operativo and j.phase = ${f.fase})` : sql``}`;

export type FilaPantalla = { tcode: string; visitas: number; jornadas: number; dwell_med: number | null; ready_p50: number | null; ready_p95: number | null; espera_med: number | null; roundtrips_med: number | null; pacientes: number };

export async function pantallasSap(f: Filtros): Promise<FilaPantalla[]> {
  return sql<FilaPantalla[]>`
    select tcode, count(*)::int as visitas, count(distinct (v.device_id, v.dia_operativo))::int as jornadas,
      percentile_cont(0.5) within group (order by dwell_ms) as dwell_med,
      percentile_cont(0.5) within group (order by ready_ms) filter (where ready_ms is not null) as ready_p50,
      percentile_cont(0.95) within group (order by ready_ms) filter (where ready_ms is not null) as ready_p95,
      percentile_cont(0.5) within group (order by sap_wait_ms) as espera_med,
      percentile_cont(0.5) within group (order by roundtrips) as roundtrips_med,
      count(distinct encounter_key)::int as pacientes
    from sap_visits v where ${visitasEnRango(f)} and tcode <> ''
    group by tcode order by count(*) desc limit 40`;
}

export type FilaSuperficie = { surface: string; tcode: string; visitas: number; dwell_med: number | null; ready_p50: number | null; espera_med: number | null };

export async function superficiesSap(f: Filtros): Promise<FilaSuperficie[]> {
  return sql<FilaSuperficie[]>`
    select surface, tcode, count(*)::int as visitas,
      percentile_cont(0.5) within group (order by dwell_ms) as dwell_med,
      percentile_cont(0.5) within group (order by ready_ms) filter (where ready_ms is not null) as ready_p50,
      percentile_cont(0.5) within group (order by sap_wait_ms) as espera_med
    from sap_visits v where ${visitasEnRango(f)} and surface <> ''
    group by surface, tcode order by count(*) desc limit 60`;
}

export type FilaRuta = { de: string; a: string; veces: number };

export async function rutasSap(f: Filtros): Promise<FilaRuta[]> {
  return sql<FilaRuta[]>`
    select tcode as de, exit_to as a, count(*)::int as veces
    from sap_visits v where ${visitasEnRango(f)} and exit_to is not null and tcode <> '' and exit_to <> tcode
    group by tcode, exit_to order by count(*) desc limit 30`;
}

// ── Encuentros: lo que costó cada paciente ─────────────────────────────────

export type Encuentro = {
  device_id: string; dia_operativo: string; consultorio_id: string | null; consultorio: string | null; encounter_key: string; orden: number;
  primera_vez: string; ultima_vez: string; consulta_ms: number; activo_ms: number; his_ms: number; miracle_ms: number;
  typing_ms: number; keystrokes: number; clicks: number; tabs: number; enters: number; correcciones: number; copias: number; pegados: number; guardados: number;
  tramos: number; post_atencion_ms: number; siguiente_ms: number | null; visitas: number; pantallas_distintas: number; sap_wait_ms: number; ready_ms_p50: number | null;
  sap_user: string | null; medico: string | null;
};

export async function encuentrosDelDia(consultorioId: string, fecha: string): Promise<Encuentro[]> {
  return sql<Encuentro[]>`
    select e.*, e.dia_operativo::text as dia_operativo, c.nombre as consultorio, r.display_name as medico
    from encuentros e left join consultorios c on c.id = e.consultorio_id left join roster r on r.id = medico_de(e.sap_user)
    where e.consultorio_id = ${consultorioId}::uuid and e.dia_operativo = ${fecha}::date order by e.orden`;
}

export type DistribucionConsulta = {
  n: number; p25: number | null; p50: number | null; p75: number | null; p90: number | null;
  activo_p50: number | null; his_p50: number | null; post_p50: number | null; con_interrupcion: number;
};

/** La distribución de las consultas del rango (solo jornadas comparables): lo que cuesta un paciente. */
export async function distribucionConsultas(f: Filtros): Promise<DistribucionConsulta> {
  const [d] = await sql<DistribucionConsulta[]>`
    select count(*)::int as n,
      percentile_cont(0.25) within group (order by e.consulta_ms) as p25,
      percentile_cont(0.5) within group (order by e.consulta_ms) as p50,
      percentile_cont(0.75) within group (order by e.consulta_ms) as p75,
      percentile_cont(0.9) within group (order by e.consulta_ms) as p90,
      percentile_cont(0.5) within group (order by e.activo_ms) as activo_p50,
      percentile_cont(0.5) within group (order by e.his_ms) as his_p50,
      percentile_cont(0.5) within group (order by e.post_atencion_ms) as post_p50,
      count(*) filter (where e.tramos > 1)::int as con_interrupcion
    from encuentros e join jornada_summary j on j.device_id = e.device_id and j.dia_operativo = e.dia_operativo
    where ${buenas(f)}`;
  return d;
}

// ── Consultorios, dispositivos, roster, fases, ajustes ────────────────────

export type Consultorio = { id: string; nombre: string; orden: number; activo: boolean; dispositivos: number; jornadas: number };

export async function consultorios(): Promise<Consultorio[]> {
  return sql<Consultorio[]>`
    select c.id, c.nombre, c.orden, c.activo,
      (select count(*)::int from devices d where d.consultorio_id = c.id and d.status <> 'retired') as dispositivos,
      (select count(*)::int from jornada_summary j where j.consultorio_id = c.id) as jornadas
    from consultorios c order by c.activo desc, c.orden, c.nombre`;
}

export async function consultoriosParaFiltro(): Promise<{ id: string; nombre: string }[]> {
  return sql`select id, nombre from consultorios order by activo desc, orden, nombre`;
}

export type Dispositivo = {
  id: string; machine_name: string; os_version: string; app_version: string; registered_at: string;
  last_seen_at: string; last_sample_at: string | null; status: string;
  consultorio_id: string | null; consultorio: string | null; consultorio_desde: string | null;
  jornadas: number; ultima_app: string | null; ultima_cubeta: string | null;
};

export async function dispositivos(): Promise<Dispositivo[]> {
  return sql<Dispositivo[]>`
    select d.*, c.nombre as consultorio,
      (select count(*)::int from jornada_summary j where j.device_id = d.id) as jornadas,
      u.app as ultima_app, u.bucket_start as ultima_cubeta
    from devices d
    left join consultorios c on c.id = d.consultorio_id
    left join lateral (select s.app, s.bucket_start from samples s where s.device_id = d.id order by s.bucket_start desc, s.seq desc limit 1) u on true
    order by d.status = 'active' desc, c.orden nulls last, d.last_seen_at desc`;
}

export type Medico = { id: string; display_name: string; sap_users: string[]; active: boolean; sort_order: number; jornadas: number };

export async function roster(): Promise<Medico[]> {
  return sql<Medico[]>`select r.*, (select count(*)::int from jornada_summary j where j.sap_users ?| r.sap_users) as jornadas
    from roster r order by r.active desc, r.sort_order, r.display_name`;
}

export type Fase = { id: string; phase: string; starts_on: string; ends_on: string | null; notes: string | null };

export async function fasesDelEstudio(): Promise<Fase[]> {
  return sql<Fase[]>`select id, phase, starts_on::text, ends_on::text, notes from study_phases order by starts_on`;
}

export async function faseHoy(): Promise<string> {
  const [r] = await sql<{ phase: string }[]>`select phase_at(${hoyOperativo()}::date) as phase`;
  return r.phase;
}

export type AjustesPanel = { hospital: string; config_version: number; config: Record<string, unknown>; hmac_version: number; updated_at: string };

export async function ajustesDelPanel(): Promise<AjustesPanel> {
  const [a] = await sql<AjustesPanel[]>`select hospital, config_version, config, hmac_version, updated_at from settings where id = 1`;
  return a;
}
