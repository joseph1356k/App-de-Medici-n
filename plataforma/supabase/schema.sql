-- ============================================================================
-- ESQUEMA DE LA PLATAFORMA DE MEDICIÓN, v2 — un hospital, un Postgres (Supabase, Neon,
-- Vercel Postgres o el que sea). Se aplica UNA vez: `npm run db:aplicar` o pegarlo en el
-- editor SQL. Es idempotente: volver a correrlo no rompe nada.
--
-- v2 (2026-09-02): la unidad de análisis es el CONSULTORIO y su JORNADA (consultorio × día
-- operativo), no el turno de un médico. Los PCs graban SIEMPRE: cada cubeta de 15 s llega
-- aunque nadie toque el PC o esté bloqueado, así la línea de tiempo del día distingue
-- «activo», «inactivo», «bloqueado» y «sin datos» (el medidor no estaba). El médico queda
-- como anotación derivada del usuario SAP visto (roster), nunca como clave.
--
-- Una base con el esquema v1 (samples.shift_id) no se migra: se borra con reset-v1.sql y se
-- aplica este archivo. Decisión del dueño (2026-09-02): los datos v1 no eran fiables.
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

-- Guardia: este archivo no sabe convivir con el esquema v1.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = current_schema() and table_name = 'samples' and column_name = 'shift_id') then
    raise exception 'Esta base tiene el esquema v1 (samples.shift_id). Corre supabase/reset-v1.sql primero y vuelve a aplicar schema.sql.';
  end if;
end $$;

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
  -- QUÉ PROCESO ES QUÉ APP. Lo que no esté en esta lista viaja con el nombre de su .exe (medidor
  -- 2.0.5 en adelante) o como «otro» (2.0.0–2.0.4). En los dos casos el TIEMPO se mide igual; lo
  -- que solo da esta lista es un nombre estable y un color fijo en el panel, y agrupar varios
  -- procesos en una misma app (los seis Office, los cuatro SAP). Se amplía en caliente desde
  -- Configuración → config del medidor: los PCs la obedecen en el siguiente latido, sin reinstalar.
  'apps_por_proceso', '{
    "saplogon.exe":"sap", "saplgpad.exe":"sap", "sapgui.exe":"sap",
    "sapshcut.exe":"sap", "chrome.exe":"chrome", "msedge.exe":"edge",
    "firefox.exe":"firefox", "brave.exe":"brave", "opera.exe":"opera",
    "iexplore.exe":"ie", "msedgewebview2.exe":"webview", "winword.exe":"office",
    "excel.exe":"office", "powerpnt.exe":"office", "onenote.exe":"office",
    "msaccess.exe":"office", "mspub.exe":"office", "outlook.exe":"outlook",
    "olk.exe":"outlook", "teams.exe":"teams", "ms-teams.exe":"teams",
    "msteams.exe":"teams", "lync.exe":"teams", "whatsapp.exe":"whatsapp",
    "zoom.exe":"zoom", "slack.exe":"slack", "skype.exe":"skype",
    "acrord32.exe":"pdf", "acrobat.exe":"pdf", "foxitreader.exe":"pdf",
    "foxitphantompdf.exe":"pdf", "sumatrapdf.exe":"pdf", "pdfxedit.exe":"pdf",
    "explorer.exe":"explorador", "searchapp.exe":"escritorio", "searchhost.exe":"escritorio",
    "searchui.exe":"escritorio", "shellexperiencehost.exe":"escritorio", "startmenuexperiencehost.exe":"escritorio",
    "applicationframehost.exe":"escritorio", "lockapp.exe":"escritorio", "logonui.exe":"escritorio",
    "textinputhost.exe":"escritorio", "systemsettings.exe":"escritorio", "sihost.exe":"escritorio",
    "ctfmon.exe":"escritorio", "dwm.exe":"escritorio", "rundll32.exe":"escritorio",
    "taskmgr.exe":"escritorio", "control.exe":"escritorio", "cmd.exe":"escritorio",
    "powershell.exe":"escritorio", "windowsterminal.exe":"escritorio", "notepad.exe":"notas",
    "wordpad.exe":"notas", "mspaint.exe":"notas", "calc.exe":"notas",
    "calculator.exe":"notas", "stickynot.exe":"notas", "snippingtool.exe":"notas",
    "mstsc.exe":"remoto", "wfica32.exe":"remoto", "cdviewer.exe":"remoto",
    "vmware-view.exe":"remoto", "anydesk.exe":"remoto", "teamviewer.exe":"remoto",
    "javaw.exe":"java", "java.exe":"java", "jp2launcher.exe":"java",
    "vlc.exe":"medios", "wmplayer.exe":"medios", "microsoft.photos.exe":"medios",
    "video.ui.exe":"medios", "winrar.exe":"archivos", "7zfm.exe":"archivos",
    "7zg.exe":"archivos", "u.exe":"uexe"
  }'::jsonb,
  'dominios_permitidos', jsonb_build_array(),
  'dominios_miracle', jsonb_build_array('itsmiracleai.com.co','www.itsmiracleai.com.co'),
  'reglas_identidad', jsonb_build_array(
    jsonb_build_object('id','titulo-patnr','tcode','*','fuente','titulo_sap',
      'patron','(?:PATNR|[Pp]aciente|[Nn]HC)\D*0*([0-9]{5,10})','normalizar','digitos_sin_ceros')),
  'sap_clases_de_sesion', jsonb_build_array('SAP_FRONTEND_SESSION'),
  'foreground_ms', 1000, 'sap_identity_ms', 1500, 'solo_foreground', false))
on conflict (id) do nothing;

-- ── Médicos: una ANOTACIÓN opcional, no la unidad ────────────────────────────
-- sap_users: los logins de SAP de esa persona (en MAYÚSCULA). Con ellos el panel pone un
-- nombre junto al usuario SAP visto en una jornada. El PC ya no pregunta el médico.
-- No se borra: desactivar mantiene la referencia.
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
-- La fase de una jornada SIEMPRE se deriva de este calendario por día operativo; el
-- snapshot guardado en el resumen es cache. Cambiar el calendario re-etiqueta el pasado.
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

