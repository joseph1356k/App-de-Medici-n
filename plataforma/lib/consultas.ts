// Las consultas del panel. Todo sale de shift_summary (agregado por turno, sin PHI) y,
// para el detalle de un turno, del crudo (samples/events/sap_visits). Los turnos de
// mala calidad se EXCLUYEN por defecto de promedios y comparaciones — un promedio
// sobre turnos parciales miente — pero siempre se cuentan en el bloque de cobertura.
import { sql } from "./db";
import type { Filtros } from "./filtros";

export const filtroTurnos = (f: Filtros) => sql`
  m.fecha_operativa between ${f.desde}::date and ${f.hasta}::date
  ${f.fase ? sql`and m.phase = ${f.fase}` : sql``}
  ${f.medico ? sql`and m.doctor_id = ${f.medico}::uuid` : sql``}
  ${f.dispositivo ? sql`and m.device_id = ${f.dispositivo}::uuid` : sql``}`;

const buenos = (f: Filtros) => sql`${filtroTurnos(f)} ${f.incluirMala ? sql`` : sql`and m.calidad_ok`}`;

export type Kpis = {
  n: number; activo_med: number | null; his_med: number | null; miracle_med: number | null; escritura_med: number | null;
  clics_med: number | null; cambios_med: number | null; encounters_med: number | null; por_encounter_med: number | null;
  post_med: number | null; cola_med: number | null; espera_sap_med: number | null; ready_p95_med: number | null;
  duracion_med: number | null; pantallas_med: number | null;
};

export async function kpis(f: Filtros): Promise<Kpis> {
  const [k] = await sql<Kpis[]>`
    select count(*)::int as n,
      percentile_cont(0.5) within group (order by active_ms_total) as activo_med,
      percentile_cont(0.5) within group (order by his_ms) as his_med,
      percentile_cont(0.5) within group (order by miracle_ms) as miracle_med,
      percentile_cont(0.5) within group (order by typing_ms) as escritura_med,
      percentile_cont(0.5) within group (order by clicks) as clics_med,
      percentile_cont(0.5) within group (order by context_switches) as cambios_med,
      percentile_cont(0.5) within group (order by encounters) as encounters_med,
      percentile_cont(0.5) within group (order by encounter_active_ms_mediana) filter (where encounter_active_ms_mediana is not null) as por_encounter_med,
      percentile_cont(0.5) within group (order by post_atencion_ms) as post_med,
      percentile_cont(0.5) within group (order by cola_post_turno_ms) as cola_med,
      percentile_cont(0.5) within group (order by sap_wait_ms_total) as espera_sap_med,
      percentile_cont(0.5) within group (order by ready_ms_p95) filter (where ready_ms_p95 is not null) as ready_p95_med,
      percentile_cont(0.5) within group (order by duracion_ms) as duracion_med,
      percentile_cont(0.5) within group (order by pantallas_distintas) as pantallas_med
    from shift_summary m where ${buenos(f)}`;
  return k;
}

export type Cobertura = { total: number; medidos: number; excluidos: number; cobertura_media: number | null; abiertos: number };

export async function cobertura(f: Filtros): Promise<Cobertura> {
  const [c] = await sql<Cobertura[]>`
    select count(*)::int as total,
      count(*) filter (where calidad_ok)::int as medidos,
      count(*) filter (where not calidad_ok)::int as excluidos,
      round(avg(cobertura_pct), 1) as cobertura_media,
      count(*) filter (where ended_at is null)::int as abiertos
    from shift_summary m where ${filtroTurnos(f)}`;
  return c;
}

export type PuntoDiario = { fecha: string; turnos: number; activo_ms: number | null; his_ms: number | null };

export async function serieDiaria(f: Filtros): Promise<PuntoDiario[]> {
  return sql<PuntoDiario[]>`
    select fecha_operativa::text as fecha, count(*)::int as turnos,
      percentile_cont(0.5) within group (order by active_ms_total) as activo_ms,
      percentile_cont(0.5) within group (order by his_ms) as his_ms
    from shift_summary m where ${buenos(f)}
    group by fecha_operativa order by fecha_operativa`;
}

export type FilaMedico = {
  doctor_id: string | null; nombre: string; turnos: number; activo_med: number | null; his_med: number | null;
  post_med: number | null; encounters_med: number | null; clics_med: number | null; por_encounter_med: number | null;
};

