-- ============================================================================
-- ESQUEMA DE LA PLATAFORMA DE MEDICIÓN — un hospital, un Postgres (Supabase, Neon, Vercel
-- Postgres o el que sea). Se aplica UNA vez: `npm run db:aplicar` o pegarlo en el editor SQL.
-- Es idempotente: volver a correrlo no rompe nada.
--
-- Lo escribe SOLO el servidor (la API de Next.js con DATABASE_URL). Las tablas llevan RLS
-- activado sin políticas: si el Postgres es Supabase, la API REST pública no puede leerlas.
--
-- PRIVACIDAD, y es la razón de la forma de estas tablas: no hay un solo campo de texto libre
-- donde pueda entrar contenido clínico. La identidad del paciente llega ya hasheada
-- (encounter_key, HMAC calculado en el PC), las superficies vienen normalizadas
-- (sapgui://SID/TCODE/PROGRAMA/DYNPRO) sin títulos, y del tecleo solo llegan cantidades.
-- El `detail` de los eventos se sanea con lista blanca de claves ANTES de insertar.
--
-- Nombres en inglés snake_case a propósito: son los mismos del formato de cable del .exe
-- (medidor/Dominio/Cable.cs) y los que salen en la exportación. El diccionario en español
-- vive en docs/DATOS.md y en /api/export/esquema.json.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Ajustes del hospital (UNA fila) ──────────────────────────────────────────
-- config: lo que el .exe obedece (apps_por_proceso, reglas de extracción, cadencias).
-- hmac_secret: el secreto con el que los PCs derivan la huella del paciente. Es la
-- pieza más sensible del sistema: solo lo lee la API para entregarlo al .exe al
-- registrarse. Con él se podría re-derivar una huella; sin él, nadie puede.
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  hospital text not null default 'Hospital',
  config_version int not null default 1,
  config jsonb not null default '{}'::jsonb,
  hmac_version int not null default 1,
  hmac_secret text not null default encode(gen_random_bytes(32), 'base64'),
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;

insert into settings (id, hospital, config_version, config)
values (1, 'Hospital General de Medellín', 1, jsonb_build_object(
  'apps_por_proceso', jsonb_build_object(
    'saplogon.exe','sap','saplgpad.exe','sap','sapgui.exe','sap',
    'chrome.exe','chrome','msedge.exe','edge','firefox.exe','firefox',
    'winword.exe','office','excel.exe','office','outlook.exe','office',
    'explorer.exe','explorador','u.exe','uexe'),
  'dominios_permitidos', jsonb_build_array(),
  'dominios_miracle', jsonb_build_array('itsmiracleai.com.co','www.itsmiracleai.com.co'),
  'reglas_identidad', jsonb_build_array(
    jsonb_build_object('id','titulo-patnr','tcode','*','fuente','titulo_sap',
      'patron','(?:PATNR|[Pp]aciente|[Nn]HC)\D*0*([0-9]{5,10})','normalizar','digitos_sin_ceros')),
  'foreground_ms', 1000, 'sap_identity_ms', 1500, 'solo_foreground', false))
on conflict (id) do nothing;

-- ── Médicos (el roster del selector) ─────────────────────────────────────────
-- sap_users: los logins de SAP de ese médico; con ellos el .exe asigna el turno solo.
-- No se borra: desactivar mantiene la referencia de los turnos ya medidos.
create table if not exists roster (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  sap_users text[] not null default '{}',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table roster enable row level security;

-- ── Fases del estudio ────────────────────────────────────────────────────────
-- La fase de un turno SIEMPRE se deriva de este calendario por fecha operativa; el
-- snapshot guardado en el turno es cache. Cambiar el calendario re-etiqueta el pasado.
create table if not exists study_phases (
  id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('baseline','notes','notes_ops')),
  starts_on date not null,
  ends_on date,
  notes text,
  created_at timestamptz not null default now()
);
alter table study_phases enable row level security;
create index if not exists study_phases_starts_idx on study_phases (starts_on);

insert into study_phases (phase, starts_on, notes)
select 'baseline', current_date, 'antes de Miracle'
where not exists (select 1 from study_phases);

create or replace function phase_at(p_fecha date) returns text
language sql stable as $$
  select coalesce(
    (select ph.phase from study_phases ph
      where ph.starts_on <= p_fecha and (ph.ends_on is null or ph.ends_on >= p_fecha)
      order by ph.starts_on desc limit 1),
    'baseline');
$$;

-- ── Dispositivos (cada PC con el .exe) ───────────────────────────────────────
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  machine_name text not null default '',
  os_version text not null default '',
  app_version text not null default '',
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_sample_at timestamptz,
  hmac_version int not null default 1,
  config_version int not null default 0,
  status text not null default 'active' check (status in ('active','paused','retired')),
  label text not null default ''            -- p.ej. «consultorio 3», lo pone el panel
);
alter table devices enable row level security;
create index if not exists devices_seen_idx on devices (last_seen_at desc);

