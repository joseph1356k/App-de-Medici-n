// Los filtros del panel, leídos de la URL: una sola fila arriba de todo, y todo lo de
// abajo se calcula contra la misma rebanada (así los números siempre concuerdan).
export type Filtros = {
  rango: string; desde: string; hasta: string;
  fase: string | null; medico: string | null; dispositivo: string | null; incluirMala: boolean;
};

const TZ = "America/Bogota";

export function hoyBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function restar(fecha: string, dias: number): string {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export const RANGOS: { id: string; etiqueta: string; dias: number | null }[] = [
  { id: "hoy", etiqueta: "Hoy", dias: 0 },
  { id: "7d", etiqueta: "7 días", dias: 6 },
  { id: "30d", etiqueta: "30 días", dias: 29 },
  { id: "90d", etiqueta: "90 días", dias: 89 },
  { id: "todo", etiqueta: "Todo", dias: null },
];

export type Sp = Record<string, string | string[] | undefined>;

function uno(sp: Sp, k: string): string | null {
  const v = sp[k];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s !== "todos" && s !== "todas" ? s : null;
}

export function leerFiltros(sp: Sp): Filtros {
  const hoy = hoyBogota();
  const desdeCustom = uno(sp, "desde"), hastaCustom = uno(sp, "hasta");
  let rango = uno(sp, "rango") ?? (desdeCustom || hastaCustom ? "custom" : "30d");
  let desde: string, hasta: string;
  if (rango === "custom") {
    hasta = hastaCustom && /^\d{4}-\d{2}-\d{2}$/.test(hastaCustom) ? hastaCustom : hoy;
    desde = desdeCustom && /^\d{4}-\d{2}-\d{2}$/.test(desdeCustom) ? desdeCustom : restar(hasta, 29);
  } else {
    const r = RANGOS.find((x) => x.id === rango) ?? RANGOS[2];
    rango = r.id;
    hasta = hoy;
    desde = r.dias == null ? "2020-01-01" : restar(hoy, r.dias);
  }
  if (desde > hasta) desde = hasta;
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  return {
    rango, desde, hasta,
    fase: ["baseline", "notes", "notes_ops"].includes(uno(sp, "fase") ?? "") ? uno(sp, "fase") : null,
    medico: uuid(uno(sp, "medico")),
    dispositivo: uuid(uno(sp, "dispositivo")),
    incluirMala: uno(sp, "incluir_mala") === "1",
  };
}

/** Reconstruye la query string con un cambio, para los enlaces de filtro. */
export function conFiltro(f: Filtros, cambios: Partial<Record<"rango" | "desde" | "hasta" | "fase" | "medico" | "dispositivo" | "incluir_mala" | "page", string | null>>): string {
  const q = new URLSearchParams();
  const base: Record<string, string | null> = {
    rango: f.rango === "custom" ? null : f.rango,
    desde: f.rango === "custom" ? f.desde : null,
    hasta: f.rango === "custom" ? f.hasta : null,
    fase: f.fase, medico: f.medico, dispositivo: f.dispositivo,
    incluir_mala: f.incluirMala ? "1" : null,
  };
  for (const [k, v] of Object.entries({ ...base, ...cambios })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
