// Formateo para el panel. Regla heredada: «no medido» se muestra como «—», JAMÁS como
// cero — un cero inventado miente.

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

export const ETIQUETA_CIERRE: Record<string, string> = {
  manual: "cerrado por el médico",
  timeout_inactividad: "4 h sin actividad",
  lock_prolongado: "PC bloqueado 2 h",
  turno_nuevo: "otro médico empezó",
  apagado: "el PC se apagó",
  desconocido: "desconocido",
};

export const ETIQUETA_APP: Record<string, string> = {
  sap: "SAP (HIS)", miracle_web: "Miracle", chrome: "Chrome", edge: "Edge", firefox: "Firefox",
  office: "Office", uexe: "Ü (asistente)", explorador: "Explorador", otro: "Otras apps",
};

/** El color sigue a la entidad, nunca al rango: cada app tiene su slot fijo. */
export const COLOR_APP: Record<string, string> = {
  sap: "var(--color-s1)", miracle_web: "var(--color-s2)", chrome: "var(--color-s3)", edge: "var(--color-s4)",
  office: "var(--color-s5)", firefox: "var(--color-s6)", uexe: "var(--color-s7)", explorador: "var(--color-s8)",
  otro: "var(--color-otro)",
};
export function colorApp(app: string): string { return COLOR_APP[app] ?? "var(--color-otro)"; }
export function etiquetaApp(app: string): string { return ETIQUETA_APP[app] ?? app; }

export const ETIQUETA_EVENTO: Record<string, string> = {
  shift_start: "turno abierto", shift_end: "turno cerrado", doctor_prompted: "médico asignado",
  encounter_enter: "paciente abierto", encounter_exit: "paciente cerrado", encounter_unknown: "paciente sin identificar",
  lock: "PC bloqueado", unlock: "PC desbloqueado", suspend: "PC suspendido", resume: "PC reanudado",
  medidor_start: "medidor arrancó", medidor_stop: "medidor se apagó", pausa_usuario: "pausa (médico)", reanudar_usuario: "reanudado (médico)",
  sap_attach: "SAP conectado", sap_detach: "SAP desconectado", sap_user_seen: "usuario SAP visto",
  clock_jump: "salto de reloj", spool_drop: "datos descartados (disco lleno)", hooks_degradados: "ganchos de teclado/ratón degradados",
  config_applied: "config aplicada", ops_run: "ejecución de Operations", calidad: "calidad",
};