-- ── Turnos: la unidad de trabajo y la fuente de verdad del médico ────────────
-- shift_id lo genera el .exe (uuid) → upsert idempotente. doctor_id puede ser NULL
-- (turno anónimo: el baseline no se pierde por un selector ignorado) y solo cambia
-- desde NULL mientras el turno está abierto — nunca de un médico a otro.
create table if not exists shifts (
  shift_id uuid primary key,
  device_id uuid not null references devices(id) on delete cascade,
  doctor_id uuid references roster(id) on delete set null,
  doctor_display_snapshot text not null default '',
  sap_user_seen text,
  phase text not null default 'baseline',
  started_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('manual','timeout_inactividad','lock_prolongado','turno_nuevo','apagado','desconocido')),
  dia_operativo date,
  hmac_version int not null default 1,
  app_version text not null default '',
  huecos_ms bigint not null default 0,
  clock_jumps int not null default 0,
  spool_dropped int not null default 0,
  hooks_degradados boolean not null default false,
  ticks_sap_saltados_busy int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table shifts enable row level security;
create index if not exists shifts_started_idx on shifts (started_at desc);
create index if not exists shifts_doctor_idx on shifts (doctor_id, started_at desc);
create index if not exists shifts_device_idx on shifts (device_id, started_at desc);

-- ── Muestras: la serie temporal (la tabla de volumen) ────────────────────────
-- Una fila por cubeta de 15 s por contexto (app · superficie · encounter). La clave
-- natural (shift_id, bucket_start, seq) da idempotencia: un lote reenviado tras un
-- timeout hace ON CONFLICT DO NOTHING. ~4k filas por turno.
create table if not exists samples (
  id bigint generated always as identity primary key,
  device_id uuid not null references devices(id) on delete cascade,
  shift_id uuid not null references shifts(shift_id) on delete cascade,
  bucket_start timestamptz not null,
  bucket_ms int not null default 0,
  seq smallint not null default 0,
  app text not null default 'otro',
  surface text,                 -- sapgui://SID/TCODE/PROGRAMA/DYNPRO[/sub] | web://dominio | NULL. Nunca un título.
  encounter_key text,           -- HMAC hex de 32; NULL si la pantalla no dio paciente
  foreground_ms int not null default 0,
  active_ms int not null default 0,
  typing_ms int not null default 0,
  keystrokes int not null default 0,
  clicks int not null default 0,
  scroll_ticks int not null default 0,
  context_switches int not null default 0,
  sap_roundtrips int not null default 0,
  sap_wait_ms int not null default 0,
  tabs int not null default 0,            -- teclas de control: solo se distinguen estas seis
  enters int not null default 0,
  correcciones int not null default 0,    -- Backspace / Supr
  copias int not null default 0,          -- Ctrl+C / Ctrl+Ins
  pegados int not null default 0,         -- Ctrl+V / Mayús+Ins
  guardados int not null default 0,       -- Ctrl+S
  created_at timestamptz not null default now(),
  unique (shift_id, bucket_start, seq)
);
alter table samples enable row level security;
-- Para bases creadas con una versión anterior del esquema (idempotente).
alter table samples add column if not exists tabs int not null default 0;
alter table samples add column if not exists enters int not null default 0;
alter table samples add column if not exists correcciones int not null default 0;
alter table samples add column if not exists copias int not null default 0;
alter table samples add column if not exists pegados int not null default 0;
alter table samples add column if not exists guardados int not null default 0;
create index if not exists samples_time_idx on samples (bucket_start desc);
create index if not exists samples_shift_enc_idx on samples (shift_id, encounter_key);