-- ── Helpers ──────────────────────────────────────────────────────────────────
-- El día operativo del hospital corta a las 06:00 de Bogotá (una guardia nocturna pertenece
-- al día en que empezó). Es la misma regla de lib/fechas.ts y de Huella.cs en el .exe.
create or replace function dia_operativo_de(t timestamptz) returns date
language sql stable as $$
  select ((t at time zone 'America/Bogota') - interval '6 hours')::date;
$$;

-- El médico anotado para un login SAP, si está en el roster (case-insensitive).
create or replace function medico_de(p_sap_user text) returns uuid
language sql stable as $$
  select r.id from roster r
  where p_sap_user is not null and upper(p_sap_user) = any (r.sap_users)
  order by r.active desc, r.sort_order limit 1;
$$;

-- ── Consultorios: LA unidad ──────────────────────────────────────────────────
create table if not exists consultorios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
alter table consultorios enable row level security;

insert into consultorios (nombre, orden) values ('Consultorio 1', 1), ('Consultorio 2', 2), ('Consultorio 3', 3)
on conflict (nombre) do nothing;

-- ── Dispositivos (cada PC con el .exe) ───────────────────────────────────────
-- consultorio_id: se asigna DESDE EL PANEL. Al asignarlo se estampan las filas que ese PC
-- mandó sin consultorio (asignar_consultorio); las ya estampadas no se reescriben nunca:
-- la historia es una foto, reasignar un PC no reescribe lo medido.
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
  consultorio_id uuid references consultorios(id) on delete set null,
  consultorio_desde timestamptz
);
alter table devices enable row level security;
create index if not exists devices_seen_idx on devices (last_seen_at desc);
create index if not exists devices_consultorio_idx on devices (consultorio_id);

-- ── Jornadas: la foto de calidad de un día, por proceso del .exe ─────────────
-- Una fila por (PC, día operativo, proceso). proceso_id es un GUID por arranque del .exe:
-- cada proceso empieza sus contadores en cero, así que el resumen del día SUMA las filas
-- y `procesos - 1` es cuántas veces se relanzó. Dentro de un proceso los contadores solo
-- crecen: el upsert se queda con el mayor.
create table if not exists jornadas (
  device_id uuid not null references devices(id) on delete cascade,
  dia_operativo date not null,
  proceso_id uuid not null,
  consultorio_id uuid references consultorios(id) on delete set null,
  primera_muestra_at timestamptz,
  ultima_muestra_at timestamptz,
  app_version text not null default '',
  hmac_version int not null default 1,
  huecos_ms bigint not null default 0,
  clock_jumps int not null default 0,
  spool_dropped int not null default 0,
  hooks_degradados boolean not null default false,
  hooks_rearmados int not null default 0,
  ticks_sap_saltados_busy int not null default 0,
  sap_scripting boolean,          -- el motor de SAP GUI Scripting se enganchó alguna vez
  sap_eventos_com boolean,        -- los eventos StartRequest/EndRequest se engancharon
  relanzos int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_id, dia_operativo, proceso_id)
);
alter table jornadas enable row level security;
create index if not exists jornadas_dia_idx on jornadas (dia_operativo desc);

-- ── Muestras: la serie temporal (la tabla de volumen) ────────────────────────
-- Una fila por cubeta de 15 s por contexto (app · superficie · paciente · usuario SAP).
-- SIEMPRE llegan: con el PC bloqueado la app es 'bloqueado' (sin pantalla, sin paciente,
-- sin usuario, activo 0). La clave natural (device_id, bucket_start, seq) da idempotencia:
-- un lote reenviado tras un timeout hace ON CONFLICT DO NOTHING. ~5.800 filas por PC y día.
create table if not exists samples (
  id bigint generated always as identity primary key,
  device_id uuid not null references devices(id) on delete cascade,
  consultorio_id uuid references consultorios(id) on delete set null,
  dia_operativo date not null,
  bucket_start timestamptz not null,
  bucket_ms int not null default 15000,
  seq smallint not null default 0,
  app text not null default 'otro',
  surface text,                 -- sapgui://SID/TCODE/PROGRAMA/DYNPRO[/sub] | web://dominio | NULL. Nunca un título.
  encounter_key text,           -- HMAC hex de 32; NULL si la pantalla no dio paciente
  sap_user text,                -- login de SAP visto (del médico, no del paciente)
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
  unique (device_id, bucket_start, seq),
  check (app <> 'bloqueado' or surface is null)
);
alter table samples enable row level security;
create index if not exists samples_consultorio_dia_idx on samples (consultorio_id, dia_operativo);
create index if not exists samples_device_dia_idx on samples (device_id, dia_operativo);

-- ── Eventos discretos tipados ────────────────────────────────────────────────
-- event_uid = {device}:{coleccion}:{spool_seq} → unique → idempotencia. detail pasa por
-- lista blanca de claves en la API antes de insertar. La lista de `kind` es la misma de
-- lib/vocabulario.ts (tests/vocabulario.test.ts vigila que no se separen).
create table if not exists events (
  id bigint generated always as identity primary key,
  event_uid text not null unique,
  device_id uuid not null references devices(id) on delete cascade,
  consultorio_id uuid references consultorios(id) on delete set null,
  dia_operativo date not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  encounter_key text,
  kind text not null check (kind in (
    'jornada_inicio','jornada_fin',
    'encounter_enter','encounter_exit','encounter_unknown',
    'lock','unlock','suspend','resume',
    'medidor_start','medidor_stop',
    'sap_attach','sap_detach','sap_user_seen','sap_scripting_no_disponible',
    'clock_jump','spool_drop','spool_reset','hooks_degradados','hooks_rearmados',
    'config_applied','consultorio_asignado',
    'ops_run','calidad')),
  detail jsonb not null default '{}'::jsonb
);
alter table events enable row level security;
create index if not exists events_device_time_idx on events (device_id, occurred_at);
create index if not exists events_consultorio_dia_idx on events (consultorio_id, dia_operativo);
create index if not exists events_kind_idx on events (kind, occurred_at desc);

