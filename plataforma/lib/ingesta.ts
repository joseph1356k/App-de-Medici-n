// La construcción de filas a partir de lo que manda el .exe (POST /api/medidor/lote).
// Funciones PURAS: no tocan la base, por eso se prueban con vitest sin Postgres.
//
// Reglas: una fila envenenada (surface con forma de título, encounter mal formado,
// kind desconocido) lanza; el route handler la separa a `rejected[]` para que el .exe
// la saque de su spool, SIN tumbar el resto del lote. Las claves naturales dan
// idempotencia: reenviar un lote tras un timeout no duplica nada.
import { KINDS, saneaDetalle, esEncounterKey, surfaceValida, type Detalle } from "./vocabulario";

export const LIMITES = { samples: 1000, events: 500, sap_visits: 300, shifts: 20 } as const;

export class FilaInvalida extends Error {}

export function str(v: unknown, fallback = ""): string {
  const out = `${v == null ? "" : v}`.trim();
  return out || fallback;
}
export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
export function toIso(v: unknown): string | null {
  if (!v) return null;
  const t = Date.parse(`${v}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function uuidOrNull(v: unknown): string | null {
  const s = str(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s.toLowerCase() : null;
}
function mustUuid(v: unknown, campo: string): string {
  const u = uuidOrNull(v);
  if (!u) throw new FilaInvalida(`${campo} inválido`);
  return u;
}
function mustIso(v: unknown, campo: string): string {
  const iso = toIso(v);
  if (!iso) throw new FilaInvalida(`${campo} inválido`);
  return iso;
}
export function cap<T>(arr: unknown, n: number): T[] {
  return Array.isArray(arr) ? (arr.slice(0, n) as T[]) : [];
}

// uid determinista por (device, colección, spool_seq): el mismo evento reenviado da el
// mismo uid → el índice único lo desecha. spool_seq es el número de fila del spool del
// .exe (no el `seq` de una muestra, que es el segmento dentro de la cubeta).
export function uid(deviceId: string, coleccion: string, seq: unknown): string {
  const s = Number.isFinite(Number(seq)) ? Number(seq) : `r${crypto.randomUUID()}`;
  return `${deviceId}:${coleccion}:${s}`;
}

export type Crudo = Record<string, unknown>;

export type FilaTurno = {
  shift_id: string; doctor_id: string | null; doctor_display: string; sap_user_seen: string | null;
  started_at: string; ended_at: string | null; end_reason: string | null; dia_operativo: string | null;
  hmac_version: number; app_version: string; huecos_ms: number; clock_jumps: number; spool_dropped: number;
  hooks_degradados: boolean; ticks_sap_saltados_busy: number;
};

const CAUSAS = new Set(["manual", "timeout_inactividad", "lock_prolongado", "turno_nuevo", "apagado", "desconocido"]);

export function filaTurno(r: Crudo): FilaTurno {
  const causa = r.end_reason ? str(r.end_reason) : null;
  return {
    shift_id: mustUuid(r.shift_id, "shift_id"),
    doctor_id: uuidOrNull(r.doctor_id),
    doctor_display: str(r.doctor_display).slice(0, 120),
    sap_user_seen: r.sap_user_seen ? str(r.sap_user_seen).slice(0, 40) : null,
    started_at: mustIso(r.started_at, "started_at"),
    ended_at: toIso(r.ended_at),
    end_reason: causa && CAUSAS.has(causa) ? causa : causa ? "desconocido" : null,
    dia_operativo: /^\d{4}-\d{2}-\d{2}$/.test(str(r.dia_operativo)) ? str(r.dia_operativo) : null,
    hmac_version: num(r.hmac_version, 1),
    app_version: str(r.app_version).slice(0, 40),
    huecos_ms: num(r.huecos_ms), clock_jumps: num(r.clock_jumps), spool_dropped: num(r.spool_dropped),
    hooks_degradados: !!r.hooks_degradados, ticks_sap_saltados_busy: num(r.ticks_sap_saltados_busy),
  };
}

export type FilaMuestra = {
  device_id: string; shift_id: string; bucket_start: string; bucket_ms: number; seq: number;
  app: string; surface: string | null; encounter_key: string | null;
  foreground_ms: number; active_ms: number; typing_ms: number; keystrokes: number; clicks: number;
  scroll_ticks: number; context_switches: number; sap_roundtrips: number; sap_wait_ms: number;
};

export function filaMuestra(deviceId: string, r: Crudo): FilaMuestra {
  const surface = r.surface == null ? null : str(r.surface) || null;
  if (!surfaceValida(surface)) throw new FilaInvalida("surface con forma inesperada");
  if (!esEncounterKey(r.encounter_key)) throw new FilaInvalida("encounter_key con forma inesperada");
  const app = str(r.app, "otro").toLowerCase();
  if (!/^[a-z0-9_]{1,32}$/.test(app)) throw new FilaInvalida("app con forma inesperada");
  return {
    device_id: deviceId,
    shift_id: mustUuid(r.shift_id, "shift_id"),
    bucket_start: mustIso(r.bucket_start, "bucket_start"),
    bucket_ms: num(r.bucket_ms), seq: num(r.seq),
    app, surface, encounter_key: r.encounter_key || null,
    foreground_ms: num(r.foreground_ms), active_ms: num(r.active_ms),
    typing_ms: num(r.typing_ms), keystrokes: num(r.keystrokes),
    clicks: num(r.clicks), scroll_ticks: num(r.scroll_ticks),
    context_switches: num(r.context_switches),
    sap_roundtrips: num(r.sap_roundtrips), sap_wait_ms: num(r.sap_wait_ms),
  };
}

export type FilaVisita = {
  visit_uid: string; device_id: string; shift_id: string; encounter_key: string | null;
  sid: string; tcode: string; dynpro: string; surface: string; entered_at: string; left_at: string | null;
  dwell_ms: number; ready_ms: number | null; sap_wait_ms: number; roundtrips: number; exit_to: string | null;
};

export function filaVisita(deviceId: string, r: Crudo): FilaVisita {
  if (!esEncounterKey(r.encounter_key)) throw new FilaInvalida("encounter_key con forma inesperada");
  const surface = str(r.surface);
  if (!surfaceValida(surface)) throw new FilaInvalida("surface con forma inesperada");
  return {
    visit_uid: uid(deviceId, "visitas", r.spool_seq),
    device_id: deviceId,
    shift_id: mustUuid(r.shift_id, "shift_id"),
    encounter_key: r.encounter_key || null,
    sid: str(r.sid).slice(0, 16), tcode: str(r.tcode).slice(0, 40), dynpro: str(r.dynpro).slice(0, 16), surface,
    entered_at: mustIso(r.entered_at, "entered_at"), left_at: toIso(r.left_at),
    dwell_ms: num(r.dwell_ms), ready_ms: r.ready_ms == null ? null : num(r.ready_ms),
    sap_wait_ms: num(r.sap_wait_ms), roundtrips: num(r.roundtrips),
    exit_to: r.exit_to ? str(r.exit_to).slice(0, 40) : null,
  };
}

export type FilaEvento = {
  event_uid: string; device_id: string; shift_id: string | null; occurred_at: string;
  encounter_key: string | null; kind: string; detail: Detalle;
};

export function filaEvento(deviceId: string, r: Crudo): FilaEvento {
  const kind = str(r.kind);
  if (!KINDS.has(kind)) throw new FilaInvalida(`kind desconocido: ${kind.slice(0, 40)}`);
  if (!esEncounterKey(r.encounter_key)) throw new FilaInvalida("encounter_key con forma inesperada");
  return {
    event_uid: uid(deviceId, "eventos", r.spool_seq),
    device_id: deviceId,
    shift_id: uuidOrNull(r.shift_id),
    occurred_at: mustIso(r.occurred_at, "occurred_at"),
    encounter_key: r.encounter_key || null,
    kind, detail: saneaDetalle(r.detail),
  };
}

export type Rechazo = { col: string; seq: number; reason: string };

/** Construye cada fila en su propio try: la que lance va a rejected[] (con su spool_seq,
 * que es lo que el .exe necesita para sacarla de su spool) y el resto sigue. */
export function construir<T>(col: string, filas: Crudo[], f: (r: Crudo) => T, rejected: Rechazo[]): T[] {
  const out: T[] = [];
  for (const raw of filas) {
    try { out.push(f(raw)); }
    catch (err) { rejected.push({ col, seq: num(raw?.spool_seq, -1), reason: `${(err as Error)?.message ?? err}`.slice(0, 160) }); }
  }
  return out;
}