-- ── Eventos discretos tipados ────────────────────────────────────────────────
-- event_uid = {device}:{coleccion}:{seq} → unique → idempotencia. detail pasa por
-- lista blanca de claves en la API antes de insertar.
create table if not exists events (
  id bigint generated always as identity primary key,
  event_uid text not null unique,
  device_id uuid not null references devices(id) on delete cascade,
  shift_id uuid references shifts(shift_id) on delete cascade,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  encounter_key text,
  kind text not null check (kind in (
    'shift_start','shift_end','doctor_prompted','encounter_enter','encounter_exit','encounter_unknown',
    'lock','unlock','suspend','resume','medidor_start','medidor_stop','pausa_usuario','reanudar_usuario',
    'sap_attach','sap_detach','sap_user_seen','clock_jump','spool_drop','hooks_degradados','config_applied',
    'ops_run','calidad')),
  detail jsonb not null default '{}'::jsonb
);
alter table events enable row level security;
create index if not exists events_time_idx on events (occurred_at desc);
create index if not exists events_shift_idx on events (shift_id, occurred_at);
create index if not exists events_kind_idx on events (kind, occurred_at desc);

-- ── Visitas SAP: el recorrido por el HIS, como segmentos ─────────────────────
create table if not exists sap_visits (
  id bigint generated always as identity primary key,
  visit_uid text not null unique,
  device_id uuid not null references devices(id) on delete cascade,
  shift_id uuid not null references shifts(shift_id) on delete cascade,
  encounter_key text,
  sid text not null default '',
  tcode text not null default '',
  dynpro text not null default '',
  surface text not null default '',
  entered_at timestamptz not null,
  left_at timestamptz,
  dwell_ms bigint not null default 0,
  ready_ms bigint,              -- NULL, no 0, si la pantalla nunca dio un EndRequest sin Busy
  sap_wait_ms bigint not null default 0,
  roundtrips int not null default 0,
  exit_to text
);
alter table sap_visits enable row level security;
create index if not exists sap_visits_shift_idx on sap_visits (shift_id, entered_at);
create index if not exists sap_visits_tcode_idx on sap_visits (tcode, entered_at desc);

-- ── Resumen por turno: el artefacto de largo plazo ───────────────────────────
-- Una fila por turno, RECOMPUTABLE (algo_version). calidad_ok es el filtro por
-- defecto de toda comparación: los turnos malos se excluyen por construcción.
create table if not exists shift_summary (
  shift_id uuid primary key references shifts(shift_id) on delete cascade,
  doctor_id uuid,
  device_id uuid not null,
  phase text not null default 'baseline',
  fecha_operativa date,
  started_at timestamptz,
  ended_at timestamptz,
  duracion_ms bigint not null default 0,
  foreground_ms_total bigint not null default 0,
  active_ms_total bigint not null default 0,
  active_ms_por_app jsonb not null default '{}'::jsonb,
  his_ms bigint not null default 0,
  miracle_ms bigint not null default 0,
  typing_ms bigint not null default 0,
  keystrokes bigint not null default 0,
  clicks bigint not null default 0,
  scroll_ticks bigint not null default 0,
  context_switches bigint not null default 0,
  encounters int not null default 0,
  encounter_active_ms_mediana bigint,
  post_atencion_ms bigint not null default 0,
  cola_post_turno_ms bigint not null default 0,
  sap_wait_ms_total bigint not null default 0,
  sap_roundtrips int not null default 0,
  ready_ms_p50 bigint,
  ready_ms_p95 bigint,
  pantallas_distintas int not null default 0,
  visitas int not null default 0,
  tabs bigint not null default 0,
  enters bigint not null default 0,
  correcciones bigint not null default 0,
  copias bigint not null default 0,
  pegados bigint not null default 0,
  guardados bigint not null default 0,
  interrupciones int not null default 0,          -- vueltas a un paciente ya abierto (A→B→A)
  revisitas_sap int not null default 0,           -- volver a una pantalla ya visitada con el mismo paciente
  consultas_por_hora numeric,
  consulta_ms_mediana bigint,                     -- reloj de pared: primer → último instante con actividad del paciente
  entre_consultas_ms_mediana bigint,              -- del último instante de un paciente al primero del siguiente
  carga_admin_pct numeric,                        -- % del tiempo activo que fue en SAP
  cobertura_pct numeric,
  calidad jsonb not null default '{}'::jsonb,
  calidad_ok boolean not null default true,
  algo_version int not null default 3,
  computed_at timestamptz not null default now()
);
alter table shift_summary enable row level security;
alter table shift_summary add column if not exists tabs bigint not null default 0;
alter table shift_summary add column if not exists enters bigint not null default 0;
alter table shift_summary add column if not exists correcciones bigint not null default 0;
alter table shift_summary add column if not exists copias bigint not null default 0;
alter table shift_summary add column if not exists pegados bigint not null default 0;
alter table shift_summary add column if not exists guardados bigint not null default 0;
alter table shift_summary add column if not exists interrupciones int not null default 0;
alter table shift_summary add column if not exists revisitas_sap int not null default 0;
alter table shift_summary add column if not exists consultas_por_hora numeric;
alter table shift_summary add column if not exists consulta_ms_mediana bigint;
alter table shift_summary add column if not exists entre_consultas_ms_mediana bigint;
alter table shift_summary add column if not exists carga_admin_pct numeric;
create index if not exists shift_summary_fecha_idx on shift_summary (fecha_operativa desc);
create index if not exists shift_summary_phase_idx on shift_summary (phase, doctor_id);