-- ── Visitas SAP: el recorrido por el HIS, como segmentos ─────────────────────
create table if not exists sap_visits (
  id bigint generated always as identity primary key,
  visit_uid text not null unique,
  device_id uuid not null references devices(id) on delete cascade,
  consultorio_id uuid references consultorios(id) on delete set null,
  dia_operativo date not null,
  encounter_key text,
  sap_user text,
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
create index if not exists sap_visits_device_time_idx on sap_visits (device_id, entered_at);
create index if not exists sap_visits_consultorio_dia_idx on sap_visits (consultorio_id, dia_operativo);
create index if not exists sap_visits_tcode_idx on sap_visits (tcode, entered_at desc);

-- ── Resumen por jornada: el artefacto de largo plazo ─────────────────────────
-- Una fila por (PC, día operativo), RECOMPUTABLE (algo_version). consultorio_id es la foto:
-- el estampado en la última muestra del día (o el del PC si no hubo). calidad_ok es el filtro
-- por defecto de toda comparación; calidad_motivos dice por qué una jornada quedó fuera.
create table if not exists jornada_summary (
  device_id uuid not null references devices(id) on delete cascade,
  dia_operativo date not null,
  consultorio_id uuid references consultorios(id) on delete set null,
  phase text not null default 'baseline',
  primera_actividad timestamptz,
  ultima_actividad timestamptz,
  primera_muestra timestamptz,
  ultima_muestra timestamptz,
  ventana_ms bigint not null default 0,           -- de la primera a la última cubeta activa
  foreground_ms bigint not null default 0,
  activo_ms bigint not null default 0,
  his_ms bigint not null default 0,
  miracle_ms bigint not null default 0,
  activo_por_app jsonb not null default '{}'::jsonb,
  sap_users jsonb not null default '{}'::jsonb,   -- {login: activo_ms}
  typing_ms bigint not null default 0,
  keystrokes bigint not null default 0,
  clicks bigint not null default 0,
  scroll_ticks bigint not null default 0,
  context_switches bigint not null default 0,
  tabs bigint not null default 0,
  enters bigint not null default 0,
  correcciones bigint not null default 0,
  copias bigint not null default 0,
  pegados bigint not null default 0,
  guardados bigint not null default 0,
  pacientes int not null default 0,
  consulta_ms_mediana bigint,
  activo_por_paciente_mediana bigint,
  entre_consultas_ms_mediana bigint,
  post_atencion_ms bigint not null default 0,
  interrupciones int not null default 0,
  pacientes_por_hora numeric,                     -- por hora EN TRAMOS de actividad, no de reloj
  visitas int not null default 0,
  pantallas_distintas int not null default 0,
  revisitas_sap int not null default 0,
  sap_wait_ms bigint not null default 0,
  sap_roundtrips int not null default 0,
  ready_ms_p50 bigint,
  ready_ms_p95 bigint,
  bloqueado_ms bigint not null default 0,
  inactivo_ms bigint not null default 0,
  sin_datos_ms bigint not null default 0,         -- huecos > 30 s entre cubetas consecutivas
  cobertura_pct numeric,                          -- cubetas dentro de la ventana de actividad / ventana
  carga_admin_pct numeric,                        -- % del activo que fue en SAP
  tramos int not null default 0,                  -- islas de actividad separadas por >= 15 min
  tramos_ms bigint not null default 0,
  procesos int not null default 0,
  app_version text not null default '',
  pre_atencion_ms bigint not null default 0,      -- activo antes de abrir al primer paciente (arranque del día)
  cola_post_jornada_ms bigint not null default 0, -- activo en SAP después de abrir al último paciente (la cola de documentación)
  consulta_ms_p25 bigint,
  consulta_ms_p75 bigint,
  por_app jsonb not null default '{}'::jsonb,     -- {app: {activo_ms, foreground_ms, typing_ms, keystrokes, clicks}}
  por_hora jsonb not null default '{}'::jsonb,    -- {"07": activo_ms, "08": …} hora de Bogotá
  calidad jsonb not null default '{}'::jsonb,
  calidad_ok boolean not null default false,
  calidad_motivos text[] not null default '{}',
  sucia boolean not null default true,
  resumido_en timestamptz,
  algo_version int not null default 1,
  primary key (device_id, dia_operativo)
);
alter table jornada_summary enable row level security;
-- Para bases que aplicaron la v2 antes del algo_version 2 (idempotente).
alter table jornada_summary add column if not exists pre_atencion_ms bigint not null default 0;
alter table jornada_summary add column if not exists cola_post_jornada_ms bigint not null default 0;
alter table jornada_summary add column if not exists consulta_ms_p25 bigint;
alter table jornada_summary add column if not exists consulta_ms_p75 bigint;
alter table jornada_summary add column if not exists por_app jsonb not null default '{}'::jsonb;
alter table jornada_summary add column if not exists por_hora jsonb not null default '{}'::jsonb;

-- ── Encuentros: una fila por paciente y día ──────────────────────────────────
-- Lo que cuesta CADA consulta, derivado de las cubetas al resumir la jornada (se regenera con
-- ella). El paciente es la huella del día; `orden` es el P1, P2… de la línea de tiempo.
create table if not exists encuentros (
  device_id uuid not null references devices(id) on delete cascade,
  dia_operativo date not null,
  encounter_key text not null,
  consultorio_id uuid references consultorios(id) on delete set null,
  orden int not null default 0,
  primera_vez timestamptz not null,
  ultima_vez timestamptz not null,
  consulta_ms bigint not null default 0,          -- reloj de pared: del primer toque al fin de la última cubeta
  activo_ms bigint not null default 0,
  his_ms bigint not null default 0,
  miracle_ms bigint not null default 0,
  typing_ms bigint not null default 0,
  keystrokes bigint not null default 0,
  clicks bigint not null default 0,
  tabs bigint not null default 0,
  enters bigint not null default 0,
  correcciones bigint not null default 0,
  copias bigint not null default 0,
  pegados bigint not null default 0,
  guardados bigint not null default 0,
  tramos int not null default 1,                  -- rachas de atención: A→B→A da 2 para A
  post_atencion_ms bigint not null default 0,     -- activo sobre este paciente después de abrir otro posterior
  siguiente_ms bigint,                            -- del último toque de este paciente al primero del siguiente (nulo si fue el último)
  visitas int not null default 0,
  pantallas_distintas int not null default 0,
  sap_wait_ms bigint not null default 0,
  ready_ms_p50 bigint,
  sap_user text,                                  -- el login con más activo sobre este paciente
  primary key (device_id, dia_operativo, encounter_key)
);
alter table encuentros enable row level security;
create index if not exists encuentros_consultorio_dia_idx on encuentros (consultorio_id, dia_operativo);
create index if not exists jornada_summary_consultorio_idx on jornada_summary (consultorio_id, dia_operativo desc);
create index if not exists jornada_summary_dia_idx on jornada_summary (dia_operativo desc);
create index if not exists jornada_summary_phase_idx on jornada_summary (phase, consultorio_id);
create index if not exists jornada_summary_sucia_idx on jornada_summary (dia_operativo) where sucia;

-- ============================================================================
-- FUNCIONES
-- ============================================================================

-- Upsert de la foto de una jornada por proceso. Dentro de un proceso los contadores solo
-- crecen: se queda el mayor. primera/última muestra: la menor y la mayor.
create or replace function upsert_jornada(
  p_device uuid, p_dia date, p_proceso uuid, p_consultorio uuid,
  p_primera timestamptz, p_ultima timestamptz, p_app_version text, p_hmac int,
  p_huecos bigint, p_clock int, p_dropped int, p_hooks_deg boolean, p_hooks_rearm int, p_ticks int,
  p_sap_scripting boolean, p_sap_eventos boolean, p_relanzos int)
returns void language plpgsql as $$
begin
  insert into jornadas (
    device_id, dia_operativo, proceso_id, consultorio_id, primera_muestra_at, ultima_muestra_at,
    app_version, hmac_version, huecos_ms, clock_jumps, spool_dropped, hooks_degradados, hooks_rearmados,
    ticks_sap_saltados_busy, sap_scripting, sap_eventos_com, relanzos)
  values (
    p_device, p_dia, p_proceso, p_consultorio, p_primera, p_ultima,
    coalesce(p_app_version, ''), coalesce(p_hmac, 1), coalesce(p_huecos, 0), coalesce(p_clock, 0), coalesce(p_dropped, 0),
    coalesce(p_hooks_deg, false), coalesce(p_hooks_rearm, 0), coalesce(p_ticks, 0), p_sap_scripting, p_sap_eventos, coalesce(p_relanzos, 0))
  on conflict (device_id, dia_operativo, proceso_id) do update set
    consultorio_id = coalesce(jornadas.consultorio_id, excluded.consultorio_id),
    primera_muestra_at = least(jornadas.primera_muestra_at, excluded.primera_muestra_at),
    ultima_muestra_at = greatest(jornadas.ultima_muestra_at, excluded.ultima_muestra_at),
    app_version = coalesce(nullif(excluded.app_version, ''), jornadas.app_version),
    hmac_version = excluded.hmac_version,
    huecos_ms = greatest(jornadas.huecos_ms, excluded.huecos_ms),
    clock_jumps = greatest(jornadas.clock_jumps, excluded.clock_jumps),
    spool_dropped = greatest(jornadas.spool_dropped, excluded.spool_dropped),
    hooks_degradados = jornadas.hooks_degradados or excluded.hooks_degradados,
    hooks_rearmados = greatest(jornadas.hooks_rearmados, excluded.hooks_rearmados),
    ticks_sap_saltados_busy = greatest(jornadas.ticks_sap_saltados_busy, excluded.ticks_sap_saltados_busy),
    -- «alguna vez enganchó» dentro del proceso; si ninguna foto trae el dato, sigue sin saberse (NULL).
    sap_scripting = case when jornadas.sap_scripting is null and excluded.sap_scripting is null then null
                         else coalesce(jornadas.sap_scripting, false) or coalesce(excluded.sap_scripting, false) end,
    sap_eventos_com = case when jornadas.sap_eventos_com is null and excluded.sap_eventos_com is null then null
                           else coalesce(jornadas.sap_eventos_com, false) or coalesce(excluded.sap_eventos_com, false) end,
    relanzos = greatest(jornadas.relanzos, excluded.relanzos),
    updated_at = now();
end;
$$;

-- EL RESUMEN de una jornada desde el crudo (algo_version = 3): primero los ENCUENTROS (una fila
-- por paciente) y después la jornada, que lee de ellos. Recomputable: cambiar una definición y
-- volver a correr no pierde nada. Con p_min_intervalo > 0 hace de acelerador: si se resumió
-- hace menos, solo la marca sucia y devuelve false (la ingesta lo llama cada minuto; el cron
-- termina lo sucio).
--
-- Definiciones:
--   activo_ms          cubetas con input en los últimos 60 s (active_ms del .exe)
--   his_ms             activo con app = 'sap' · miracle_ms: activo con app = 'miracle_web'
--   bloqueado_ms       cubetas con app = 'bloqueado' · inactivo_ms: encendido sin input
--   sin_datos_ms       huecos > 30 s entre cubetas consecutivas (apagado, suspendido, medidor muerto)
--   ventana_ms         de la primera cubeta activa al fin de la última
--   cobertura_pct      cubetas dentro de la ventana / ventana. < 80 = el medidor perdió tiempo
--   tramos             islas de cubetas activas separadas por >= 15 min sin actividad
--   pacientes_por_hora pacientes / horas EN TRAMOS (no de reloj: una tarde vacía no diluye)
--   consulta_ms        del primer al último instante con actividad de cada paciente (reloj de pared)
--   entre_consultas    en cada cambio de paciente, del último instante del anterior al primero del siguiente
--   interrupciones     vueltas a un paciente que ya se había abierto (A→B→A cuenta 1)
--   post_atencion_ms   activo sobre un paciente A DESPUÉS de que se abrió otro paciente posterior
--   pre_atencion_ms    activo antes de abrir al primer paciente del día (el arranque)
--   cola_post_jornada  activo en SAP después de abrir al último paciente del día (la cola de documentación)
--   revisitas_sap      volver a una pantalla ya visitada con el mismo paciente
--   por_app / por_hora activo, tecleo y clics por app; activo por hora de Bogotá
--   calidad_ok         spool_dropped = 0 y clock_jumps <= 2 y cobertura >= 80 (y hubo actividad)
create or replace function recompute_jornada(p_device uuid, p_dia date, p_min_intervalo interval default interval '0')
returns boolean language plpgsql as $$
declare
  v_res timestamptz;
  v_dev_cons uuid;
  v_cons uuid;
begin
  select resumido_en into v_res from jornada_summary where device_id = p_device and dia_operativo = p_dia;
  if v_res is not null and p_min_intervalo > interval '0' and v_res > now() - p_min_intervalo then
    update jornada_summary set sucia = true where device_id = p_device and dia_operativo = p_dia;
    return false;
  end if;
  select consultorio_id into v_dev_cons from devices where id = p_device;
  -- El consultorio de la jornada es una foto: el estampado en la última cubeta del día, si no el del PC.
  select coalesce((select s.consultorio_id from samples s where s.device_id = p_device and s.dia_operativo = p_dia and s.consultorio_id is not null
                   order by s.bucket_start desc, s.seq desc limit 1), v_dev_cons) into v_cons;

  -- 1) Los encuentros: lo que costó cada paciente.
  delete from encuentros where device_id = p_device and dia_operativo = p_dia;
  insert into encuentros (device_id, dia_operativo, encounter_key, consultorio_id, orden, primera_vez, ultima_vez, consulta_ms,
    activo_ms, his_ms, miracle_ms, typing_ms, keystrokes, clicks, tabs, enters, correcciones, copias, pegados, guardados,
    tramos, post_atencion_ms, siguiente_ms, visitas, pantallas_distintas, sap_wait_ms, ready_ms_p50, sap_user)
  with b as (
    select bucket_start, seq, app, encounter_key, sap_user, active_ms, typing_ms, keystrokes, clicks, tabs, enters, correcciones, copias, pegados, guardados,
      greatest(coalesce(nullif(bucket_ms, 0), 15000), greatest(foreground_ms, 0))::bigint as ancho_ms
    from samples s where s.device_id = p_device and s.dia_operativo = p_dia and s.encounter_key is not null),
  pac as (
    -- El paciente pudo quedarse abierto mientras nadie tocaba el PC: esa cubeta cuenta con lo que
    -- cubre de verdad (lo declarado, o lo medido si es mas), no con 15 s de oficio.
    select encounter_key, min(bucket_start) primera, max(bucket_start + (ancho_ms || ' milliseconds')::interval) ultima,
      sum(active_ms)::bigint act, coalesce(sum(active_ms) filter (where app = 'sap'), 0)::bigint his, coalesce(sum(active_ms) filter (where app = 'miracle_web'), 0)::bigint mir,
      sum(typing_ms)::bigint typ, sum(keystrokes)::bigint ks, sum(clicks)::bigint cl,
      sum(tabs)::bigint tabs, sum(enters)::bigint enters, sum(correcciones)::bigint corr, sum(copias)::bigint cop, sum(pegados)::bigint peg, sum(guardados)::bigint gua
    from b group by encounter_key),
  po as (
    select bucket_start, seq, encounter_key, lag(bucket_start) over w prev_start, lag(encounter_key) over w prev_enc
    from b window w as (order by bucket_start, seq)),
  runs as (
    select encounter_key, count(*) filter (where prev_enc is distinct from encounter_key)::int r from po group by encounter_key),
  postp as (
    select k.encounter_key, coalesce(sum(x.active_ms), 0)::bigint ms from pac k join b x on x.encounter_key = k.encounter_key
    where exists (select 1 from pac o where o.encounter_key <> k.encounter_key and o.primera > k.primera and o.primera < x.bucket_start)
    group by k.encounter_key),
  usu as (
    select distinct on (encounter_key) encounter_key, sap_user
    from (select encounter_key, sap_user, sum(active_ms) ms from b where sap_user is not null group by 1, 2) z
    order by encounter_key, ms desc),
  visp as (
    select encounter_key, count(*)::int visitas, count(distinct surface)::int pantallas, coalesce(sum(sap_wait_ms), 0)::bigint wait,
      round(percentile_cont(0.5) within group (order by ready_ms) filter (where ready_ms is not null))::bigint p50
    from sap_visits where device_id = p_device and dia_operativo = p_dia and encounter_key is not null group by encounter_key),
  sig as (
    select distinct on (prev_enc) prev_enc as encounter_key,
      greatest(0, (extract(epoch from (bucket_start - prev_start)) * 1000 - 15000))::bigint gap
    from po where prev_enc is not null and prev_enc <> encounter_key order by prev_enc, bucket_start)
  select p_device, p_dia, k.encounter_key, v_cons, row_number() over (order by k.primera)::int,
    k.primera, k.ultima, (extract(epoch from (k.ultima - k.primera)) * 1000)::bigint,
    k.act, k.his, k.mir, k.typ, k.ks, k.cl, k.tabs, k.enters, k.corr, k.cop, k.peg, k.gua,
    coalesce(r.r, 1), coalesce(pp.ms, 0), s.gap, coalesce(v.visitas, 0), coalesce(v.pantallas, 0), coalesce(v.wait, 0), v.p50, u.sap_user
  from pac k
  left join runs r on r.encounter_key = k.encounter_key
  left join postp pp on pp.encounter_key = k.encounter_key
  left join usu u on u.encounter_key = k.encounter_key
  left join visp v on v.encounter_key = k.encounter_key
  left join sig s on s.encounter_key = k.encounter_key;

  -- 2) La jornada.
  insert into jornada_summary as j (
    device_id, dia_operativo, consultorio_id, phase,
    primera_actividad, ultima_actividad, primera_muestra, ultima_muestra, ventana_ms,
    foreground_ms, activo_ms, his_ms, miracle_ms, activo_por_app, sap_users,
    typing_ms, keystrokes, clicks, scroll_ticks, context_switches,
    tabs, enters, correcciones, copias, pegados, guardados,
    pacientes, consulta_ms_mediana, activo_por_paciente_mediana, entre_consultas_ms_mediana, post_atencion_ms, interrupciones, pacientes_por_hora,
    visitas, pantallas_distintas, revisitas_sap, sap_wait_ms, sap_roundtrips, ready_ms_p50, ready_ms_p95,
    bloqueado_ms, inactivo_ms, sin_datos_ms, cobertura_pct, carga_admin_pct,
    tramos, tramos_ms, procesos, app_version,
    pre_atencion_ms, cola_post_jornada_ms, consulta_ms_p25, consulta_ms_p75, por_app, por_hora,
    calidad, calidad_ok, calidad_motivos, sucia, resumido_en, algo_version)
  with fila as (
    select s.bucket_start, s.seq, s.app, s.surface, s.encounter_key, s.sap_user,
      s.foreground_ms, s.active_ms, s.typing_ms, s.keystrokes, s.clicks, s.scroll_ticks, s.context_switches,
      s.sap_roundtrips, s.sap_wait_ms, s.tabs, s.enters, s.correcciones, s.copias, s.pegados, s.guardados,
      coalesce(nullif(s.bucket_ms, 0), 15000)::bigint as declarado_ms
    from samples s where s.device_id = p_device and s.dia_operativo = p_dia),
  -- CUÁNTO CUBRE UNA CUBETA DE VERDAD. Lo declarado (15 s, o el tramo entero si el medidor fundió
  -- cubetas vacías) es un MÍNIMO, no la respuesta: una cubeta se numera con el reloj de pared del
  -- PC y se llena con ticks medidos en el monotónico, y cuando el de pared se arrastra —los PCs
  -- del HGM lo hacen: el sistema corrige la hora en pasitos hacia atrás, cada uno demasiado
  -- pequeño para contar como salto— todos los ticks de ese rato caen en la MISMA cubeta. Sale una
  -- cubeta con 180 s de foreground dentro y ninguna hasta 180 s después.
  --
  -- El tiempo no se pierde, está ahí medido: en producción la suma de foreground_ms de un día es
  -- EXACTAMENTE la ventana de ese día. Lo que se perdía era la cobertura, que contaba filas × 15 s
  -- y declaraba «sin datos» un tercio de una jornada entera y bien medida — y con eso la excluía
  -- del estudio. Así que la cubeta cubre lo que midió, sin pasarse de la siguiente.
  cubx as (
    select bucket_start, bool_or(active_ms > 0) as activa,
      greatest(max(declarado_ms), coalesce(sum(greatest(foreground_ms, 0)), 0))::bigint as span_ms
    from fila group by bucket_start),
  cub as (
    select bucket_start, activa,
      least(span_ms, coalesce((extract(epoch from (lead(bucket_start) over (order by bucket_start) - bucket_start)) * 1000)::bigint, span_ms))::bigint as ancho_ms
    from cubx),
  b as (
    -- Dentro de una cubeta las partes (seq) se reparten ese ancho en proporción a su foreground:
    -- así bloqueado/inactivo suman tiempo real, no filas.
    select f.*, c.ancho_ms,
      case when sum(greatest(f.foreground_ms, 0)) over (partition by f.bucket_start) > 0
           then round(greatest(f.foreground_ms, 0) * c.ancho_ms::numeric / sum(greatest(f.foreground_ms, 0)) over (partition by f.bucket_start))
           else round(c.ancho_ms::numeric / count(*) over (partition by f.bucket_start)) end::bigint as dur_ms
    from fila f join cub c on c.bucket_start = f.bucket_start),
  tot as (
    select coalesce(sum(foreground_ms), 0)::bigint fg, coalesce(sum(active_ms), 0)::bigint act,
      coalesce(sum(active_ms) filter (where app = 'sap'), 0)::bigint his,
      coalesce(sum(active_ms) filter (where app = 'miracle_web'), 0)::bigint mir,
      coalesce(sum(typing_ms), 0)::bigint typ, coalesce(sum(keystrokes), 0)::bigint ks, coalesce(sum(clicks), 0)::bigint cl,
      coalesce(sum(scroll_ticks), 0)::bigint sc, coalesce(sum(context_switches), 0)::bigint cs,
      coalesce(sum(tabs), 0)::bigint tabs, coalesce(sum(enters), 0)::bigint enters, coalesce(sum(correcciones), 0)::bigint corr,
      coalesce(sum(copias), 0)::bigint cop, coalesce(sum(pegados), 0)::bigint peg, coalesce(sum(guardados), 0)::bigint gua,
      coalesce(sum(dur_ms) filter (where app = 'bloqueado'), 0)::bigint bloq,
      coalesce(sum(dur_ms) filter (where app <> 'bloqueado' and active_ms = 0), 0)::bigint inact
    from b),
  ventana as (
    select min(bucket_start) filter (where activa) pa,
           max(bucket_start + (ancho_ms || ' milliseconds')::interval) filter (where activa) ua,
           min(bucket_start) pm, max(bucket_start + (ancho_ms || ' milliseconds')::interval) um
    from cub),
  cubierto as (
    select coalesce(sum(cub.ancho_ms), 0)::bigint ms from cub, ventana where cub.bucket_start >= ventana.pa and cub.bucket_start < ventana.ua),
  gaps as (
    select coalesce(sum(extract(epoch from (bucket_start - prev_fin)) * 1000), 0)::bigint ms
    from (select bucket_start, lag(bucket_start + (ancho_ms || ' milliseconds')::interval) over (order by bucket_start) prev_fin from cub) g
    where prev_fin is not null and bucket_start - prev_fin > interval '30 seconds'),
  apps as (
    select coalesce(jsonb_object_agg(app, ms), '{}'::jsonb) j from (select app, sum(active_ms) ms from b group by app) a),
  detalle as (
    select coalesce(jsonb_object_agg(app, jsonb_build_object('activo_ms', act, 'foreground_ms', fg, 'typing_ms', typ, 'keystrokes', ks, 'clicks', cl)), '{}'::jsonb) j
    from (select app, sum(active_ms) act, sum(foreground_ms) fg, sum(typing_ms) typ, sum(keystrokes) ks, sum(clicks) cl from b group by app) a),
  horas as (
    select coalesce(jsonb_object_agg(h, ms), '{}'::jsonb) j
    from (select to_char(bucket_start at time zone 'America/Bogota', 'HH24') h, sum(active_ms) ms from b group by 1) x),
  users as (
    select coalesce(jsonb_object_agg(sap_user, ms), '{}'::jsonb) j from (select sap_user, sum(active_ms) ms from b where sap_user is not null group by sap_user) u),
  isl as (
    select grp, min(bucket_start) t0, max(bucket_start + (ancho_ms || ' milliseconds')::interval) t1 from (
      select bucket_start, ancho_ms, sum(nuevo) over (order by bucket_start) grp from (
        select bucket_start, ancho_ms,
          case when lag(bucket_start) over (order by bucket_start) is null
                 or bucket_start - lag(bucket_start) over (order by bucket_start) >= interval '15 minutes' then 1 else 0 end nuevo
        from cub where activa) x) y group by grp),
  -- La isla acaba donde acaba su última cubeta: con el ancho real de esa cubeta, no con 15 s fijos.
  tramos as (
    select count(*)::int n, coalesce(sum(extract(epoch from (t1 - t0)) * 1000), 0)::bigint ms from isl),
  enc as (
    select count(*)::int pacientes,
      (percentile_cont(0.5) within group (order by consulta_ms::double precision))::bigint consulta_p50,
      (percentile_cont(0.25) within group (order by consulta_ms::double precision))::bigint consulta_p25,
      (percentile_cont(0.75) within group (order by consulta_ms::double precision))::bigint consulta_p75,
      (percentile_cont(0.5) within group (order by activo_ms::double precision))::bigint activo_p50,
      coalesce(sum(post_atencion_ms), 0)::bigint post, coalesce(sum(tramos - 1), 0)::int inter,
      min(primera_vez) primer_paciente, max(primera_vez) ultimo_paciente
    from encuentros where device_id = p_device and dia_operativo = p_dia),
  po as (
    select bucket_start, seq, encounter_key,
           lag(bucket_start) over w prev_start, lag(encounter_key) over w prev_enc
    from b where encounter_key is not null window w as (order by bucket_start, seq)),
  entre as (
    select percentile_cont(0.5) within group (order by gap) med from (
      select (extract(epoch from (bucket_start - prev_start)) * 1000 - 15000)::double precision gap from po
      where prev_enc is not null and prev_enc <> encounter_key) e where gap >= 0),
  extra as (
    select coalesce(sum(b.active_ms) filter (where b.bucket_start < enc.primer_paciente), 0)::bigint pre,
           coalesce(sum(b.active_ms) filter (where b.app = 'sap' and b.bucket_start > enc.ultimo_paciente), 0)::bigint cola
    from b, enc),
  vis as (
    select count(*)::int visitas, count(distinct surface)::int pantallas,
      coalesce(sum(sap_wait_ms), 0)::bigint wait, coalesce(sum(roundtrips), 0)::int rt,
      round(percentile_cont(0.5) within group (order by ready_ms) filter (where ready_ms is not null))::bigint p50,
      round(percentile_cont(0.95) within group (order by ready_ms) filter (where ready_ms is not null))::bigint p95,
      (select count(*)::int from (select row_number() over (partition by coalesce(encounter_key, ''), surface order by entered_at) rn
         from sap_visits where device_id = p_device and dia_operativo = p_dia) r where rn > 1) revis
    from sap_visits where device_id = p_device and dia_operativo = p_dia),
  cal as (
    select coalesce(sum(huecos_ms), 0)::bigint huecos, coalesce(sum(clock_jumps), 0)::int jumps, coalesce(sum(spool_dropped), 0)::int dropped,
      coalesce(bool_or(hooks_degradados), false) deg, coalesce(sum(hooks_rearmados), 0)::int rearm,
      coalesce(sum(ticks_sap_saltados_busy), 0)::int ticks,
      bool_or(sap_scripting) scripting, bool_or(sap_eventos_com) eventos_com, count(*)::int procesos, max(app_version) appv
    from jornadas where device_id = p_device and dia_operativo = p_dia),
  calc as (
    select greatest(0, coalesce(extract(epoch from (ventana.ua - ventana.pa)) * 1000, 0))::bigint ventana_ms,
           case when ventana.pa is null then null
                else round(least(100.0, cubierto.ms * 100.0 / greatest(1, extract(epoch from (ventana.ua - ventana.pa)) * 1000))::numeric, 1) end cobertura
    from ventana, cubierto)
  select
    p_device, p_dia, v_cons, phase_at(p_dia),
    ventana.pa, ventana.ua, ventana.pm, ventana.um, calc.ventana_ms,
    tot.fg, tot.act, tot.his, tot.mir, apps.j, users.j,
    tot.typ, tot.ks, tot.cl, tot.sc, tot.cs,
    tot.tabs, tot.enters, tot.corr, tot.cop, tot.peg, tot.gua,
    enc.pacientes, enc.consulta_p50, enc.activo_p50, entre.med::bigint, enc.post, enc.inter,
    case when tramos.ms > 0 then round((enc.pacientes * 3600000.0 / tramos.ms)::numeric, 2) end,
    vis.visitas, vis.pantallas, vis.revis, vis.wait, vis.rt, vis.p50, vis.p95,
    tot.bloq, tot.inact, gaps.ms, calc.cobertura,
    case when tot.act > 0 then round((tot.his * 100.0 / tot.act)::numeric, 1) end,
    tramos.n, tramos.ms, cal.procesos, coalesce(cal.appv, ''),
    extra.pre, extra.cola, enc.consulta_p25, enc.consulta_p75, detalle.j, horas.j,
    jsonb_build_object(
      'cobertura_pct', calc.cobertura, 'sin_datos_ms', gaps.ms, 'huecos_ms', cal.huecos, 'clock_jumps', cal.jumps,
      'spool_dropped', cal.dropped, 'hooks_degradados', cal.deg, 'hooks_rearmados', cal.rearm,
      'ticks_sap_saltados_busy', cal.ticks, 'sap_scripting', cal.scripting, 'sap_eventos_com', cal.eventos_com, 'procesos', cal.procesos),
    (cal.dropped = 0 and cal.jumps <= 2 and coalesce(calc.cobertura, 0) >= 80),
    array_remove(array[
      case when cal.dropped > 0 then 'spool_dropped' end,
      case when cal.jumps > 2 then 'clock_jumps' end,
      case when ventana.pa is not null and coalesce(calc.cobertura, 0) < 80 then 'cobertura' end,
      case when ventana.pa is null then 'sin_actividad' end], null::text),
    false, now(), 3
  from tot, ventana, cubierto, gaps, apps, detalle, horas, users, tramos, enc, entre, extra, vis, cal, calc
  on conflict (device_id, dia_operativo) do update set
    consultorio_id = excluded.consultorio_id, phase = excluded.phase,
    primera_actividad = excluded.primera_actividad, ultima_actividad = excluded.ultima_actividad,
    primera_muestra = excluded.primera_muestra, ultima_muestra = excluded.ultima_muestra, ventana_ms = excluded.ventana_ms,
    foreground_ms = excluded.foreground_ms, activo_ms = excluded.activo_ms, his_ms = excluded.his_ms, miracle_ms = excluded.miracle_ms,
    activo_por_app = excluded.activo_por_app, sap_users = excluded.sap_users,
    typing_ms = excluded.typing_ms, keystrokes = excluded.keystrokes, clicks = excluded.clicks,
    scroll_ticks = excluded.scroll_ticks, context_switches = excluded.context_switches,
    tabs = excluded.tabs, enters = excluded.enters, correcciones = excluded.correcciones,
    copias = excluded.copias, pegados = excluded.pegados, guardados = excluded.guardados,
    pacientes = excluded.pacientes, consulta_ms_mediana = excluded.consulta_ms_mediana,
    activo_por_paciente_mediana = excluded.activo_por_paciente_mediana, entre_consultas_ms_mediana = excluded.entre_consultas_ms_mediana,
    post_atencion_ms = excluded.post_atencion_ms, interrupciones = excluded.interrupciones, pacientes_por_hora = excluded.pacientes_por_hora,
    visitas = excluded.visitas, pantallas_distintas = excluded.pantallas_distintas, revisitas_sap = excluded.revisitas_sap,
    sap_wait_ms = excluded.sap_wait_ms, sap_roundtrips = excluded.sap_roundtrips, ready_ms_p50 = excluded.ready_ms_p50, ready_ms_p95 = excluded.ready_ms_p95,
    bloqueado_ms = excluded.bloqueado_ms, inactivo_ms = excluded.inactivo_ms, sin_datos_ms = excluded.sin_datos_ms,
    cobertura_pct = excluded.cobertura_pct, carga_admin_pct = excluded.carga_admin_pct,
    tramos = excluded.tramos, tramos_ms = excluded.tramos_ms, procesos = excluded.procesos, app_version = excluded.app_version,
    pre_atencion_ms = excluded.pre_atencion_ms, cola_post_jornada_ms = excluded.cola_post_jornada_ms,
    consulta_ms_p25 = excluded.consulta_ms_p25, consulta_ms_p75 = excluded.consulta_ms_p75, por_app = excluded.por_app, por_hora = excluded.por_hora,
    calidad = excluded.calidad, calidad_ok = excluded.calidad_ok, calidad_motivos = excluded.calidad_motivos,
    sucia = false, resumido_en = now(), algo_version = excluded.algo_version;
  return true;
