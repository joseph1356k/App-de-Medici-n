// Los filtros del panel, leídos de la URL: una sola fila arriba de todo, y todo lo de
// abajo se calcula contra la misma rebanada (así los números siempre concuerdan).
// Las fechas son DÍAS OPERATIVOS (corte 06:00 Bogotá): «hoy» a las 02:00 sigue siendo ayer.
import { diasEntre, hoyOperativo, sumarDias, RE_FECHA } from "./fechas";

export { hoyBogota, hoyOperativo, sumarDias, diasEntre } from "./fechas";

export type Filtros = {
  rango: string; desde: string; hasta: string;
  fase: string | null; consultorio: string | null; dispositivo: string | null; incluirMala: boolean;
};

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

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export function leerFiltros(sp: Sp): Filtros {
  const hoy = hoyOperativo();
  const desdeCustom = uno(sp, "desde"), hastaCustom = uno(sp, "hasta");
  let rango = uno(sp, "rango") ?? (desdeCustom || hastaCustom ? "custom" : "30d");
  let desde: string, hasta: string;
  if (rango === "custom") {
    hasta = hastaCustom && RE_FECHA.test(hastaCustom) ? hastaCustom : hoy;
    desde = desdeCustom && RE_FECHA.test(desdeCustom) ? desdeCustom : sumarDias(hasta, -29);
  } else {
    const r = RANGOS.find((x) => x.id === rango) ?? RANGOS[2];
    rango = r.id;
    hasta = hoy;
    desde = r.dias == null ? "2020-01-01" : sumarDias(hoy, -r.dias);
  }
  if (desde > hasta) desde = hasta;
  return {
    rango, desde, hasta,
    fase: ["baseline", "notes", "notes_ops"].includes(uno(sp, "fase") ?? "") ? uno(sp, "fase") : null,
    consultorio: uuid(uno(sp, "consultorio")),
    dispositivo: uuid(uno(sp, "dispositivo")),
    incluirMala: uno(sp, "incluir_mala") === "1",
  };
}

/**
 * EL PERIODO ANTERIOR, del mismo largo y pegado al elegido: 30 días → los 30 de antes; hoy →
 * ayer. Es contra lo que se compara cada titular, y por eso tiene que ser una función y no un
 * cálculo suelto en la página: si «anterior» significa una cosa en un sitio y otra en otro, las
 * flechas de subida y bajada dejan de querer decir nada.
 */
export function periodoPrevio(f: Filtros): Filtros {
  const dias = Math.max(1, diasEntre(f.desde, f.hasta));
  const hasta = sumarDias(f.desde, -1);
  return { ...f, rango: "custom", desde: sumarDias(hasta, -(dias - 1)), hasta };
}

/** `?fecha=YYYY-MM-DD` de la vista de un día: por defecto el día operativo de hoy, y nunca
 * uno futuro (no hay nada que ver ahí). */
export function leerFecha(sp: Sp): string {
  const hoy = hoyOperativo();
  const f = uno(sp, "fecha");
  return f && RE_FECHA.test(f) && f <= hoy ? f : hoy;
}

/** Reconstruye la query string con un cambio, para los enlaces de filtro. */
export function conFiltro(
  f: Filtros,
  cambios: Partial<Record<"rango" | "desde" | "hasta" | "fase" | "consultorio" | "dispositivo" | "incluir_mala" | "page" | "fecha" | "metrica", string | null>>,
): string {
  const q = new URLSearchParams();
  const base: Record<string, string | null> = {
    rango: f.rango === "custom" ? null : f.rango,
    desde: f.rango === "custom" ? f.desde : null,
    hasta: f.rango === "custom" ? f.hasta : null,
    fase: f.fase, consultorio: f.consultorio, dispositivo: f.dispositivo,
    incluir_mala: f.incluirMala ? "1" : null,
  };
  for (const [k, v] of Object.entries({ ...base, ...cambios })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
