// Formateo para el panel. Regla heredada: «no medido» se muestra como «—», JAMÁS como
// cero — un cero inventado miente.
import type { Estado } from "./segmentos";

const TZ = "America/Bogota";

export function fmtMin(ms: number | string | null | undefined): string {
  if (ms == null || ms === "") return "—";
  const min = Number(ms) / 60000;
  if (!Number.isFinite(min)) return "—";
  if (min >= 60) {
    const h = Math.floor(min / 60), m = Math.round(min - h * 60);
    return `${h} h ${String(m).padStart(2, "0")} min`;
  }
  return `${min.toLocaleString("es-CO", { maximumFractionDigits: 1 })} min`;
}

/** Horas con un decimal («6,2 h»), para celdas donde «6 h 12 min» no cabe. */
export function fmtHoras(ms: number | string | null | undefined): string {
  if (ms == null || ms === "") return "—";
  const h = Number(ms) / 3600000;
  if (!Number.isFinite(h)) return "—";
  return `${h.toLocaleString("es-CO", { maximumFractionDigits: 1 })} h`;
}

export function fmtSeg(ms: number | string | null | undefined): string {
  if (ms == null || ms === "") return "—";
  const s = Number(ms) / 1000;
  if (!Number.isFinite(s)) return "—";
  return `${s.toLocaleString("es-CO", { maximumFractionDigits: 1 })} s`;
}

export function fmtNum(v: number | string | null | undefined, decimales = 0): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-CO", { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
}

