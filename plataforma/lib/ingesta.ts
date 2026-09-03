// La construcción de filas a partir de lo que manda el .exe (POST /api/medidor/lote).
// Funciones PURAS: no tocan la base, por eso se prueban con vitest sin Postgres.
//
// Reglas: una fila envenenada (surface con forma de título, encounter mal formado,
// kind desconocido, login SAP con espacios) lanza; el route handler la separa a
// `rechazadas[]` para que el .exe la saque de su spool, SIN tumbar el resto del lote.
// Las claves naturales dan idempotencia: reenviar un lote tras un timeout no duplica nada.
//
// Los NOMBRES DE COLECCIÓN son los del spool del .exe (muestras/eventos/visitas/jornadas),
// no los de las tablas. La v1 respondía con los de las tablas (samples/events/…) y el .exe
// no encontraba la fila envenenada en su spool: la confirmaba y la borraba igual. Un
// rechazo transitorio destruía datos. Aquí no puede volver a pasar: la colección es un
// tipo cerrado y viaja con el mismo nombre de ida y de vuelta.
import { KINDS, saneaDetalle, esEncounterKey, surfaceValida, RE_APP, RE_SAP_USER, APP_BLOQUEADO, type Detalle } from "./vocabulario";
import { diaOperativoDe, RE_FECHA } from "./fechas";

// El doble de lo que el .exe manda por lote (SpoolSqlite.LimitesDeLote = 1000/500/300/20):
// con un cliente que respeta sus topes nunca se llega aquí; lo que sobre NO se descarta,
// vuelve en `no_procesadas` con su spool_seq para que el .exe lo reenvíe.
export const LIMITES = { jornadas: 50, muestras: 2000, eventos: 1000, visitas: 600 } as const;
export type Coleccion = keyof typeof LIMITES;
export const COLECCIONES = Object.keys(LIMITES) as Coleccion[];
export const CUBETA_MS = 15_000;
/** Tope del ancho de UNA fila. El medidor funde en una sola fila los tramos en los que no pasa
 * nada (un PC bloqueado toda la noche son unas pocas filas, no miles), y esa fila declara en
 * `bucket_ms` el tramo entero. Recortarlo a 15 s —como se hacía— borraba horas de tiempo medido
 * en el momento de guardarlo. Seis horas es el techo del tramo más largo que el medidor puede
 * emitir con mucho margen; por encima es una fila corrupta, no un tramo. */
export const TRAMO_MAX_MS = 6 * 60 * 60 * 1000;

export class FilaInvalida extends Error {}

export type Crudo = Record<string, unknown>;
export type Rechazo = { coleccion: Coleccion; spool_seq: number | null; motivo: string };
export type NoProcesada = { coleccion: Coleccion; spool_seq: number | null };
export type Contexto = { deviceId: string; consultorioId: string | null };

export function str(v: unknown, fallback = ""): string {
  const out = `${v == null ? "" : v}`.trim();
  return out || fallback;
}
export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
/** Un contador: entero no negativo; cualquier otra cosa vale 0. */
export function cuenta(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
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
export function mustUuid(v: unknown, campo: string): string {
  const u = uuidOrNull(v);
  if (!u) throw new FilaInvalida(`${campo} inválido`);
  return u;
}
export function mustIso(v: unknown, campo: string): string {
  const iso = toIso(v);
  if (!iso) throw new FilaInvalida(`${campo} inválido`);
  return iso;
}

/** El número de fila del spool del .exe, o null si no vino. Nunca -1: un rechazo sin
 * spool_seq se reporta como null y el .exe sabe que no puede envenenar nada. */
export function spoolSeqDe(r: unknown): number | null {
  const v = (r as Crudo | null)?.spool_seq;
  const n = Number(v);
  return v != null && Number.isInteger(n) && n >= 0 ? n : null;
}
export function mustSpoolSeq(r: Crudo): number {
  const s = spoolSeqDe(r);
  if (s == null) throw new FilaInvalida("spool_seq ausente");
  return s;
}

// uid determinista por (device, colección, spool_seq): el mismo evento reenviado da el
// mismo uid → el índice único lo desecha. Sin fallback aleatorio: una fila sin spool_seq
// no es idempotente y se rechaza antes de llegar aquí.
export function uid(deviceId: string, coleccion: Coleccion, spoolSeq: number): string {
  return `${deviceId}:${coleccion}:${spoolSeq}`;
}

/** Parte un arreglo en lo que se procesa y lo que sobra (que vuelve en no_procesadas). */
export function tomar(arr: unknown, limite: number): { filas: Crudo[]; sobrantes: Crudo[] } {
  if (!Array.isArray(arr)) return { filas: [], sobrantes: [] };
  const objetos = arr.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Crudo) : {}));
  return { filas: objetos.slice(0, limite), sobrantes: objetos.slice(limite) };
}