-- ============================================================================
-- FUNCIONES
-- ============================================================================

-- Upsert de un turno (idempotente por shift_id). Protege la regla del médico:
-- doctor_id solo cambia desde NULL, y solo mientras el turno está abierto. El
-- primer cierre manda; los contadores de calidad se quedan con el mayor.
create or replace function upsert_shift(
  p_shift uuid, p_device uuid, p_doctor uuid, p_doctor_display text,
  p_sap_user text, p_started timestamptz, p_ended timestamptz,
  p_end_reason text, p_dia date, p_hmac_version int, p_app_version text,
  p_huecos_ms bigint, p_clock_jumps int, p_spool_dropped int,
  p_hooks_degradados boolean, p_ticks_sap int)
returns void language plpgsql as $$
declare v_dia date := coalesce(p_dia, (p_started at time zone 'America/Bogota')::date);
begin
  insert into shifts(
    shift_id, device_id, doctor_id, doctor_display_snapshot, sap_user_seen,
    phase, started_at, ended_at, end_reason, dia_operativo, hmac_version, app_version,
    huecos_ms, clock_jumps, spool_dropped, hooks_degradados, ticks_sap_saltados_busy)
  values (
    p_shift, p_device, p_doctor, coalesce(p_doctor_display,''), p_sap_user,
    phase_at(v_dia), p_started, p_ended, p_end_reason, v_dia, coalesce(p_hmac_version,1), coalesce(p_app_version,''),
    coalesce(p_huecos_ms,0), coalesce(p_clock_jumps,0), coalesce(p_spool_dropped,0),
    coalesce(p_hooks_degradados,false), coalesce(p_ticks_sap,0))
  on conflict (shift_id) do update set
    doctor_id = case
      when shifts.ended_at is not null then shifts.doctor_id
      when shifts.doctor_id is null then excluded.doctor_id
      else shifts.doctor_id end,
    doctor_display_snapshot = case
      when shifts.ended_at is not null then shifts.doctor_display_snapshot
      when shifts.doctor_id is null then excluded.doctor_display_snapshot
      else shifts.doctor_display_snapshot end,
    sap_user_seen = coalesce(excluded.sap_user_seen, shifts.sap_user_seen),
    ended_at = coalesce(shifts.ended_at, excluded.ended_at),
    end_reason = coalesce(shifts.end_reason, excluded.end_reason),
    huecos_ms = greatest(shifts.huecos_ms, excluded.huecos_ms),
    clock_jumps = greatest(shifts.clock_jumps, excluded.clock_jumps),
    spool_dropped = greatest(shifts.spool_dropped, excluded.spool_dropped),
    hooks_degradados = shifts.hooks_degradados or excluded.hooks_degradados,
    ticks_sap_saltados_busy = greatest(shifts.ticks_sap_saltados_busy, excluded.ticks_sap_saltados_busy),
    updated_at = now();