export async function porMedico(f: Filtros): Promise<FilaMedico[]> {
  return sql<FilaMedico[]>`
    select m.doctor_id, coalesce(r.display_name, 'Sin médico (turno anónimo)') as nombre, count(*)::int as turnos,
      percentile_cont(0.5) within group (order by active_ms_total) as activo_med,
      percentile_cont(0.5) within group (order by his_ms) as his_med,
      percentile_cont(0.5) within group (order by post_atencion_ms) as post_med,
      percentile_cont(0.5) within group (order by encounters) as encounters_med,
      percentile_cont(0.5) within group (order by clicks) as clics_med,
      percentile_cont(0.5) within group (order by encounter_active_ms_mediana) filter (where encounter_active_ms_mediana is not null) as por_encounter_med
    from shift_summary m left join roster r on r.id = m.doctor_id
    where ${buenos(f)}
    group by m.doctor_id, r.display_name order by count(*) desc, nombre`;
}

export type FilaApp = { app: string; ms: number; turnos: number };

export async function porApp(f: Filtros): Promise<FilaApp[]> {
  return sql<FilaApp[]>`
    select a.key as app, sum(a.value::bigint)::bigint as ms, count(distinct m.shift_id)::int as turnos
    from shift_summary m, lateral jsonb_each_text(m.active_ms_por_app) a
    where ${buenos(f)}
    group by a.key order by sum(a.value::bigint) desc limit 8`;
}

export type FilaTurno = {
  shift_id: string; fecha: string; phase: string; doctor_id: string | null; nombre: string | null; machine_name: string;
  started_at: string; ended_at: string | null; end_reason: string | null; duracion_ms: number; active_ms_total: number; his_ms: number;
  typing_ms: number; clicks: number; encounters: number; post_atencion_ms: number; sap_wait_ms_total: number;
  cobertura_pct: number | null; calidad_ok: boolean;
};

export async function turnos(f: Filtros, page: number, tamano = 25): Promise<{ filas: FilaTurno[]; total: number }> {
  const [filas, [{ total }]] = await Promise.all([
    sql<FilaTurno[]>`
      select m.shift_id, m.fecha_operativa::text as fecha, m.phase, m.doctor_id, r.display_name as nombre, d.machine_name,
        m.started_at, m.ended_at, s.end_reason, m.duracion_ms, m.active_ms_total, m.his_ms, m.typing_ms, m.clicks, m.encounters,
        m.post_atencion_ms, m.sap_wait_ms_total, m.cobertura_pct, m.calidad_ok
      from shift_summary m
      join shifts s on s.shift_id = m.shift_id
      left join roster r on r.id = m.doctor_id
      left join devices d on d.id = m.device_id
      where ${filtroTurnos(f)}
      order by m.started_at desc
      limit ${tamano} offset ${(page - 1) * tamano}`,
    sql<{ total: number }[]>`select count(*)::int as total from shift_summary m where ${filtroTurnos(f)}`,
  ]);
  return { filas, total };
}

export type Turno = FilaTurno & {
  device_id: string; sap_user_seen: string | null; miracle_ms: number; keystrokes: number; scroll_ticks: number;
  context_switches: number; encounter_active_ms_mediana: number | null; cola_post_turno_ms: number; sap_roundtrips: number;
  ready_ms_p50: number | null; ready_ms_p95: number | null; pantallas_distintas: number; visitas: number;
  active_ms_por_app: Record<string, number>; calidad: Record<string, unknown>; app_version: string; hooks_degradados: boolean;
  ticks_sap_saltados_busy: number; huecos_ms: number; clock_jumps: number; spool_dropped: number;
};

export async function turno(id: string): Promise<Turno | null> {
  const [t] = await sql<Turno[]>`
    select m.*, m.fecha_operativa::text as fecha, r.display_name as nombre, d.machine_name, s.end_reason, s.sap_user_seen, s.app_version,
      s.hooks_degradados, s.ticks_sap_saltados_busy, s.huecos_ms, s.clock_jumps, s.spool_dropped
    from shift_summary m join shifts s on s.shift_id = m.shift_id
    left join roster r on r.id = m.doctor_id left join devices d on d.id = m.device_id
    where m.shift_id = ${id}::uuid`;
  return t ?? null;
}

export type Bin = { t: string; app: string; active_ms: number; foreground_ms: number; clicks: number; typing_ms: number };

/** La línea de tiempo del turno en cubos de 5 minutos por app. */
export async function lineaDeTiempo(id: string): Promise<Bin[]> {
  return sql<Bin[]>`
    select to_char(to_timestamp(floor(extract(epoch from bucket_start) / 300) * 300) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as t,
      app, sum(active_ms)::int as active_ms, sum(foreground_ms)::int as foreground_ms, sum(clicks)::int as clicks, sum(typing_ms)::int as typing_ms
    from samples where shift_id = ${id}::uuid
    group by 1, app order by 1`;
}