export function fmtPct(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %` : "—";
}

export function fmtHora(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function fmtFechaHora(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function fmtFecha(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00Z") : new Date(iso);
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" }).format(d);
}

/** «03 sept», para el eje de un gráfico: sin día de la semana y sin año. */
export function fmtDiaCorto(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00Z") : new Date(iso);
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "short" }).format(d);
}

export function fmtRelativo(iso: string | Date | null | undefined): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** Reducción entre dos valores, en %. Positivo = bajó (bueno para tiempo/clics). */
export function reduccion(antes: number | null | undefined, despues: number | null | undefined): { texto: string; signo: 1 | -1 | 0 } {
  if (antes == null || despues == null || antes === 0) return { texto: "—", signo: 0 };
  const pct = ((antes - despues) / antes) * 100;
  if (Math.abs(pct) < 0.5) return { texto: "0 %", signo: 0 };
  return { texto: `${pct > 0 ? "−" : "+"}${Math.abs(pct).toFixed(0)} %`, signo: pct > 0 ? 1 : -1 };
}

export const ETIQUETA_FASE: Record<string, string> = {
  baseline: "Sin Miracle (baseline)",
  notes: "Miracle Notes",
  notes_ops: "Notes + Operations",
};
export const FASES = ["baseline", "notes", "notes_ops"] as const;

// Los cuatro estados de una cubeta, más «sin PC» para un consultorio sin dispositivo. Los
// colores son tokens de globals.css ordenados por luminancia: se distinguen en escala de
// grises y con deuteranopía, que es lo que importa en una impresora del hospital.
export const ETIQUETA_ESTADO: Record<Estado | "sin_pc", string> = {
  activo: "Activo", inactivo: "Inactivo", bloqueado: "Bloqueado", sin_datos: "Sin datos", sin_pc: "Sin PC",
};
export const COLOR_ESTADO: Record<Estado | "sin_pc", string> = {
  activo: "var(--color-estado-activo)", inactivo: "var(--color-estado-inactivo)",
  bloqueado: "var(--color-estado-bloqueado)", sin_datos: "var(--color-estado-sin-datos)", sin_pc: "var(--color-estado-sin-datos)",
};

// Las apps del catálogo (`apps_por_proceso` en Configuración), en palabras. Una clave que no
// esté aquí es un proceso que el medidor vio y el catálogo no conoce: viaja con el nombre de su
// .exe y se muestra tal cual, capitalizado. Eso es lo que sustituyó al saco de «Otras apps»:
// antes todo lo desconocido caía en un gris sin nombre y no había forma de saber qué era.
export const ETIQUETA_APP: Record<string, string> = {
  sap: "SAP (HIS)", miracle_web: "Miracle", bloqueado: "Bloqueado", otro: "Sin identificar",
  chrome: "Chrome", edge: "Edge", firefox: "Firefox", brave: "Brave", opera: "Opera",
  ie: "Internet Explorer", webview: "Web incrustada",
  office: "Office", outlook: "Correo (Outlook)", teams: "Teams", whatsapp: "WhatsApp",
  zoom: "Zoom", slack: "Slack", skype: "Skype", pdf: "PDF",
  explorador: "Explorador de archivos", escritorio: "Escritorio de Windows", notas: "Accesorios",
  remoto: "Escritorio remoto", java: "Aplicación Java", medios: "Fotos y vídeo", archivos: "Comprimidos",
  uexe: "Ü (asistente)",
};

/** El color sigue a la entidad, nunca al rango: cada app conocida tiene su slot fijo. */
export const COLOR_APP: Record<string, string> = {
  sap: "var(--color-s1)", miracle_web: "var(--color-s2)", bloqueado: "var(--color-estado-bloqueado)",
  otro: "var(--color-otro)",
  chrome: "var(--color-s3)", edge: "var(--color-s4)", firefox: "var(--color-s6)",
  office: "var(--color-s5)", outlook: "var(--color-s7)", teams: "var(--color-s11)",
  explorador: "var(--color-s8)", escritorio: "var(--color-otro)", pdf: "var(--color-s10)",
  whatsapp: "var(--color-s9)", remoto: "var(--color-s12)", uexe: "var(--color-s7)",
};
// Una app que llegue por config y no esté arriba recibe un slot estable por hash, nunca el
// s1 (SAP) ni el s2 (Miracle): esos dos colores significan algo en todo el panel.
const PALETA_LIBRE = ["var(--color-s3)", "var(--color-s4)", "var(--color-s5)", "var(--color-s6)",
  "var(--color-s7)", "var(--color-s8)", "var(--color-s9)", "var(--color-s10)", "var(--color-s11)", "var(--color-s12)"];
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
export function colorApp(app: string): string { return COLOR_APP[app] ?? PALETA_LIBRE[fnv1a(app) % PALETA_LIBRE.length]; }
/** «acrord32» → «Acrord32». Un proceso desconocido se enseña con su propio nombre: es un dato,
 * no un fallo, y es lo que hace falta para meterlo en el catálogo desde Configuración. */
export function etiquetaApp(app: string): string {
  if (ETIQUETA_APP[app]) return ETIQUETA_APP[app];
  return app.charAt(0).toUpperCase() + app.slice(1);
}

// Los kinds de lib/vocabulario.ts, en palabras. Si se añade un kind allí, se añade aquí.
export const ETIQUETA_EVENTO: Record<string, string> = {
  jornada_inicio: "jornada iniciada", jornada_fin: "jornada cerrada",
  encounter_enter: "paciente abierto", encounter_exit: "paciente cerrado", encounter_unknown: "paciente sin identificar",
  lock: "PC bloqueado", unlock: "PC desbloqueado", suspend: "PC suspendido", resume: "PC reanudado",
  medidor_start: "medidor arrancó", medidor_stop: "medidor se apagó",
  sap_attach: "SAP conectado", sap_detach: "SAP desconectado", sap_user_seen: "usuario SAP visto",
  sap_scripting_no_disponible: "SAP GUI Scripting no disponible",
  clock_jump: "salto de reloj", spool_drop: "datos descartados (disco lleno)", spool_reset: "cola local recreada",
  hooks_degradados: "ganchos de teclado/ratón degradados", hooks_rearmados: "ganchos rearmados",
  config_applied: "config aplicada", consultorio_asignado: "consultorio asignado",
  ops_run: "ejecución de Operations", calidad: "calidad",
};

/** Un glifo por kind para el carril de eventos. `relanzo` no es un kind: es un
 * `medidor_start` con `reason: relanzado|vigilante`, y se le da su propio símbolo. */
export const GLIFO_EVENTO: Record<string, string> = {
  lock: "▮", unlock: "▯", suspend: "▼", resume: "▲",
  medidor_start: "●", medidor_stop: "○", relanzo: "◆",
  hooks_rearmados: "✚", hooks_degradados: "✗",
  sap_attach: "S", sap_detach: "s", sap_user_seen: "u", sap_scripting_no_disponible: "∅",
  config_applied: "⚙", spool_reset: "↺", spool_drop: "✕", clock_jump: "↯",
  jornada_inicio: "⊢", jornada_fin: "⊣", consultorio_asignado: "⌂",
  encounter_unknown: "?", ops_run: "⚡", calidad: "·",
};
export function glifoEvento(kind: string, detail?: Record<string, unknown> | null): string {
  if (kind === "medidor_start" && detail && detail.reason && detail.reason !== "arranque") return GLIFO_EVENTO.relanzo;
  return GLIFO_EVENTO[kind] ?? "·";
}