end;
$$;

-- EL RESUMEN de un turno desde el crudo. Recomputable: cambiar la definición de
-- post-atención y volver a correr no pierde nada.
--
-- Definiciones (algo_version = 2):
--   his_ms            activo con app = 'sap'
--   miracle_ms        activo con app = 'miracle_web'
--   post_atencion_ms  activo atribuido a un paciente A DESPUÉS de que se abrió otro paciente
--                     distinto (el A→B→A de urgencias: lo que se hace sobre A cuando ya se
--                     está con B es documentación posterior a la atención).
--   cola_post_turno   activo en SAP después del último paciente abierto del turno.
--   cobertura_pct     foreground medido / duración del turno. < 85 % = el medidor perdió
--                     tiempo (suspensión, kill, reloj) y el turno no es comparable.
--   calidad_ok        cobertura >= 85 y sin saltos de reloj y sin descartes del spool.
-- (algo_version = 3 añade:)
--   interrupciones    vueltas a un paciente que ya se había abierto antes en el turno.
--   revisitas_sap     volver a una pantalla ya visitada dentro del mismo paciente.
--   consulta_ms       del primer al último instante con actividad de cada paciente (reloj de pared).
--   entre_consultas   en cada cambio de paciente, del último instante con actividad del anterior
--                     al primero del siguiente: cuánto tarda el médico en «quedar disponible» para
--                     el próximo (aproximación al time to administrative readiness; el momento en
--                     que el paciente se va físicamente no es observable).
--   carga_admin_pct   % del tiempo activo que fue en SAP.
create or replace function recompute_shift_summary(p_shift uuid)
returns void language plpgsql as $$
declare
  sh record;
  v_dur bigint;
  v_fg bigint;
  v_cobertura numeric;
  v_fecha date;
  v_ultimo_enter timestamptz;
