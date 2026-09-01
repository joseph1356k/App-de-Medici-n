-- Para instalar el medidor en un ESQUEMA APARTE («medicion») dentro de un proyecto Supabase que ya
-- existe (opción B de docs/INSTALAR.md). Pegar en el SQL Editor en este orden:
--   1. este encabezado (el rol y el esquema),
--   2. el contenido completo de schema.sql,
--   3. el bloque final de dueño y permisos.
-- Cambia UNA-CLAVE-LARGA por la clave que irá en DATABASE_URL.

-- 1 ─────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'medicion_app') then
    create role medicion_app with login password 'UNA-CLAVE-LARGA' nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
grant medicion_app to postgres;
create schema if not exists medicion authorization medicion_app;
grant usage, create on schema medicion to medicion_app;
grant usage on schema extensions to medicion_app;
alter role medicion_app set search_path = medicion, public, extensions;
set search_path to medicion, public, extensions;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- (aquí va schema.sql)

-- 3 ─────────────────────────────────────────────────────────────────────────
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'medicion' loop
    execute format('alter table medicion.%I owner to medicion_app', r.tablename);
  end loop;
  for r in select p.proname, pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'medicion' loop
    execute format('alter function medicion.%I(%s) owner to medicion_app', r.proname, r.args);
  end loop;
end $$;
grant all on all tables in schema medicion to medicion_app;
grant all on all sequences in schema medicion to medicion_app;
