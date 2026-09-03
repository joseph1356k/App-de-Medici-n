// LA GEOMETRÍA DE LA LÍNEA DE TIEMPO, pura: de los segmentos, visitas y eventos de un día
// (lib/segmentos.ts + lib/consultas.ts) a rectángulos en un viewBox de 1000 unidades. Sin
// React ni base de datos, para que vitest lo pruebe con un día sintético y para que el
// componente de servidor solo tenga que pintar lo que sale de aquí.
//
// Dos decisiones que explican casi todo el archivo:
//   · El eje X va en UNIDADES DEL VIEWBOX (0–1000), nunca en píxeles: el SVG se estira con
//     `preserveAspectRatio="none"` y las capas HTML se colocan con `left: x/10 %`. Así el
//     mismo dibujo sirve a 375 px y a una impresora.
//   · Un día tiene ~5 800 cubetas y una pantalla ~1 000 px: `fusionar` pliega lo que no se
//     vería (sub-píxel) SIN perder milisegundos, así los tooltips y los totales siguen
//     siendo verdad aunque el rectángulo sea una mezcla.
import { finDiaOperativo, inicioDiaOperativo } from "./fechas";
import type { LineaDeTiempoDia, VisitaSap } from "./consultas";
import type { Estado, Marca, PacienteDelDia, Segmento } from "./segmentos";

export type Ventana = { desde: number; hasta: number }; // epoch ms
export type Tramo<K extends string = string> = {
  x0: number; x1: number; clave: K; n: number; ms: number; t0: number; t1: number;
  /** Solo cuando el tramo pliega varias claves sub-píxel: ms por clave (la dominante manda). */
  mezcla?: Record<string, number>;
};
export type Tick = { t: number; x: number; etiqueta: string };
export type Escala = { ventana: Ventana; x: (t: number) => number; pct: (t: number) => number; ticks: Tick[] };

export const ANCHO = 1000;
const HORA = 3_600_000, MIN = 60_000;
// Colombia no tiene horario de verano: el desfase es constante y se puede sumar a mano.
const DESFASE_BOGOTA = -5 * HORA;
const MAX_TRAMOS = 1500;

const ms = (t: string | Date | number) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
const acotar = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Redondea a la hora de Bogotá (hacia abajo o hacia arriba). */
function alaHora(t: number, sentido: "abajo" | "arriba"): number {
  const local = t + DESFASE_BOGOTA;
  const h = sentido === "abajo" ? Math.floor(local / HORA) : Math.ceil(local / HORA);
  return h * HORA - DESFASE_BOGOTA;
}

