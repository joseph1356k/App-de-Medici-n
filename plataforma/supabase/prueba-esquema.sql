-- Prueba del esquema v2: una jornada sintética (A→B→A, un hueco de 20 min, 10 min bloqueado,
-- dos procesos del .exe), asignación de consultorio con estampado, resumen y acelerador.
-- Corre dentro de una transacción que se deshace: no deja nada. CI la ejecuta tras aplicar
-- el esquema, y FALLA (raise exception) si un número no cuadra: los valores esperados están
-- calculados a mano en los comentarios; si el SQL y la aritmética no coinciden, la prueba
-- está haciendo su trabajo.
\set ON_ERROR_STOP on
begin;

insert into roster (id, display_name, sap_users, sort_order) values ('11111111-1111-1111-1111-111111111111', 'Dra. Prueba', '{MED01}', 1) on conflict do nothing;
insert into devices (id, machine_name) values ('22222222-2222-2222-2222-222222222222', 'PC-CONS-01') on conflict do nothing;

-- Helpers: el corte de las 06:00 y el médico anotado por login.
do $$ begin
  if dia_operativo_de(timestamptz '2026-09-02 05:59:00-05') <> date '2026-09-01' then raise exception 'dia_operativo_de: 05:59 debía ser el día anterior'; end if;
  if dia_operativo_de(timestamptz '2026-09-02 06:01:00-05') <> date '2026-09-02' then raise exception 'dia_operativo_de: 06:01 debía ser el mismo día'; end if;
  if medico_de('med01') <> '11111111-1111-1111-1111-111111111111'::uuid then raise exception 'medico_de no encontró a MED01 (case-insensitive)'; end if;
  if medico_de('NADIE') is not null then raise exception 'medico_de inventó un médico'; end if;
end $$;

-- Cubetas SIN consultorio (el PC aún no está asignado). t0 = 08:00 Bogotá del 2026-09-01.
--   g 0..299    : 300 cubetas, sap 9 de cada 10 (g%10=0 es chrome), pacientes A(0..119) B(120..239) A(240..299)
--   g 300..379  : NADA → hueco de 80 cubetas = 20 min = sin_datos y corte de tramo (>= 15 min)
--   g 380..439  : 60 cubetas más, paciente A
--   g 440..479  : 40 cubetas 'bloqueado' (10 min)
insert into samples (device_id, dia_operativo, bucket_start, bucket_ms, seq, app, surface, encounter_key, sap_user, foreground_ms, active_ms, typing_ms, keystrokes, clicks)
select '22222222-2222-2222-2222-222222222222', date '2026-09-01', timestamptz '2026-09-01 08:00:00-05' + g * interval '15 seconds', 15000, 0,
  case when g % 10 = 0 then 'chrome' else 'sap' end,
  case when g % 10 = 0 then null else 'sapgui://PRD/NV2000/SAPMNPA10/0100' end,
  case when g < 120 then repeat('a', 32) when g < 240 then repeat('b', 32) else repeat('a', 32) end,
  'MED01', 15000, 12000, 3000, 20, 3
from generate_series(0, 439) g where g < 300 or g >= 380;
-- Los 10 min bloqueados (cubetas 440..479) viajan FUNDIDOS en una sola fila, como los manda el
-- medidor: bucket_ms = 600 000. Si el resumen diera por hecho 15 s por fila, bloqueado_ms saldría
-- 15 000 en vez de 600 000 y esta prueba lo cazaría.
insert into samples (device_id, dia_operativo, bucket_start, bucket_ms, seq, app, foreground_ms, active_ms)
values ('22222222-2222-2222-2222-222222222222', date '2026-09-01', timestamptz '2026-09-01 08:00:00-05' + 440 * interval '15 seconds', 600000, 0, 'bloqueado', 600000, 0);
-- Un reenvío de la primera cubeta: la clave natural lo descarta.
insert into samples (device_id, dia_operativo, bucket_start, bucket_ms, seq, app, foreground_ms, active_ms)
values ('22222222-2222-2222-2222-222222222222', date '2026-09-01', timestamptz '2026-09-01 08:00:00-05', 15000, 0, 'sap', 15000, 12000)
on conflict do nothing;

insert into events (event_uid, device_id, dia_operativo, occurred_at, encounter_key, kind, detail) values
 ('dev:eventos:1', '22222222-2222-2222-2222-222222222222', date '2026-09-01', timestamptz '2026-09-01 08:00:00-05', repeat('a', 32), 'encounter_enter', '{"rule":"titulo-patnr"}'),
 ('dev:eventos:2', '22222222-2222-2222-2222-222222222222', date '2026-09-01', timestamptz '2026-09-01 08:30:00-05', repeat('b', 32), 'encounter_enter', '{}')
