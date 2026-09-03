-- BORRA EL ESQUEMA v1 (turnos por médico) para aplicar el v2 (jornadas por consultorio).
-- Se corre UNA vez, a mano, en el SQL Editor de Supabase, ANTES de schema.sql. Destruye los
-- datos v1: decisión del dueño (2026-09-02), porque no eran fiables (el medidor no grababa
-- bloqueado ni sin turno y la ingesta perdía filas).
--
-- Conserva settings (hospital, config del .exe, secreto HMAC), roster y study_phases: no
-- dependen del modelo de turnos. Los PCs se vuelven a registrar solos en su primer latido.
drop table if exists shift_summary cascade;
drop table if exists sap_visits cascade;
drop table if exists events cascade;
drop table if exists samples cascade;
drop table if exists shifts cascade;
drop table if exists devices cascade;
drop function if exists upsert_shift(uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, date, int, text, bigint, int, int, boolean, int);
drop function if exists recompute_shift_summary(uuid);
drop function if exists recompute_pending(int);
drop function if exists relabel_phases();
-- Ahora: schema.sql