export type Encounter = { encounter_key: string; primera: string; ultima: string; active_ms: number; his_ms: number; typing_ms: number; clicks: number; visitas: number; pantallas: number; post_ms: number };

export async function encounters(id: string): Promise<Encounter[]> {
  return sql<Encounter[]>`
    with enters as (
      select encounter_key, min(occurred_at) as first_at from events
      where shift_id = ${id}::uuid and kind = 'encounter_enter' and encounter_key is not null group by 1)
    select s.encounter_key, min(s.bucket_start) as primera, max(s.bucket_start) as ultima,
      sum(s.active_ms)::bigint as active_ms, sum(s.active_ms) filter (where s.app = 'sap')::bigint as his_ms,
      sum(s.typing_ms)::bigint as typing_ms, sum(s.clicks)::int as clicks,
      (select count(*)::int from sap_visits v where v.shift_id = s.shift_id and v.encounter_key = s.encounter_key) as visitas,
      (select count(distinct v.surface)::int from sap_visits v where v.shift_id = s.shift_id and v.encounter_key = s.encounter_key) as pantallas,
      coalesce(sum(s.active_ms) filter (where exists (
        select 1 from enters o join enters e on e.encounter_key = s.encounter_key
        where o.encounter_key <> s.encounter_key and o.first_at > e.first_at and o.first_at < s.bucket_start)), 0)::bigint as post_ms
    from samples s where s.shift_id = ${id}::uuid and s.encounter_key is not null
    group by s.shift_id, s.encounter_key order by primera`;
}

export type VisitaSap = { tcode: string; surface: string; dynpro: string; entered_at: string; left_at: string | null; dwell_ms: number; ready_ms: number | null; sap_wait_ms: number; roundtrips: number; exit_to: string | null; encounter_key: string | null };

export async function visitasDelTurno(id: string): Promise<VisitaSap[]> {
  return sql<VisitaSap[]>`select tcode, surface, dynpro, entered_at, left_at, dwell_ms, ready_ms, sap_wait_ms, roundtrips, exit_to, encounter_key
    from sap_visits where shift_id = ${id}::uuid order by entered_at`;
}

export type Evento = { kind: string; occurred_at: string; encounter_key: string | null; detail: Record<string, unknown> };

export async function eventosDelTurno(id: string): Promise<Evento[]> {
  return sql<Evento[]>`select kind, occurred_at, encounter_key, detail from events where shift_id = ${id}::uuid order by occurred_at`;
}

// ── Comparación de fases ───────────────────────────────────────────────────

export type FilaFase = {
  phase: string; n: number; medicos: number; activo_med: number | null; his_med: number | null; miracle_med: number | null; escritura_med: number | null;
  clics_med: number | null; cambios_med: number | null; encounters_med: number | null; por_encounter_med: number | null;
  post_med: number | null; cola_med: number | null; espera_sap_med: number | null; ready_p95_med: number | null; pantallas_med: number | null;
};

export async function porFase(f: Filtros): Promise<FilaFase[]> {
  return sql<FilaFase[]>`
    select phase, count(*)::int as n, count(distinct doctor_id)::int as medicos,
      percentile_cont(0.5) within group (order by active_ms_total) as activo_med,
      percentile_cont(0.5) within group (order by his_ms) as his_med,
      percentile_cont(0.5) within group (order by miracle_ms) as miracle_med,
      percentile_cont(0.5) within group (order by typing_ms) as escritura_med,
      percentile_cont(0.5) within group (order by clicks) as clics_med,
      percentile_cont(0.5) within group (order by context_switches) as cambios_med,
      percentile_cont(0.5) within group (order by encounters) as encounters_med,
      percentile_cont(0.5) within group (order by encounter_active_ms_mediana) filter (where encounter_active_ms_mediana is not null) as por_encounter_med,
      percentile_cont(0.5) within group (order by post_atencion_ms) as post_med,
      percentile_cont(0.5) within group (order by cola_post_turno_ms) as cola_med,
      percentile_cont(0.5) within group (order by sap_wait_ms_total) as espera_sap_med,
      percentile_cont(0.5) within group (order by ready_ms_p95) filter (where ready_ms_p95 is not null) as ready_p95_med,
      percentile_cont(0.5) within group (order by pantallas_distintas) as pantallas_med
    from shift_summary m where ${buenos({ ...f, fase: null })}
    group by phase order by array_position(array['baseline','notes','notes_ops'], phase)`;
}

export type FilaMedicoFase = { doctor_id: string | null; nombre: string; phase: string; n: number; activo_med: number | null; his_med: number | null; post_med: number | null; por_encounter_med: number | null };