begin
  select * into sh from shifts where shift_id = p_shift;
  if not found then return; end if;

  v_fecha := coalesce(sh.dia_operativo, (sh.started_at at time zone 'America/Bogota')::date);
  v_dur := greatest(0, (extract(epoch from (coalesce(sh.ended_at, now()) - sh.started_at)) * 1000)::bigint);
  select coalesce(sum(foreground_ms),0) into v_fg from samples where shift_id = p_shift;
  v_cobertura := case when v_dur > 0 then round(least(100.0, v_fg * 100.0 / v_dur), 1) else 0 end;
  select max(occurred_at) into v_ultimo_enter from events where shift_id = p_shift and kind = 'encounter_enter';

  insert into shift_summary as m (
    shift_id, doctor_id, device_id, phase, fecha_operativa, started_at, ended_at,
    duracion_ms, foreground_ms_total, active_ms_total, active_ms_por_app, his_ms, miracle_ms,
    typing_ms, keystrokes, clicks, scroll_ticks, context_switches,
    encounters, encounter_active_ms_mediana, post_atencion_ms, cola_post_turno_ms,
    sap_wait_ms_total, sap_roundtrips, ready_ms_p50, ready_ms_p95, pantallas_distintas, visitas,
    tabs, enters, correcciones, copias, pegados, guardados,
    interrupciones, revisitas_sap, consultas_por_hora, consulta_ms_mediana, entre_consultas_ms_mediana, carga_admin_pct,
    cobertura_pct, calidad, calidad_ok, algo_version, computed_at)
  select
    p_shift, sh.doctor_id, sh.device_id, phase_at(v_fecha), v_fecha, sh.started_at, sh.ended_at,
    v_dur, v_fg,
    coalesce((select sum(active_ms) from samples where shift_id = p_shift), 0),
    coalesce((select jsonb_object_agg(app, ms) from (
      select app, sum(active_ms) as ms from samples where shift_id = p_shift group by app) a), '{}'::jsonb),
    coalesce((select sum(active_ms) from samples where shift_id = p_shift and app = 'sap'), 0),
    coalesce((select sum(active_ms) from samples where shift_id = p_shift and app = 'miracle_web'), 0),
    coalesce((select sum(typing_ms) from samples where shift_id = p_shift), 0),
    coalesce((select sum(keystrokes) from samples where shift_id = p_shift), 0),
    coalesce((select sum(clicks) from samples where shift_id = p_shift), 0),
    coalesce((select sum(scroll_ticks) from samples where shift_id = p_shift), 0),
    coalesce((select sum(context_switches) from samples where shift_id = p_shift), 0),
    (select count(distinct encounter_key) from samples where shift_id = p_shift and encounter_key is not null),
    (select percentile_cont(0.5) within group (order by t)::bigint from (
       select sum(active_ms) as t from samples where shift_id = p_shift and encounter_key is not null group by encounter_key) e),
    -- post-atención: muestras del paciente K posteriores a la apertura de OTRO paciente
    -- que se abrió después de K.
    coalesce((
      with enters as (
        select encounter_key, min(occurred_at) as first_at from events
        where shift_id = p_shift and kind = 'encounter_enter' and encounter_key is not null
        group by encounter_key)
      select sum(s.active_ms) from samples s
      join enters e on e.encounter_key = s.encounter_key
      where s.shift_id = p_shift
        and exists (select 1 from enters o
                    where o.encounter_key <> s.encounter_key
                      and o.first_at > e.first_at and o.first_at < s.bucket_start)), 0),
    coalesce((select sum(active_ms) from samples
              where shift_id = p_shift and app = 'sap'
                and bucket_start > coalesce(v_ultimo_enter, sh.started_at)), 0),
    coalesce((select sum(sap_wait_ms) from sap_visits where shift_id = p_shift), 0),
    coalesce((select sum(roundtrips) from sap_visits where shift_id = p_shift), 0),
    (select round(percentile_cont(0.5) within group (order by ready_ms))::bigint from sap_visits where shift_id = p_shift and ready_ms is not null),
    (select round(percentile_cont(0.95) within group (order by ready_ms))::bigint from sap_visits where shift_id = p_shift and ready_ms is not null),
    (select count(distinct surface) from sap_visits where shift_id = p_shift),
    (select count(*) from sap_visits where shift_id = p_shift),
    coalesce((select sum(tabs) from samples where shift_id = p_shift), 0),
    coalesce((select sum(enters) from samples where shift_id = p_shift), 0),
    coalesce((select sum(correcciones) from samples where shift_id = p_shift), 0),
    coalesce((select sum(copias) from samples where shift_id = p_shift), 0),
    coalesce((select sum(pegados) from samples where shift_id = p_shift), 0),
    coalesce((select sum(guardados) from samples where shift_id = p_shift), 0),
    -- interrupciones: segunda (o más) apertura del mismo paciente en el turno
    (select count(*)::int from (
       select row_number() over (partition by encounter_key order by occurred_at) as rn
       from events where shift_id = p_shift and kind = 'encounter_enter' and encounter_key is not null) x
     where x.rn > 1),
    -- revisitas: la misma pantalla otra vez con el mismo paciente
    (select count(*)::int from (
       select row_number() over (partition by coalesce(encounter_key, ''), surface order by entered_at) as rn
       from sap_visits where shift_id = p_shift) y
     where y.rn > 1),
    case when v_dur > 0 then round(((select count(distinct encounter_key) from samples
                                     where shift_id = p_shift and encounter_key is not null) * 3600000.0 / v_dur)::numeric, 2)
         else null end,
    (select percentile_cont(0.5) within group (order by d)::bigint from (
       select (extract(epoch from (max(bucket_start) - min(bucket_start))) * 1000 + 15000)::double precision as d
       from samples where shift_id = p_shift and encounter_key is not null group by encounter_key) e),
    -- entre consultas: en cada cambio de paciente (A→B), del último instante con actividad de A al
    -- primero de B. Por tramos, no por paciente: en urgencias A vuelve después de B y el «último
    -- instante de A» sería posterior al primero de B.
    (select percentile_cont(0.5) within group (order by gap)::bigint from (
       select (extract(epoch from (bucket_start - lag(bucket_start) over (order by bucket_start, seq))) * 1000 - 15000)::double precision as gap,
              encounter_key, lag(encounter_key) over (order by bucket_start, seq) as anterior
       from samples where shift_id = p_shift and encounter_key is not null) r
     where anterior is not null and anterior <> encounter_key and gap >= 0),
    case when (select coalesce(sum(active_ms), 0) from samples where shift_id = p_shift) > 0
         then round(((select coalesce(sum(active_ms), 0) from samples where shift_id = p_shift and app = 'sap') * 100.0
                     / (select sum(active_ms) from samples where shift_id = p_shift))::numeric, 1)
         else null end,
    v_cobertura,
    jsonb_build_object('cobertura_pct', v_cobertura, 'huecos_ms', sh.huecos_ms, 'clock_jumps', sh.clock_jumps,
      'spool_dropped', sh.spool_dropped, 'hooks_degradados', sh.hooks_degradados,
      'ticks_sap_saltados_busy', sh.ticks_sap_saltados_busy),
    (v_cobertura >= 85 and sh.clock_jumps = 0 and sh.spool_dropped = 0),
    3, now()
  on conflict (shift_id) do update set
    doctor_id = excluded.doctor_id, device_id = excluded.device_id, phase = excluded.phase,
    fecha_operativa = excluded.fecha_operativa, started_at = excluded.started_at, ended_at = excluded.ended_at,
    duracion_ms = excluded.duracion_ms, foreground_ms_total = excluded.foreground_ms_total,
    active_ms_total = excluded.active_ms_total, active_ms_por_app = excluded.active_ms_por_app,
    his_ms = excluded.his_ms, miracle_ms = excluded.miracle_ms, typing_ms = excluded.typing_ms,
    keystrokes = excluded.keystrokes, clicks = excluded.clicks, scroll_ticks = excluded.scroll_ticks,
    context_switches = excluded.context_switches, encounters = excluded.encounters,
    encounter_active_ms_mediana = excluded.encounter_active_ms_mediana,
    post_atencion_ms = excluded.post_atencion_ms, cola_post_turno_ms = excluded.cola_post_turno_ms,
    sap_wait_ms_total = excluded.sap_wait_ms_total, sap_roundtrips = excluded.sap_roundtrips,
    ready_ms_p50 = excluded.ready_ms_p50, ready_ms_p95 = excluded.ready_ms_p95,
    pantallas_distintas = excluded.pantallas_distintas, visitas = excluded.visitas,
    tabs = excluded.tabs, enters = excluded.enters, correcciones = excluded.correcciones,
    copias = excluded.copias, pegados = excluded.pegados, guardados = excluded.guardados,
    interrupciones = excluded.interrupciones, revisitas_sap = excluded.revisitas_sap,
    consultas_por_hora = excluded.consultas_por_hora, consulta_ms_mediana = excluded.consulta_ms_mediana,
    entre_consultas_ms_mediana = excluded.entre_consultas_ms_mediana, carga_admin_pct = excluded.carga_admin_pct,
    cobertura_pct = excluded.cobertura_pct, calidad = excluded.calidad, calidad_ok = excluded.calidad_ok,
    algo_version = excluded.algo_version, computed_at = now();
end;
$$;

-- Resume los turnos que lo necesitan: nunca resumidos, cambiados después del último
-- resumen, o abiertos hace más de 10 minutos (para ver el día en curso). Devuelve cuántos.
create or replace function recompute_pending(p_max int default 500)
returns int language plpgsql as $$
declare v_n int := 0; r record;
begin
  for r in
    select s.shift_id from shifts s
    left join shift_summary ss on ss.shift_id = s.shift_id
    where ss.shift_id is null
       or s.updated_at > ss.computed_at
       or (s.ended_at is null and ss.computed_at < now() - interval '10 minutes')
    order by s.started_at
    limit greatest(1, coalesce(p_max, 500))
  loop
    perform recompute_shift_summary(r.shift_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Re-etiqueta la fase de todos los resúmenes según el calendario vigente (llamar tras
-- cambiar study_phases). Los datos crudos no se tocan.
create or replace function relabel_phases()
returns int language plpgsql as $$
declare v_n int;
begin
  update shifts s set phase = phase_at(coalesce(s.dia_operativo, (s.started_at at time zone 'America/Bogota')::date));
  update shift_summary m set phase = phase_at(m.fecha_operativa) where m.fecha_operativa is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