on conflict do nothing;
insert into sap_visits (visit_uid, device_id, dia_operativo, encounter_key, sap_user, sid, tcode, dynpro, surface, entered_at, left_at, dwell_ms, ready_ms, sap_wait_ms, roundtrips, exit_to) values
 ('dev:visitas:1', '22222222-2222-2222-2222-222222222222', date '2026-09-01', repeat('a', 32), 'MED01', 'PRD', 'NV2000', '0100', 'sapgui://PRD/NV2000/SAPMNPA10/0100',
   timestamptz '2026-09-01 08:00:00-05', timestamptz '2026-09-01 08:20:00-05', 1200000, 850, 4000, 12, 'NWP1'),
 ('dev:visitas:2', '22222222-2222-2222-2222-222222222222', date '2026-09-01', repeat('b', 32), 'MED01', 'PRD', 'NWP1', '0100', 'sapgui://PRD/NWP1/SAPLN_WP_FRAMEWORK/0100',
   timestamptz '2026-09-01 08:20:00-05', timestamptz '2026-09-01 09:00:00-05', 2400000, null, 9000, 30, null)
on conflict do nothing;

-- Dos procesos del .exe el mismo día: el primero manda su foto dos veces (los contadores solo
-- crecen), el segundo es un relanzo. El resumen SUMA entre procesos: clock_jumps = 1 + 1.
select upsert_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-01', '33333333-3333-3333-3333-333333333331', null,
  timestamptz '2026-09-01 08:00:00-05', timestamptz '2026-09-01 09:00:00-05', '2.0.0', 1, 500, 0, 0, false, 0, 3, true, false, 0);
select upsert_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-01', '33333333-3333-3333-3333-333333333331', null,
  timestamptz '2026-09-01 08:00:00-05', timestamptz '2026-09-01 10:00:00-05', '2.0.0', 1, 500, 1, 0, false, 1, 3, true, true, 0);
select upsert_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-01', '33333333-3333-3333-3333-333333333332', null,
  timestamptz '2026-09-01 10:00:00-05', timestamptz '2026-09-01 10:30:00-05', '2.0.0', 1, 0, 1, 0, false, 0, 0, true, true, 1);

do $$ declare j jornadas%rowtype; begin
  select * into j from jornadas where proceso_id = '33333333-3333-3333-3333-333333333331';
  if j.clock_jumps <> 1 or j.hooks_rearmados <> 1 or j.ultima_muestra_at <> timestamptz '2026-09-01 10:00:00-05' then raise exception 'upsert_jornada no se quedó con el mayor'; end if;
  if j.sap_eventos_com is not true then raise exception 'upsert_jornada: sap_eventos_com debía quedar true'; end if;
end $$;

-- Asignar el consultorio ESTAMPA lo que estaba sin consultorio y deja un evento.
do $$ declare r record; begin
  select * into r from asignar_consultorio('22222222-2222-2222-2222-222222222222', (select id from consultorios where nombre = 'Consultorio 1'));
  if r.n_muestras <> 361 then raise exception 'asignar_consultorio: muestras % (esperado 361)', r.n_muestras; end if;
  if r.n_eventos <> 2 or r.n_visitas <> 2 or r.n_jornadas <> 2 then raise exception 'asignar_consultorio: eventos/visitas/jornadas %/%/% (esperado 2/2/2)', r.n_eventos, r.n_visitas, r.n_jornadas; end if;
  if (select count(*) from samples where consultorio_id is null) <> 0 then raise exception 'quedaron muestras sin consultorio'; end if;
  if (select count(*) from events where kind = 'consultorio_asignado') <> 1 then raise exception 'falta el evento consultorio_asignado'; end if;
  if (select count(*) from samples) <> 361 then raise exception 'filas en samples: % (esperado 361: 360 cubetas + 1 tramo bloqueado fundido)', (select count(*) from samples); end if;
  if (select consultorio_desde from devices where id = '22222222-2222-2222-2222-222222222222') is null then raise exception 'consultorio_desde no se fijó'; end if;
end $$;