export async function porMedicoYFase(f: Filtros): Promise<FilaMedicoFase[]> {
  return sql<FilaMedicoFase[]>`
    select m.doctor_id, coalesce(r.display_name, 'Sin médico') as nombre, m.phase, count(*)::int as n,
      percentile_cont(0.5) within group (order by active_ms_total) as activo_med,
      percentile_cont(0.5) within group (order by his_ms) as his_med,
      percentile_cont(0.5) within group (order by post_atencion_ms) as post_med,
      percentile_cont(0.5) within group (order by encounter_active_ms_mediana) filter (where encounter_active_ms_mediana is not null) as por_encounter_med
    from shift_summary m left join roster r on r.id = m.doctor_id
    where ${buenos({ ...f, fase: null })}
    group by m.doctor_id, r.display_name, m.phase order by nombre, m.phase`;
}

// ── SAP ────────────────────────────────────────────────────────────────────

export type FilaPantalla = { tcode: string; visitas: number; turnos: number; dwell_med: number | null; ready_p50: number | null; ready_p95: number | null; espera_med: number | null; roundtrips_med: number | null; encounters: number };

const visitasEnRango = (f: Filtros) => sql`
  v.entered_at >= (${f.desde}::date::timestamp at time zone 'America/Bogota')
  and v.entered_at < ((${f.hasta}::date + 1)::timestamp at time zone 'America/Bogota')
  ${f.medico ? sql`and v.shift_id in (select shift_id from shifts where doctor_id = ${f.medico}::uuid)` : sql``}
  ${f.dispositivo ? sql`and v.device_id = ${f.dispositivo}::uuid` : sql``}
  ${f.fase ? sql`and v.shift_id in (select shift_id from shifts where phase = ${f.fase})` : sql``}`;

export async function pantallasSap(f: Filtros): Promise<FilaPantalla[]> {
  return sql<FilaPantalla[]>`
    select tcode, count(*)::int as visitas, count(distinct shift_id)::int as turnos,
      percentile_cont(0.5) within group (order by dwell_ms) as dwell_med,
      percentile_cont(0.5) within group (order by ready_ms) filter (where ready_ms is not null) as ready_p50,
      percentile_cont(0.95) within group (order by ready_ms) filter (where ready_ms is not null) as ready_p95,
      percentile_cont(0.5) within group (order by sap_wait_ms) as espera_med,
      percentile_cont(0.5) within group (order by roundtrips) as roundtrips_med,
      count(distinct encounter_key)::int as encounters
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

// ── Dispositivos, roster, fases, ajustes ──────────────────────────────────

export type Dispositivo = {
  id: string; machine_name: string; label: string; os_version: string; app_version: string; registered_at: string;
  last_seen_at: string; last_sample_at: string | null; status: string; turno_abierto: string | null; medico_actual: string | null; turnos: number;
};

export async function dispositivos(): Promise<Dispositivo[]> {
  return sql<Dispositivo[]>`
    select d.*,
      (select s.shift_id from shifts s where s.device_id = d.id and s.ended_at is null order by s.started_at desc limit 1) as turno_abierto,
      (select coalesce(r.display_name, 'sin médico') from shifts s left join roster r on r.id = s.doctor_id
         where s.device_id = d.id and s.ended_at is null order by s.started_at desc limit 1) as medico_actual,
      (select count(*)::int from shifts s where s.device_id = d.id) as turnos
    from devices d order by d.status = 'active' desc, d.last_seen_at desc`;
}

export type Medico = { id: string; display_name: string; sap_users: string[]; active: boolean; sort_order: number; turnos: number };

export async function roster(): Promise<Medico[]> {
  return sql<Medico[]>`select r.*, (select count(*)::int from shifts s where s.doctor_id = r.id) as turnos
    from roster r order by r.active desc, r.sort_order, r.display_name`;
}

export type Fase = { id: string; phase: string; starts_on: string; ends_on: string | null; notes: string | null };

export async function fasesDelEstudio(): Promise<Fase[]> {
  return sql<Fase[]>`select id, phase, starts_on::text, ends_on::text, notes from study_phases order by starts_on`;
}

export async function faseHoy(): Promise<string> {
  const [r] = await sql<{ phase: string }[]>`select phase_at((now() at time zone 'America/Bogota')::date) as phase`;
  return r.phase;
}

export type AjustesPanel = { hospital: string; config_version: number; config: Record<string, unknown>; hmac_version: number; updated_at: string };

export async function ajustesDelPanel(): Promise<AjustesPanel> {
  const [a] = await sql<AjustesPanel[]>`select hospital, config_version, config, hmac_version, updated_at from settings where id = 1`;
  return a;
}

export async function medicosParaFiltro(): Promise<{ id: string; display_name: string }[]> {
  return sql`select id, display_name from roster order by active desc, sort_order, display_name`;
}
