// EL VOCABULARIO: la lista blanca de tipos de evento y de claves de `detail`. Es el
// espejo servidor de medidor/Dominio/Cable.cs — la segunda valla de privacidad. La
// primera vive en el .exe, pero una valla que solo existe en un lado degrada en
// silencio: el contenido clínico no puede entrar a `events` aunque un cliente con un
// bug lo mande, porque aquí se sanea otra vez.
//
// Si hace falta un kind o una clave nueva, se añade en LOS TRES lados a la vez: aquí, en
// el CHECK de `events.kind` de supabase/schema.sql (tests/vocabulario.test.ts vigila que
// coincidan) y en el .exe.

export const KINDS = new Set([
  "jornada_inicio", "jornada_fin",
  "encounter_enter", "encounter_exit", "encounter_unknown",
  "lock", "unlock", "suspend", "resume",
  "medidor_start", "medidor_stop",
  "sap_attach", "sap_detach", "sap_user_seen", "sap_scripting_no_disponible",
  "clock_jump", "spool_drop", "spool_reset", "hooks_degradados", "hooks_rearmados",
  "config_applied", "consultorio_asignado",
  "ops_run", "calidad",
]);

export const CLAVES_DETALLE = new Set([
  "from", "to", "ms", "reason", "count", "user", "run_id", "workflow_id",
  "steps", "rule", "version", "total_ms", "align_ms", "outcome",
]);

const TOPE_TEXTO = 120;

// Superficies que el medidor puede reportar. Cualquier otra forma se rechaza: una
// superficie con forma inesperada podría llevar un título colado.
const RE_SURFACE = /^(sapgui:\/\/[^/\s]+\/[^/\s]*\/[^/\s]*\/[^/\s]*(\/[A-Za-z0-9_:.-]+)?|web:\/\/[a-z0-9.-]+|uia:\/\/[a-z0-9._-]+)$/i;

export type Detalle = Record<string, string | number | boolean | null>;

export function saneaDetalle(detail: unknown): Detalle {
  const limpio: Detalle = {};
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return limpio;
  for (const [clave, v] of Object.entries(detail as Record<string, unknown>)) {
    if (!CLAVES_DETALLE.has(clave)) continue;
    if (typeof v === "string") limpio[clave] = v.length <= TOPE_TEXTO ? v : v.slice(0, TOPE_TEXTO);
    else if (v === null || typeof v === "number" || typeof v === "boolean") limpio[clave] = v;
    // objetos/arrays anidados NO entran: un detail no es un contenedor libre
  }
  return limpio;
}

// Una huella de paciente es hex de 32 (16 bytes) o null. Cualquier otra cosa se
// rechaza: si llegara un valor con otra forma, no es una huella nuestra.
export function esEncounterKey(v: unknown): v is string | null | undefined {
  return v == null || (typeof v === "string" && /^[0-9a-f]{32}$/.test(v));
}

export function surfaceValida(v: unknown): boolean {
  return v == null || v === "" || (typeof v === "string" && RE_SURFACE.test(v));
}

// Las apps que puede reportar una cubeta. `bloqueado` es la única «app» que no es un
// proceso: la emite el medidor mientras la sesión de Windows está bloqueada, para que la
// línea de tiempo no confunda «nadie en el PC» con «el medidor murió».
export const RE_APP = /^[a-z0-9_]{1,32}$/;
export const APP_BLOQUEADO = "bloqueado";

// Un login de SAP es corto y sin espacios. Un valor con espacios o largo no es un login:
// sería un título o un nombre colado, y no entra.
export const RE_SAP_USER = /^[A-Z0-9_.@-]{1,40}$/;