-- El resumen. Valores esperados, a mano:
--   activo_ms      360 cubetas activas × 12000 = 4 320 000
--   his_ms         324 cubetas sap (270 + 54) × 12000 = 3 888 000
--   bloqueado_ms   40 × 15000 = 600 000 · inactivo_ms 0
--   sin_datos_ms   hueco de 300 a 380: 80 × 15 s = 1 200 000
--   ventana_ms     de la cubeta 0 al fin de la 439: 440 × 15000 = 6 600 000
--   cobertura_pct  360 cubetas dentro de la ventana × 15000 / 6 600 000 = 81.8
--   tramos         2 (el hueco de 20 min corta) · tramos_ms 4 500 000 + 900 000 = 5 400 000
--   pacientes      2 · consulta A = 6 600 000, B = 1 800 000 → mediana 4 200 000
--   interrupciones 1 (A vuelve después de B) · post_atencion_ms: A después de abrir B = 120 × 12000 = 1 440 000
--   visitas 2 · pantallas 2 · ready_ms_p50 850 · sap_wait_ms 13000 · sap_roundtrips 42
--   procesos 2 · clock_jumps 2 → calidad_ok (dropped 0, jumps <= 2, cobertura >= 80)
do $$ declare ok boolean; j jornada_summary%rowtype; begin
  select recompute_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-01') into ok;
  if not ok then raise exception 'recompute_jornada devolvió false sin acelerador'; end if;
  select * into j from jornada_summary where device_id = '22222222-2222-2222-2222-222222222222' and dia_operativo = date '2026-09-01';
  if j.device_id is null then raise exception 'no hay resumen'; end if;
  if j.pacientes <> 2 then raise exception 'pacientes: % (esperado 2)', j.pacientes; end if;
  if j.activo_ms <> 4320000 then raise exception 'activo_ms: % (esperado 4320000)', j.activo_ms; end if;
  if j.his_ms <> 3888000 then raise exception 'his_ms: % (esperado 3888000)', j.his_ms; end if;
  if j.bloqueado_ms <> 600000 then raise exception 'bloqueado_ms: % (esperado 600000)', j.bloqueado_ms; end if;
  if j.inactivo_ms <> 0 then raise exception 'inactivo_ms: % (esperado 0)', j.inactivo_ms; end if;
  if j.sin_datos_ms <> 1200000 then raise exception 'sin_datos_ms: % (esperado 1200000)', j.sin_datos_ms; end if;
  if j.ventana_ms <> 6600000 then raise exception 'ventana_ms: % (esperado 6600000)', j.ventana_ms; end if;
  if j.cobertura_pct <> 81.8 then raise exception 'cobertura_pct: % (esperado 81.8)', j.cobertura_pct; end if;
  if j.tramos <> 2 or j.tramos_ms <> 5400000 then raise exception 'tramos: % / % (esperado 2 / 5400000)', j.tramos, j.tramos_ms; end if;
  if j.consulta_ms_mediana <> 4200000 then raise exception 'consulta_ms_mediana: % (esperado 4200000)', j.consulta_ms_mediana; end if;
  if j.activo_por_paciente_mediana <> 2160000 then raise exception 'activo_por_paciente_mediana: % (esperado 2160000)', j.activo_por_paciente_mediana; end if;
  if j.entre_consultas_ms_mediana <> 0 then raise exception 'entre_consultas_ms_mediana: % (esperado 0)', j.entre_consultas_ms_mediana; end if;
  if j.interrupciones <> 1 then raise exception 'interrupciones: % (esperado 1)', j.interrupciones; end if;
  if j.post_atencion_ms <> 1440000 then raise exception 'post_atencion_ms: % (esperado 1440000)', j.post_atencion_ms; end if;
  if j.pacientes_por_hora <> 1.33 then raise exception 'pacientes_por_hora: % (esperado 1.33)', j.pacientes_por_hora; end if;
  if j.visitas <> 2 or j.pantallas_distintas <> 2 or j.revisitas_sap <> 0 then raise exception 'visitas/pantallas/revisitas: %/%/%', j.visitas, j.pantallas_distintas, j.revisitas_sap; end if;
  if j.ready_ms_p50 <> 850 or j.sap_wait_ms <> 13000 or j.sap_roundtrips <> 42 then raise exception 'ready/wait/roundtrips: %/%/%', j.ready_ms_p50, j.sap_wait_ms, j.sap_roundtrips; end if;
  if j.procesos <> 2 then raise exception 'procesos: % (esperado 2)', j.procesos; end if;
  if (j.calidad->>'clock_jumps')::int <> 2 then raise exception 'calidad.clock_jumps: % (esperado 2)', j.calidad->>'clock_jumps'; end if;
  if (j.calidad->>'sap_scripting')::boolean is not true then raise exception 'calidad.sap_scripting debía ser true'; end if;
  if not j.calidad_ok then raise exception 'calidad_ok debía ser true; motivos: %', j.calidad_motivos; end if;
  if array_length(j.calidad_motivos, 1) is not null then raise exception 'calidad_motivos debía estar vacío: %', j.calidad_motivos; end if;
  if j.carga_admin_pct <> 90.0 then raise exception 'carga_admin_pct: % (esperado 90.0)', j.carga_admin_pct; end if;
  if (j.sap_users->>'MED01')::bigint <> 4320000 then raise exception 'sap_users.MED01: % (esperado 4320000)', j.sap_users->>'MED01'; end if;
  if (j.activo_por_app->>'sap')::bigint <> 3888000 then raise exception 'activo_por_app.sap: %', j.activo_por_app->>'sap'; end if;
  if j.consultorio_id <> (select id from consultorios where nombre = 'Consultorio 1') then raise exception 'el resumen no lleva el consultorio'; end if;
  if j.phase <> 'baseline' then raise exception 'phase: % (esperado baseline)', j.phase; end if;
  if j.primera_actividad <> timestamptz '2026-09-01 08:00:00-05' then raise exception 'primera_actividad: %', j.primera_actividad; end if;
  if j.ultima_actividad <> timestamptz '2026-09-01 08:00:00-05' + interval '6600 seconds' then raise exception 'ultima_actividad: %', j.ultima_actividad; end if;
  if j.sucia then raise exception 'el resumen recién hecho no puede estar sucio'; end if;
  if j.algo_version <> 2 then raise exception 'algo_version: % (esperado 2)', j.algo_version; end if;
  -- algo_version 2: arranque, cola, percentiles, por app y por hora
  if j.pre_atencion_ms <> 0 then raise exception 'pre_atencion_ms: % (esperado 0: el primer paciente abre en la cubeta 0)', j.pre_atencion_ms; end if;
  -- cola: sap activo después de abrir al último paciente (B, cubeta 120): 162 + 54 cubetas sap × 12000
  if j.cola_post_jornada_ms <> 2592000 then raise exception 'cola_post_jornada_ms: % (esperado 2592000)', j.cola_post_jornada_ms; end if;
  if j.consulta_ms_p25 <> 3000000 or j.consulta_ms_p75 <> 5400000 then raise exception 'consulta p25/p75: %/% (esperado 3000000/5400000)', j.consulta_ms_p25, j.consulta_ms_p75; end if;
  if (j.por_hora->>'08')::bigint <> 2880000 then raise exception 'por_hora.08: % (esperado 2880000)', j.por_hora->>'08'; end if;
  if (j.por_app->'sap'->>'typing_ms')::bigint <> 972000 then raise exception 'por_app.sap.typing_ms: % (esperado 972000)', j.por_app->'sap'->>'typing_ms'; end if;
  if (j.por_app->'chrome'->>'clicks')::bigint <> 108 then raise exception 'por_app.chrome.clicks: % (esperado 108)', j.por_app->'chrome'->>'clicks'; end if;

  -- El acelerador: resumido hace un instante → no recomputa, marca sucio, devuelve false.
  select recompute_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-01', interval '5 minutes') into ok;
  if ok then raise exception 'el acelerador no frenó'; end if;
  if not (select sucia from jornada_summary where device_id = '22222222-2222-2222-2222-222222222222' and dia_operativo = date '2026-09-01') then raise exception 'debía quedar sucia'; end if;