end;
$$;

-- Resume las jornadas que lo necesitan: sucias, sin resumen, o las de hoy con más de 10
-- minutos desde el último resumen (para ver el día en curso). Devuelve cuántas.
create or replace function recompute_pending(p_max int default 500)
returns int language plpgsql as $$
declare v_n int := 0; r record;
begin
  for r in
    select x.device_id, x.dia_operativo from (
      select s.device_id, s.dia_operativo from jornada_summary s where s.sucia or s.resumido_en is null
      union
      select jo.device_id, jo.dia_operativo from jornadas jo
        left join jornada_summary s on s.device_id = jo.device_id and s.dia_operativo = jo.dia_operativo
        where s.device_id is null
      union
      select s.device_id, s.dia_operativo from jornada_summary s
        where s.dia_operativo = dia_operativo_de(now()) and s.resumido_en < now() - interval '10 minutes'
    ) x order by x.dia_operativo limit greatest(1, coalesce(p_max, 500))
  loop
    perform recompute_jornada(r.device_id, r.dia_operativo);
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
  update jornada_summary m set phase = phase_at(m.dia_operativo);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Asigna (o quita, con NULL) el consultorio de un PC y ESTAMPA lo que ese PC mandó sin
-- consultorio. Lo ya estampado con otro consultorio no se toca: reasignar no reescribe la
-- historia. Deja un evento para que la línea de tiempo lo muestre.
create or replace function asignar_consultorio(p_device uuid, p_consultorio uuid)
returns table (n_muestras int, n_eventos int, n_visitas int, n_jornadas int)
language plpgsql as $$
declare v_prev uuid; v_m int := 0; v_e int := 0; v_v int := 0; v_j int := 0; v_nombre text; v_existe boolean;
begin
  select true, d.consultorio_id into v_existe, v_prev from devices d where d.id = p_device;
  if v_existe is null then raise exception 'El dispositivo % no existe', p_device; end if;
  update devices d set consultorio_id = p_consultorio,
    consultorio_desde = case when p_consultorio is distinct from v_prev then now() else d.consultorio_desde end
    where d.id = p_device;
  if p_consultorio is not null then
    update samples s set consultorio_id = p_consultorio where s.device_id = p_device and s.consultorio_id is null;
    get diagnostics v_m = row_count;
    update events e set consultorio_id = p_consultorio where e.device_id = p_device and e.consultorio_id is null;
    get diagnostics v_e = row_count;
    update sap_visits v set consultorio_id = p_consultorio where v.device_id = p_device and v.consultorio_id is null;
    get diagnostics v_v = row_count;
    update jornadas jo set consultorio_id = p_consultorio where jo.device_id = p_device and jo.consultorio_id is null;
    get diagnostics v_j = row_count;
    update encuentros en set consultorio_id = p_consultorio where en.device_id = p_device and en.consultorio_id is null;
    update jornada_summary m set consultorio_id = p_consultorio, sucia = true where m.device_id = p_device and m.consultorio_id is null;
  end if;
  select c.nombre into v_nombre from consultorios c where c.id = p_consultorio;
  insert into events (event_uid, device_id, consultorio_id, dia_operativo, occurred_at, kind, detail)
  values ('srv:consultorio_asignado:' || gen_random_uuid()::text, p_device, p_consultorio, dia_operativo_de(now()), now(),
          'consultorio_asignado', jsonb_build_object('to', coalesce(v_nombre, 'ninguno')));
  return query select v_m, v_e, v_v, v_j;
end;
$$;
