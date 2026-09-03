-- SEMILLA DE DESARROLLO: tres consultorios con PC asignado, tres días de cubetas realistas
-- (bloqueo al mediodía, una suspensión en el consultorio 2, 20 pacientes por día), un PC
-- sin consultorio, eventos, visitas y fotos de jornada. Para mirar el panel con `npm run dev`
-- contra una base local. NO en producción: hace COMMIT.
--
--   psql "$DATABASE_URL" -f supabase/schema.sql
--   psql "$DATABASE_URL" -f supabase/semilla-dev.sql
\set ON_ERROR_STOP on
begin;

insert into roster (display_name, sap_users, sort_order) values
  ('Dra. Prueba Uno', '{MED01}', 1), ('Dr. Prueba Dos', '{MED02}', 2), ('Dra. Prueba Tres', '{MED03}', 3)
on conflict (display_name) do nothing;

insert into devices (id, machine_name, os_version, app_version, last_seen_at, last_sample_at) values
  ('00000000-0000-0000-0000-000000000001', 'PC-CONS-01', 'Windows 11', '2.0.0', now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'PC-CONS-02', 'Windows 11', '2.0.0', now(), now()),
  ('00000000-0000-0000-0000-000000000003', 'PC-CONS-03', 'Windows 10', '2.0.0', now() - interval '25 minutes', now() - interval '25 minutes'),
  ('00000000-0000-0000-0000-000000000004', 'PC-SIN-ASIGNAR', 'Windows 11', '2.0.0', now(), null)
on conflict (id) do nothing;

update devices set consultorio_id = (select id from consultorios where nombre = 'Consultorio 1'), consultorio_desde = now() - interval '3 days' where id = '00000000-0000-0000-0000-000000000001';
update devices set consultorio_id = (select id from consultorios where nombre = 'Consultorio 2'), consultorio_desde = now() - interval '3 days' where id = '00000000-0000-0000-0000-000000000002';
update devices set consultorio_id = (select id from consultorios where nombre = 'Consultorio 3'), consultorio_desde = now() - interval '3 days' where id = '00000000-0000-0000-0000-000000000003';

do $$
declare
  i int; k int; dia date; base timestamptz; dev uuid; cons uuid; hasta int; p int;