end $$;

-- Los encuentros: una fila por paciente, con lo que costó cada uno.
--   A: cubetas 0..119, 240..299, 380..439 → activo 240 × 12000 = 2 880 000; sap 216 × 12000 = 2 592 000;
--      consulta 6 600 000; 2 tramos; post-atención 120 × 12000 = 1 440 000; 1 visita; siguiente (A→B en 120) = 0
--   B: cubetas 120..239 → activo 1 440 000; sap 108 × 12000 = 1 296 000; consulta 1 800 000; 1 tramo; siguiente (B→A en 240) = 0
do $$ declare a encuentros%rowtype; b encuentros%rowtype; begin
  if (select count(*) from encuentros where device_id = '22222222-2222-2222-2222-222222222222' and dia_operativo = date '2026-09-01') <> 2 then raise exception 'encuentros: debía haber 2'; end if;
  select * into a from encuentros where device_id = '22222222-2222-2222-2222-222222222222' and dia_operativo = date '2026-09-01' and encounter_key = repeat('a', 32);
  select * into b from encuentros where device_id = '22222222-2222-2222-2222-222222222222' and dia_operativo = date '2026-09-01' and encounter_key = repeat('b', 32);
  if a.orden <> 1 or b.orden <> 2 then raise exception 'encuentros.orden: %/% (esperado 1/2)', a.orden, b.orden; end if;
  if a.activo_ms <> 2880000 or a.his_ms <> 2592000 or a.consulta_ms <> 6600000 then raise exception 'encuentro A: activo % his % consulta %', a.activo_ms, a.his_ms, a.consulta_ms; end if;
  if a.tramos <> 2 or a.post_atencion_ms <> 1440000 or a.visitas <> 1 or a.siguiente_ms <> 0 then raise exception 'encuentro A: tramos % post % visitas % siguiente %', a.tramos, a.post_atencion_ms, a.visitas, a.siguiente_ms; end if;
  if b.activo_ms <> 1440000 or b.his_ms <> 1296000 or b.consulta_ms <> 1800000 or b.tramos <> 1 or b.post_atencion_ms <> 0 or b.siguiente_ms <> 0 then
    raise exception 'encuentro B: activo % his % consulta % tramos % post % siguiente %', b.activo_ms, b.his_ms, b.consulta_ms, b.tramos, b.post_atencion_ms, b.siguiente_ms; end if;
  -- tecleo: las 240 cubetas de A traen 3000 ms (también las de chrome) → 720 000; teclas 240 × 20
  if a.sap_user <> 'MED01' or a.typing_ms <> 720000 or a.keystrokes <> 4800 then raise exception 'encuentro A: sap_user % typing % teclas %', a.sap_user, a.typing_ms, a.keystrokes; end if;
  if a.consultorio_id <> (select id from consultorios where nombre = 'Consultorio 1') then raise exception 'encuentro A sin consultorio'; end if;
  if a.ready_ms_p50 <> 850 or b.ready_ms_p50 is not null then raise exception 'encuentros: ready_ms_p50 %/%', a.ready_ms_p50, b.ready_ms_p50; end if;
