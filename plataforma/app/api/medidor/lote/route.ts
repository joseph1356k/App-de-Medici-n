// POST /api/medidor/lote — el latido del .exe, cada minuto. Recibe {device_id, batch_id,
// client_now, shifts[], samples[], events[], sap_visits[]} y persiste con idempotencia
// (claves naturales + ON CONFLICT DO NOTHING → jamás 409). Una fila envenenada va en
// rejected[] (el .exe la saca de su spool) SIN tumbar el resto del lote. Un lote vacío
// es el heartbeat. Al final resume los turnos tocados, así el panel va a un minuto del
// terreno sin esperar a ningún cron.
import { sql } from "@/lib/db";
import { exigirClave, json } from "@/lib/api";
import {
  LIMITES, cap, construir, filaEvento, filaMuestra, filaTurno, filaVisita, toIso, uuidOrNull,
  type Crudo, type Rechazo,
} from "@/lib/ingesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const rechazo = exigirClave(req);
  if (rechazo) return rechazo;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const deviceId = uuidOrNull(body.device_id);
  if (!deviceId) return json({ error: "device_id inválido" }, 400);

  // El device manda la identidad y el estado. NUNCA se cree al payload.
  const [dev] = await sql<{ id: string; status: string; config_version: number; hmac_version: number }[]>`
    select id, status, config_version, hmac_version from devices where id = ${deviceId}`;
  if (!dev) return json({ error: "Dispositivo no encontrado. Vuelve a registrarte." }, 403);
  if (dev.status !== "active") return json({ error: "Dispositivo pausado o retirado.", status: dev.status }, 403);

  const rejected: Rechazo[] = [];
  const accepted = { shifts: 0, samples: 0, events: 0, sap_visits: 0 };
  const clientNow = toIso(body.client_now);
  const skewMs = clientNow ? Date.now() - Date.parse(clientNow) : null;
  const tocados = new Set<string>();

  // Turnos primero: muestras y visitas los referencian por FK.
  const turnosCrudos = cap<Crudo>(body.shifts, LIMITES.shifts);
  for (const [i, t] of construir("shifts", turnosCrudos, filaTurno, rejected).entries()) {
    try {
      await sql`select upsert_shift(${t.shift_id}::uuid, ${deviceId}::uuid, ${t.doctor_id}::uuid, ${t.doctor_display},
        ${t.sap_user_seen}, ${t.started_at}::timestamptz, ${t.ended_at}::timestamptz, ${t.end_reason}, ${t.dia_operativo}::date,
        ${t.hmac_version}, ${t.app_version}, ${t.huecos_ms}, ${t.clock_jumps}, ${t.spool_dropped},
        ${t.hooks_degradados}, ${t.ticks_sap_saltados_busy})`;
      accepted.shifts++;
      tocados.add(t.shift_id);
    } catch (err) {
      rejected.push({ col: "shifts", seq: Number(turnosCrudos[i]?.spool_seq ?? -1), reason: motivo(err) });
    }
  }

  const muestras = construir("samples", cap<Crudo>(body.samples, LIMITES.samples), (r) => filaMuestra(deviceId, r), rejected);
  accepted.samples = await insertar("samples", muestras, rejected, () =>
    sql`insert into samples ${sql(muestras, "device_id", "shift_id", "bucket_start", "bucket_ms", "seq", "app", "surface",
      "encounter_key", "foreground_ms", "active_ms", "typing_ms", "keystrokes", "clicks", "scroll_ticks", "context_switches",
      "sap_roundtrips", "sap_wait_ms", "tabs", "enters", "correcciones", "copias", "pegados", "guardados")} on conflict do nothing`);
  for (const m of muestras) tocados.add(m.shift_id);

  const eventos = construir("events", cap<Crudo>(body.events, LIMITES.events), (r) => filaEvento(deviceId, r), rejected);
  const eventosDb = eventos.map((e) => ({ ...e, detail: sql.json(e.detail as never) }));
  accepted.events = await insertar("events", eventos, rejected, () =>
    sql`insert into events ${sql(eventosDb, "event_uid", "device_id", "shift_id", "occurred_at", "encounter_key", "kind", "detail")} on conflict do nothing`);
  for (const e of eventos) if (e.shift_id) tocados.add(e.shift_id);

  const visitas = construir("sap_visits", cap<Crudo>(body.sap_visits, LIMITES.sap_visits), (r) => filaVisita(deviceId, r), rejected);
  accepted.sap_visits = await insertar("sap_visits", visitas, rejected, () =>
    sql`insert into sap_visits ${sql(visitas, "visit_uid", "device_id", "shift_id", "encounter_key", "sid", "tcode", "dynpro", "surface",
      "entered_at", "left_at", "dwell_ms", "ready_ms", "sap_wait_ms", "roundtrips", "exit_to")} on conflict do nothing`);
  for (const v of visitas) tocados.add(v.shift_id);

  // Heartbeat del dispositivo (best-effort: no tumba lo ya persistido).
  try {
    if (accepted.samples > 0) await sql`update devices set last_seen_at = now(), last_sample_at = now() where id = ${deviceId}`;
    else await sql`update devices set last_seen_at = now() where id = ${deviceId}`;
  } catch { /* nada */ }

  // Resumen de los turnos tocados: el panel se mantiene a un minuto del terreno.
  for (const shift of tocados) {
    try { await sql`select recompute_shift_summary(${shift}::uuid)`; } catch (err) { console.error("resumen", shift, motivo(err)); }
  }

  const [a] = await sql<{ config_version: number; hmac_version: number }[]>`select config_version, hmac_version from settings where id = 1`;
  return json({
    ok: true, accepted, rejected, clock_skew_ms: skewMs,
    config_version: a?.config_version ?? dev.config_version,
    hmac_version: a?.hmac_version ?? dev.hmac_version,
  });
}

// Inserta en bloque; si el bloque entero falla (p.ej. una FK a un turno que no llegó), lo
// reintenta fila a fila para que solo la culpable vaya a rejected[].
async function insertar<T extends { shift_id?: string | null }>(col: string, filas: T[], rejected: Rechazo[], bloque: () => Promise<unknown>): Promise<number> {
  if (filas.length === 0) return 0;
  try { await bloque(); return filas.length; }
  catch (err) {
    console.error(`lote ${col}: el bloque falló (${motivo(err)}); reintentando fila a fila`);
    let ok = 0;
    for (const f of filas) {
      try { await insertarUna(col, f as unknown as Record<string, unknown>); ok++; }
      catch (e2) { rejected.push({ col, seq: seqDe(f as unknown as Record<string, unknown>), reason: motivo(e2) }); }
    }
    return ok;
  }
}

async function insertarUna(col: string, f: Record<string, unknown>) {
  const fila = col === "events" ? { ...f, detail: sql.json(f.detail as never) } : f;
  const columnas = Object.keys(fila);
  if (col === "samples") await sql`insert into samples ${sql(fila as never, ...(columnas as never[]))} on conflict do nothing`;
  else if (col === "events") await sql`insert into events ${sql(fila as never, ...(columnas as never[]))} on conflict do nothing`;
  else if (col === "sap_visits") await sql`insert into sap_visits ${sql(fila as never, ...(columnas as never[]))} on conflict do nothing`;
}

function seqDe(f: Record<string, unknown>): number {
  const uid = `${f.event_uid ?? f.visit_uid ?? ""}`;
  const m = uid.match(/:(\d+)$/);
  if (m) return Number(m[1]);
  return -1;
}

function motivo(err: unknown): string {
  return `${(err as Error)?.message ?? err}`.slice(0, 160);
}