/** «HH:MM» de Bogotá, sin Intl (se llama cientos de veces por dibujo). */
export function horaLocal(t: number): string {
  const local = t + DESFASE_BOGOTA;
  const minutos = Math.floor(local / MIN);
  const h = ((minutos / 60) % 24 + 24) % 24, m = ((minutos % 60) + 60) % 60;
  return `${String(Math.floor(h)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** El día operativo como ventana: 06:00 → 06:00 del siguiente. */
export function limitesDelDia(fecha: string): Ventana {
  return { desde: Date.parse(inicioDiaOperativo(fecha)), hasta: Date.parse(finDiaOperativo(fecha)) };
}

/** «HH:MM» → instante dentro del día operativo. Las horas < 06 son la madrugada siguiente. */
function horaDelDia(dia: Ventana, hhmm: string | null | undefined): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return dia.desde + (((h - 6) + 24) % 24) * HORA + mi * MIN;
}

/**
 * La ventana que se ve por defecto: la actividad del día redondeada a la hora, mínimo 8 h,
 * siempre dentro del día operativo. Hoy crece hasta «ahora» para que la marca se vea. Un
 * día sin nada → 07:00–15:00 (la jornada típica), que es mejor que un eje vacío de 24 h.
 */
export function ventanaAuto(d: Pick<LineaDeTiempoDia, "fecha" | "segmentos" | "resumen">, ahoraIso?: string | number | Date): Ventana {
  const dia = limitesDelDia(d.fecha);
  const ahora = ahoraIso == null ? Date.now() : ms(ahoraIso);
  const con = (estados: Estado[]) => d.segmentos.filter((s) => estados.includes(s.estado));
  let base = con(["activo"]);
  if (base.length === 0) base = con(["inactivo", "bloqueado"]);

  let desde: number, hasta: number;
  if (base.length > 0) {
    desde = alaHora(ms(base[0].inicio), "abajo");
    hasta = alaHora(ms(base[base.length - 1].fin), "arriba");
  } else if (d.resumen?.primera_actividad && d.resumen.ultima_actividad) {
    desde = alaHora(ms(d.resumen.primera_actividad), "abajo");
    hasta = alaHora(ms(d.resumen.ultima_actividad), "arriba");
  } else {
    desde = dia.desde + 1 * HORA; hasta = dia.desde + 9 * HORA;
  }
  if (ahora >= dia.desde && ahora < dia.hasta) hasta = Math.max(hasta, alaHora(ahora, "arriba"));
  if (hasta - desde < 8 * HORA) hasta = desde + 8 * HORA;
  if (hasta > dia.hasta) { desde -= hasta - dia.hasta; hasta = dia.hasta; }
  if (desde < dia.desde) desde = dia.desde;
  return { desde, hasta };
}

/** Zoom por URL: `?desde=HH:MM&hasta=HH:MM` (horas de Bogotá del día operativo). Lo que no
 * se entienda cae a `base`; «hasta=06:00» es el final del día, no su principio. */
export function ventanaDesdeQuery(base: Ventana, fecha: string, desde?: string | null, hasta?: string | null): Ventana {
  const dia = limitesDelDia(fecha);
  const de = horaDelDia(dia, desde), a = horaDelDia(dia, hasta);
  if (de == null && a == null) return base;
  const v = { desde: acotar(de ?? base.desde, dia.desde, dia.hasta), hasta: acotar(a ?? base.hasta, dia.desde, dia.hasta) };
  if (a != null && v.hasta <= v.desde && a === dia.desde) v.hasta = dia.hasta;
  if (v.hasta - v.desde < 5 * MIN) return base;
  return v;
}

/** Ventana → x (0–1000, acotado) y los ticks del eje: ≤ 6 h cada 30 min, ≤ 16 h cada hora,
 * más largo cada 2 h. Alineados a la hora de Bogotá, no a la UTC (importa para el paso de 2 h). */
export function escalaX(v: Ventana): Escala {
  const largo = Math.max(1, v.hasta - v.desde);
  const x = (t: number) => acotar(((t - v.desde) / largo) * ANCHO, 0, ANCHO);
  const horas = largo / HORA;
  const paso = horas <= 6 ? 30 * MIN : horas <= 16 ? HORA : 2 * HORA;
  const ticks: Tick[] = [];
  const local0 = v.desde + DESFASE_BOGOTA;
  for (let l = Math.ceil(local0 / paso) * paso; l - DESFASE_BOGOTA <= v.hasta; l += paso) {
    const t = l - DESFASE_BOGOTA;
    ticks.push({ t, x: x(t), etiqueta: horaLocal(t) });
  }
  return { ventana: v, x, pct: (t) => x(t) / 10, ticks };
}

export type Accesores<T, K extends string> = { inicio: (i: T) => number; fin: (i: T) => number; clave: (i: T) => K; ms?: (i: T) => number };

/**
 * Items ordenados → tramos dibujables, en una pasada:
 *   · misma clave y contiguo en el tiempo → se extiende el tramo;
 *   · el tramo abierto y el item son ambos sub-píxel (< minPx) y se tocan → se pliegan; el
 *     color es el de la clave con más ms y `mezcla` guarda el reparto;
 *   · al final, todo tramo se ensancha a minPx sin pisar al siguiente.
 * La suma de ms se conserva siempre (la prueba lo exige). Si salen más de 1 500 tramos se
 * repite con el doble de minPx: un día de 5 760 cubetas alternas queda en ~1 000.
 */
export function fusionar<T, K extends string>(items: T[], acc: Accesores<T, K>, esc: Escala, minPx = 1): Tramo<K>[] {
  const { desde, hasta } = esc.ventana;
  const out: Tramo<K>[] = [];
  for (const it of items) {
    const t0 = acc.inicio(it), t1 = acc.fin(it);
    if (!(t1 > t0) || t1 <= desde || t0 >= hasta) continue;
    const x0 = esc.x(t0), x1 = esc.x(t1), clave = acc.clave(it);
    const m = acc.ms ? acc.ms(it) : t1 - t0;
    const u = out[out.length - 1];
    if (u) {
      const contiguo = t0 <= u.t1 + 1;
      if (contiguo && u.clave === clave) { extender(u, x1, t1, m, clave); continue; }
      if (x0 - u.x1 < minPx && x1 - x0 < minPx && u.x1 - u.x0 < minPx) { plegar(u, x1, t1, m, clave); continue; }
    }
    out.push({ x0, x1, clave, n: 1, ms: m, t0, t1 });
  }
  if (out.length > MAX_TRAMOS && minPx < 64) return fusionar(items, acc, esc, minPx * 2);
  ensanchar(out, minPx);
  return out;
}

function extender<K extends string>(u: Tramo<K>, x1: number, t1: number, m: number, clave: K) {
  u.x1 = Math.max(u.x1, x1); u.t1 = Math.max(u.t1, t1); u.n += 1; u.ms += m;
  if (u.mezcla) u.mezcla[clave] = (u.mezcla[clave] ?? 0) + m;
}

function plegar<K extends string>(u: Tramo<K>, x1: number, t1: number, m: number, clave: K) {
  u.mezcla ??= { [u.clave]: u.ms };
  u.mezcla[clave] = (u.mezcla[clave] ?? 0) + m;
  u.x1 = Math.max(u.x1, x1); u.t1 = Math.max(u.t1, t1); u.n += 1; u.ms += m;
  let mejor: K = u.clave, max = -1;
  for (const [k, v] of Object.entries(u.mezcla)) if (v > max) { max = v; mejor = k as K; }
  u.clave = mejor;
}

function ensanchar(out: Tramo[], minPx: number) {
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.x1 - t.x0 < minPx) t.x1 = t.x0 + minPx;
    if (t.x1 > ANCHO) { t.x1 = ANCHO; t.x0 = Math.max(0, ANCHO - minPx); const p = out[i - 1]; if (p && p.x1 > t.x0) p.x1 = t.x0; }
    const s = out[i + 1];
    if (s && s.x0 < t.x1) { s.x0 = t.x1; if (s.x1 < s.x0) s.x1 = s.x0; }
  }
}

const segAcc = { inicio: (s: Segmento) => ms(s.inicio), fin: (s: Segmento) => ms(s.fin) };

export function tramosEstado(seg: Segmento[], esc: Escala, minPx = 1): Tramo<Estado>[] {
  return fusionar(seg, { ...segAcc, clave: (s) => s.estado }, esc, minPx);
}

/** El carril de apps: los segmentos con una app delante (activos o inactivos, según se pida);
 * las que no están entre las `visibles` se pintan como «otro». */
export function tramosApp(seg: Segmento[], esc: Escala, visibles: string[], estados: Estado[] = ["activo", "inactivo"], minPx = 1): Tramo<string>[] {
  const items = seg.filter((s) => s.app && s.app !== "bloqueado" && estados.includes(s.estado));
  return fusionar(items, { ...segAcc, clave: (s) => (visibles.includes(s.app!) ? s.app! : "otro") }, esc, minPx);
}

/** Las apps con más tiempo delante, para darles color propio (el resto se pliega en «otro»). */
export function topApps(seg: Segmento[], n = 7): string[] {
  const total = new Map<string, number>();
  for (const s of seg) {
    if (!s.app || s.app === "bloqueado" || s.estado === "sin_datos") continue;
    total.set(s.app, (total.get(s.app) ?? 0) + (ms(s.fin) - ms(s.inicio)));
  }
  return [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a);
}

/** P1, P2… por orden de primera aparición. Manda `pacientes` (ya viene ordenado por primera
 * vez); una huella que solo esté en los segmentos recibe el siguiente número. */
export function indicePacientes(seg: Segmento[], pacientes: Pick<PacienteDelDia, "encounter_key">[]): Record<string, number> {
  const indice: Record<string, number> = {};
  let n = 0;
  for (const p of pacientes) if (!(p.encounter_key in indice)) indice[p.encounter_key] = ++n;
  for (const s of seg) if (s.encounter_key && !(s.encounter_key in indice)) indice[s.encounter_key] = ++n;
  return indice;
}

/** El carril de pacientes sale de las rachas de `encounter_key` de los segmentos: particionan
 * el tiempo sin solapes, y A→B→A se ve como la misma huella reapareciendo. */
export function tramosPacientes(seg: Segmento[], pacientes: PacienteDelDia[], esc: Escala, minPx = 1): { tramos: Tramo<string>[]; indice: Record<string, number> } {
  const indice = indicePacientes(seg, pacientes);
  const items = seg.filter((s) => s.encounter_key && s.estado !== "sin_datos");
  return { tramos: fusionar(items, { ...segAcc, clave: (s) => s.encounter_key! }, esc, minPx), indice };
}

export type TramoSap = Tramo<string> & { visita: VisitaSap; esperaFrac: number };

/** Una visita SAP = un tramo (no se funden: cada una tiene su tooltip). `esperaFrac` es la
 * parte de la estadía que se pasó esperando al servidor, para sombrearla. Una visita aún
 * abierta termina en `hastaMs` (ahora, o el fin del día). */
export function tramosSap(visitas: VisitaSap[], esc: Escala, hastaMs: number, minPx = 1): TramoSap[] {
  const { desde, hasta } = esc.ventana;
  const out: TramoSap[] = [];
  for (const v of [...visitas].sort((a, b) => ms(a.entered_at) - ms(b.entered_at))) {
    const t0 = ms(v.entered_at);
    const t1 = Math.max(t0 + 1000, v.left_at ? ms(v.left_at) : hastaMs);
    if (t1 <= desde || t0 >= hasta) continue;
    const x0 = esc.x(t0), x1 = Math.min(ANCHO, Math.max(esc.x(t1), x0 + minPx));
    const dwell = Math.max(1, Number(v.dwell_ms) || t1 - t0);
    const esperaFrac = acotar((Number(v.sap_wait_ms) || 0) / dwell, 0, 1);
    out.push({ x0, x1, clave: v.tcode, n: 1, ms: t1 - t0, t0, t1, visita: v, esperaFrac });
  }
  for (let i = 1; i < out.length; i++) {
    const p = out[i - 1], t = out[i];
    if (t.x0 < p.x1) { t.x0 = Math.min(p.x1, ANCHO - minPx); if (t.x1 < t.x0 + minPx) t.x1 = Math.min(ANCHO, t.x0 + minPx); }
  }
  return out;
}

export type GrupoMarcas = { x: number; t: number; marcas: Marca[] };

/** Eventos a menos de `radio` unidades se agrupan en un glifo con «×N». */
export function agruparMarcas(marcas: Marca[], esc: Escala, radio = 8): GrupoMarcas[] {
  const { desde, hasta } = esc.ventana;
  const out: GrupoMarcas[] = [];
  for (const m of [...marcas].sort((a, b) => ms(a.t) - ms(b.t))) {
    const t = ms(m.t);
    if (!Number.isFinite(t) || t < desde || t > hasta) continue;
    const x = esc.x(t);
    const u = out[out.length - 1];
    if (u && x - u.x < radio) { u.marcas.push(m); continue; }
    out.push({ x, t, marcas: [m] });
  }
  return out;
}