/** El día operativo de una fila: el que dice el .exe si tiene forma de fecha; si no, se
 * calcula del instante (corte 06:00 Bogotá). El .exe lo manda siempre en v2; el cálculo
 * cubre a un .exe v1 durante el recambio. */
export function diaOperativo(r: Crudo, fallbackIso: string): string {
  const d = str(r.dia_operativo);
  return RE_FECHA.test(d) ? d : diaOperativoDe(fallbackIso);
}

/** El login de SAP visto (el del médico, no del paciente): en mayúscula, corto y sin
 * espacios. Un valor con espacios es un título o un nombre colado, y no entra. */
export function sapUser(v: unknown): string | null {
  const s = str(v).toUpperCase();
  if (!s) return null;
  if (!RE_SAP_USER.test(s)) throw new FilaInvalida("sap_user con forma inesperada");
  return s;
}

function huella(v: unknown): string | null {
  if (!esEncounterKey(v)) throw new FilaInvalida("encounter_key con forma inesperada");
  return v || null;
}

// ── Jornadas: una foto por (día operativo, proceso del .exe) ────────────────

export type FilaJornada = {
  spool_seq: number | null; device_id: string; consultorio_id: string | null; dia_operativo: string; proceso_id: string;
  primera_muestra_at: string | null; ultima_muestra_at: string | null; app_version: string; hmac_version: number;
  huecos_ms: number; clock_jumps: number; spool_dropped: number; hooks_degradados: boolean; hooks_rearmados: number;
  ticks_sap_saltados_busy: number; sap_scripting: boolean | null; sap_eventos_com: boolean | null; relanzos: number;
};

export function filaJornada(ctx: Contexto, r: Crudo): FilaJornada {
  // v1 mandaba turnos con shift_id: durante el recambio sirve como proceso (un turno = una
  // instancia de Calidad en el .exe viejo).
  const proceso = mustUuid(r.proceso_id ?? r.shift_id, "proceso_id");
  const primera = toIso(r.primera_muestra_at ?? r.started_at);
  const ultima = toIso(r.ultima_muestra_at ?? r.ended_at);
  return {
    spool_seq: spoolSeqDe(r), device_id: ctx.deviceId, consultorio_id: ctx.consultorioId,
    dia_operativo: diaOperativo(r, primera ?? new Date().toISOString()),
    proceso_id: proceso, primera_muestra_at: primera, ultima_muestra_at: ultima,
    app_version: str(r.app_version).slice(0, 40), hmac_version: num(r.hmac_version, 1),
    huecos_ms: cuenta(r.huecos_ms), clock_jumps: cuenta(r.clock_jumps), spool_dropped: cuenta(r.spool_dropped),
    hooks_degradados: !!r.hooks_degradados, hooks_rearmados: cuenta(r.hooks_rearmados),
    ticks_sap_saltados_busy: cuenta(r.ticks_sap_saltados_busy),
    sap_scripting: r.sap_scripting == null ? null : !!r.sap_scripting,
    sap_eventos_com: r.sap_eventos_com == null ? null : !!r.sap_eventos_com,
    relanzos: cuenta(r.relanzos),
  };
}

// ── Muestras: la cubeta de 15 s ─────────────────────────────────────────────

export type FilaMuestra = {
  spool_seq: number | null; device_id: string; consultorio_id: string | null; dia_operativo: string;
  bucket_start: string; bucket_ms: number; seq: number; app: string; surface: string | null; encounter_key: string | null; sap_user: string | null;
  foreground_ms: number; active_ms: number; typing_ms: number; keystrokes: number; clicks: number;
  scroll_ticks: number; context_switches: number; sap_roundtrips: number; sap_wait_ms: number;
  tabs: number; enters: number; correcciones: number; copias: number; pegados: number; guardados: number;
};