begin
  for i in 1..3 loop
    dev := ('00000000-0000-0000-0000-00000000000' || i)::uuid;
    select consultorio_id into cons from devices where id = dev;
    for k in 0..2 loop
      dia := dia_operativo_de(now()) - k;
      base := (dia::timestamp + time '07:00') at time zone 'America/Bogota';
      -- Hoy (k = 0) la jornada va hasta «ahora»; los días anteriores hasta las 15:00.
      hasta := case when k = 0 then least(1919, greatest(0, floor(extract(epoch from (now() - base)) / 15)::int - 1)) else 1919 end;
      if hasta < 0 then continue; end if;

      insert into samples (device_id, consultorio_id, dia_operativo, bucket_start, bucket_ms, seq, app, surface, encounter_key, sap_user,
                           foreground_ms, active_ms, typing_ms, keystrokes, clicks, sap_roundtrips, sap_wait_ms, context_switches)
      select dev, cons, dia, base + g * interval '15 seconds', 15000, 0,
        case when g between 1200 and 1359 then 'bloqueado'
             when g % 12 = 0 then 'chrome' when g % 12 = 9 then 'office' when g % 12 = 10 then 'otro' else 'sap' end,
        case when g between 1200 and 1359 then null
             when g % 12 in (0, 9, 10) then null
             when g % 12 = 5 then 'sapgui://PRD/NWP1/SAPLN_WP_FRAMEWORK/0100' else 'sapgui://PRD/NV2000/SAPMNPA10/0100' end,
        case when g between 1200 and 1359 or g % 12 = 10 then null else md5('p' || i || '-' || k || '-' || (g / 96)) end,
        case when g between 1200 and 1359 then null else 'MED0' || i end,
        15000,
        case when g between 1200 and 1359 or g % 12 = 10 then 0 else 12000 end,
        case when g % 12 in (1, 2, 3, 4, 6, 7, 8, 11) then 3000 else 0 end,
        case when g between 1200 and 1359 or g % 12 = 10 then 0 else 20 end,
        case when g between 1200 and 1359 or g % 12 = 10 then 0 else 3 end,
        case when g % 12 in (1, 2, 3, 4, 5, 6, 7, 8, 11) then 1 else 0 end,
        case when g % 12 in (1, 2, 3, 4, 5, 6, 7, 8, 11) then 200 else 0 end,
        case when g % 12 in (0, 1, 5, 6, 9, 10, 11) then 1 else 0 end
      from generate_series(0, hasta) g
      -- El consultorio 2 se suspende de 13:00 a 13:20: sin cubetas.
      where not (i = 2 and g between 1440 and 1519)
      on conflict do nothing;

      insert into events (event_uid, device_id, consultorio_id, dia_operativo, occurred_at, kind, detail) values
        ('semilla:' || i || ':' || k || ':start', dev, cons, dia, base, 'medidor_start', '{"version":"2.0.0","reason":"arranque"}'),
        ('semilla:' || i || ':' || k || ':jornada', dev, cons, dia, base, 'jornada_inicio', '{}'),
        ('semilla:' || i || ':' || k || ':lock', dev, cons, dia, base + interval '5 hours', 'lock', '{}'),
        ('semilla:' || i || ':' || k || ':unlock', dev, cons, dia, base + interval '5 hours 40 minutes', 'unlock', '{}')
      on conflict do nothing;
      if i = 2 then
        insert into events (event_uid, device_id, consultorio_id, dia_operativo, occurred_at, kind, detail) values
          ('semilla:' || i || ':' || k || ':suspend', dev, cons, dia, base + interval '6 hours', 'suspend', '{}'),
          ('semilla:' || i || ':' || k || ':resume', dev, cons, dia, base + interval '6 hours 20 minutes', 'resume', '{}')
        on conflict do nothing;
      end if;
      if k = 1 and i = 3 then
        insert into events (event_uid, device_id, consultorio_id, dia_operativo, occurred_at, kind, detail) values
          ('semilla:' || i || ':' || k || ':relanzo', dev, cons, dia, base + interval '2 hours', 'medidor_start', '{"version":"2.0.0","reason":"relanzado"}'),
          ('semilla:' || i || ':' || k || ':rearme', dev, cons, dia, base + interval '3 hours', 'hooks_rearmados', '{"count":1}')
        on conflict do nothing;
      end if;

      -- Una visita SAP por paciente (20 min), el time-to-ready nulo en una de cada cinco.
      for p in 0..least(19, hasta / 96) loop
        insert into sap_visits (visit_uid, device_id, consultorio_id, dia_operativo, encounter_key, sap_user, sid, tcode, dynpro, surface,
                                entered_at, left_at, dwell_ms, ready_ms, sap_wait_ms, roundtrips, exit_to)
        values ('semilla:' || i || ':' || k || ':v' || p, dev, cons, dia, md5('p' || i || '-' || k || '-' || p), 'MED0' || i, 'PRD', 'NV2000', '0100',
                'sapgui://PRD/NV2000/SAPMNPA10/0100', base + (p * 96) * interval '15 seconds', base + (p * 96 + 80) * interval '15 seconds',
                1200000, case when p % 5 = 4 then null else 700 + p * 20 end, 4000 + p * 100, 12, case when p % 2 = 0 then 'NWP1' else null end)
        on conflict do nothing;
      end loop;

      perform upsert_jornada(dev, dia, gen_random_uuid(), cons, base, base + hasta * interval '15 seconds', '2.0.0', 1,
                             case when i = 2 then 1200000 else 0 end, 0, 0, false, case when k = 1 and i = 3 then 1 else 0 end, 4, true, true,
                             case when k = 1 and i = 3 then 1 else 0 end);
    end loop;
  end loop;
end $$;

select recompute_pending(100) as resumidas;
commit;