end $$;

-- Caso negativo: un tercer proceso descartó filas del spool → la jornada deja de ser comparable.
select upsert_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-01', '33333333-3333-3333-3333-333333333333', null,
  timestamptz '2026-09-01 11:00:00-05', timestamptz '2026-09-01 11:05:00-05', '2.0.0', 1, 0, 0, 1, false, 0, 0, null, null, 0);
do $$ declare n int; j jornada_summary%rowtype; begin
  select recompute_pending(10) into n;
  if n < 1 then raise exception 'recompute_pending no resumió la jornada sucia'; end if;
  select * into j from jornada_summary where device_id = '22222222-2222-2222-2222-222222222222' and dia_operativo = date '2026-09-01';
  if j.calidad_ok then raise exception 'con spool_dropped > 0 la jornada no puede ser calidad_ok'; end if;
  if not ('spool_dropped' = any(j.calidad_motivos)) then raise exception 'calidad_motivos debía decir spool_dropped: %', j.calidad_motivos; end if;
  if j.procesos <> 3 then raise exception 'procesos: % (esperado 3)', j.procesos; end if;
  if (j.calidad->>'sap_scripting')::boolean is not true then raise exception 'un proceso sin dato de scripting no debe borrar el true de otro'; end if;
end $$;

-- Un día sin cubetas (solo la foto del .exe) también tiene resumen, sin actividad.
select upsert_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-02', '33333333-3333-3333-3333-333333333334', null,
  timestamptz '2026-09-02 07:00:00-05', timestamptz '2026-09-02 07:05:00-05', '2.0.0', 1, 0, 0, 0, false, 0, 0, null, null, 0);
do $$ declare j jornada_summary%rowtype; begin
  perform recompute_jornada('22222222-2222-2222-2222-222222222222', date '2026-09-02');
  select * into j from jornada_summary where device_id = '22222222-2222-2222-2222-222222222222' and dia_operativo = date '2026-09-02';
  if j.device_id is null then raise exception 'un día sin cubetas debía tener resumen'; end if;
  if j.calidad_ok or not ('sin_actividad' = any(j.calidad_motivos)) then raise exception 'un día sin cubetas no es comparable: %', j.calidad_motivos; end if;
  if j.activo_ms <> 0 or j.pacientes <> 0 then raise exception 'un día sin cubetas debía sumar cero'; end if;
end $$;

select 'prueba-esquema: todo en orden' as resultado;
rollback;