export function filaMuestra(ctx: Contexto, r: Crudo): FilaMuestra {
  const app = str(r.app, "otro").toLowerCase();
  if (!RE_APP.test(app)) throw new FilaInvalida("app con forma inesperada");
  const bloqueado = app === APP_BLOQUEADO;
  const surface = r.surface == null ? null : str(r.surface) || null;
  if (!surfaceValida(surface)) throw new FilaInvalida("surface con forma inesperada");
  const encounter = huella(r.encounter_key);
  const user = sapUser(r.sap_user);
  const bucketStart = mustIso(r.bucket_start, "bucket_start");
  return {
    spool_seq: spoolSeqDe(r), device_id: ctx.deviceId, consultorio_id: ctx.consultorioId,
    dia_operativo: diaOperativo(r, bucketStart),
    bucket_start: bucketStart,
    bucket_ms: Math.min(cuenta(r.bucket_ms), TRAMO_MAX_MS), seq: Math.min(cuenta(r.seq), 32767),
    app,
    // Un PC bloqueado no tiene pantalla, ni paciente, ni usuario: si el .exe los mandara,
    // aquí se limpian. Y activo 0: nadie está trabajando en una pantalla de bloqueo.
    surface: bloqueado ? null : surface, encounter_key: bloqueado ? null : encounter, sap_user: bloqueado ? null : user,
    foreground_ms: cuenta(r.foreground_ms), active_ms: bloqueado ? 0 : cuenta(r.active_ms),
    typing_ms: cuenta(r.typing_ms), keystrokes: cuenta(r.keystrokes),
    clicks: cuenta(r.clicks), scroll_ticks: cuenta(r.scroll_ticks),
    context_switches: cuenta(r.context_switches),
    sap_roundtrips: cuenta(r.sap_roundtrips), sap_wait_ms: cuenta(r.sap_wait_ms),
    tabs: cuenta(r.tabs), enters: cuenta(r.enters), correcciones: cuenta(r.correcciones),
    copias: cuenta(r.copias), pegados: cuenta(r.pegados), guardados: cuenta(r.guardados),
  };
}

// ── Visitas SAP ─────────────────────────────────────────────────────────────

export type FilaVisita = {
  spool_seq: number | null; visit_uid: string; device_id: string; consultorio_id: string | null; dia_operativo: string;
  encounter_key: string | null; sap_user: string | null;
  sid: string; tcode: string; dynpro: string; surface: string; entered_at: string; left_at: string | null;
  dwell_ms: number; ready_ms: number | null; sap_wait_ms: number; roundtrips: number; exit_to: string | null;
};

export function filaVisita(ctx: Contexto, r: Crudo): FilaVisita {
  const encounter = huella(r.encounter_key);
  const surface = str(r.surface);
  if (!surfaceValida(surface)) throw new FilaInvalida("surface con forma inesperada");
  const entered = mustIso(r.entered_at, "entered_at");
  return {
    spool_seq: spoolSeqDe(r), visit_uid: uid(ctx.deviceId, "visitas", mustSpoolSeq(r)),
    device_id: ctx.deviceId, consultorio_id: ctx.consultorioId, dia_operativo: diaOperativo(r, entered),
    encounter_key: encounter, sap_user: sapUser(r.sap_user),
    sid: str(r.sid).slice(0, 16), tcode: str(r.tcode).slice(0, 40), dynpro: str(r.dynpro).slice(0, 16), surface,
    entered_at: entered, left_at: toIso(r.left_at),
    dwell_ms: cuenta(r.dwell_ms), ready_ms: r.ready_ms == null ? null : cuenta(r.ready_ms),
    sap_wait_ms: cuenta(r.sap_wait_ms), roundtrips: cuenta(r.roundtrips),
    exit_to: r.exit_to ? str(r.exit_to).slice(0, 40) : null,
  };
}

// ── Eventos ─────────────────────────────────────────────────────────────────

export type FilaEvento = {
  spool_seq: number | null; event_uid: string; device_id: string; consultorio_id: string | null; dia_operativo: string;
  occurred_at: string; encounter_key: string | null; kind: string; detail: Detalle;
};

export function filaEvento(ctx: Contexto, r: Crudo): FilaEvento {
  const kind = str(r.kind);
  if (!KINDS.has(kind)) throw new FilaInvalida(`kind desconocido: ${kind.slice(0, 40)}`);
  const encounter = huella(r.encounter_key);
  const occurred = mustIso(r.occurred_at, "occurred_at");
  return {
    spool_seq: spoolSeqDe(r), event_uid: uid(ctx.deviceId, "eventos", mustSpoolSeq(r)),
    device_id: ctx.deviceId, consultorio_id: ctx.consultorioId, dia_operativo: diaOperativo(r, occurred),
    occurred_at: occurred, encounter_key: encounter, kind, detail: saneaDetalle(r.detail),
  };
}

/** Construye cada fila en su propio try: la que lance va a rechazadas[] (con su spool_seq,
 * que es lo que el .exe necesita para sacarla de su spool) y el resto sigue. */
export function construir<T>(coleccion: Coleccion, filas: Crudo[], f: (r: Crudo) => T, rechazadas: Rechazo[]): T[] {
  const out: T[] = [];
  for (const raw of filas) {
    try { out.push(f(raw)); }
    catch (err) { rechazadas.push({ coleccion, spool_seq: spoolSeqDe(raw), motivo: `${(err as Error)?.message ?? err}`.slice(0, 160) }); }
  }
  return out;
}
