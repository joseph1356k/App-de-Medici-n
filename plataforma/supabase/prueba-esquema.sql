-- Prueba del esquema: un turno sintético con A→B→A, cierre que no se pisa, resumen.
-- Corre dentro de una transacción que se deshace: no deja nada. CI la ejecuta tras aplicar el esquema.
\set ON_ERROR_STOP on
begin;
insert into roster (id, display_name, sap_users, sort_order) values ('11111111-1111-1111-1111-111111111111','Dra. Prueba','{MED01}',1) on conflict do nothing;
insert into devices (id, machine_name) values ('22222222-2222-2222-2222-222222222222','PC-URG-01') on conflict do nothing;
select upsert_shift('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222', null, '', null, now() - interval '2 hours', null, null, null, 1, '1.0.0', 0,0,0,false,0);
-- reasignar desde NULL (permitido)
select upsert_shift('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Dra. Prueba', 'MED01', now() - interval '2 hours', null, null, null, 1, '1.0.0', 0,0,0,false,0);
-- muestras: paciente A (30 min), luego B (30 min), luego A otra vez (15 min) = post-atención de A
insert into samples (device_id, shift_id, bucket_start, bucket_ms, seq, app, surface, encounter_key, foreground_ms, active_ms, typing_ms, keystrokes, clicks)
select '22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', now() - interval '2 hours' + (g * interval '15 seconds'), 15000, 0,
  case when g % 10 = 0 then 'chrome' else 'sap' end,
  case when g % 10 = 0 then null else 'sapgui://PRD/NV2000/SAPMNPA10/0100' end,
  case when g < 120 then repeat('a',32) when g < 240 then repeat('b',32) else repeat('a',32) end,
  15000, 12000, 3000, 20, 3
from generate_series(0, 299) g;
insert into events (event_uid, device_id, shift_id, occurred_at, encounter_key, kind, detail) values
 ('dev:eventos:1','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', now() - interval '2 hours', repeat('a',32), 'encounter_enter', '{"rule":"titulo-patnr"}'),
 ('dev:eventos:2','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', now() - interval '2 hours' + interval '30 minutes', repeat('b',32), 'encounter_enter', '{}')
on conflict do nothing;
insert into sap_visits (visit_uid, device_id, shift_id, encounter_key, sid, tcode, dynpro, surface, entered_at, left_at, dwell_ms, ready_ms, sap_wait_ms, roundtrips, exit_to) values
 ('dev:visitas:1','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', repeat('a',32), 'PRD','NV2000','0100','sapgui://PRD/NV2000/SAPMNPA10/0100', now() - interval '2 hours', now() - interval '100 minutes', 1200000, 850, 4000, 12, 'NWP1'),
 ('dev:visitas:2','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', repeat('b',32), 'PRD','NWP1','0100','sapgui://PRD/NWP1/SAPLN_WP_FRAMEWORK/0100', now() - interval '100 minutes', now() - interval '60 minutes', 2400000, null, 9000, 30, null)
on conflict do nothing;
-- cierre: el primer cierre manda, y un segundo intento con otra causa no lo pisa
select upsert_shift('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222', null, '', null, now() - interval '2 hours', now() - interval '45 minutes', 'manual', null, 1, '1.0.0', 500,0,0,false,3);
select upsert_shift('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222', null, '', null, now() - interval '2 hours', now(), 'apagado', null, 1, '1.0.0', 0,0,0,false,0);
select recompute_pending(10) as resumidos;
select m.shift_id, m.doctor_id is not null as con_medico, m.phase, s.end_reason, duracion_ms/60000 as dur_min, active_ms_total/60000 as activo_min, his_ms/60000 as his_min,
       encounters, encounter_active_ms_mediana/60000 as enc_med_min, post_atencion_ms/60000 as post_min, cola_post_turno_ms/60000 as cola_min,
       sap_wait_ms_total, ready_ms_p50, ready_ms_p95, pantallas_distintas, visitas, cobertura_pct, calidad_ok, active_ms_por_app
from shift_summary m join shifts s using (shift_id);
select end_reason, sap_user_seen, huecos_ms, ticks_sap_saltados_busy from shifts;
rollback;
