// LA LÍNEA DE TIEMPO, como lógica pura: de las cubetas de 15 s de un consultorio en un día
// salen SEGMENTOS (tramos continuos con el mismo estado, app, pantalla, paciente y usuario
// SAP), los PACIENTES del día y los MÉDICOS vistos. Sin base de datos ni React, para que
// vitest lo pruebe con cubetas sintéticas y para que la misma función alimente el panel y,
// si hace falta, una exportación.
//
// Cuatro estados, y el cuarto es el que la v1 no sabía contar:
//   activo      hubo input en los últimos 60 s (active_ms > 0)
//   inactivo    el PC encendido y desbloqueado, pero nadie tocándolo
//   bloqueado   la sesión de Windows bloqueada (la cubeta llega con app = "bloqueado")
//   sin_datos   NO HAY CUBETAS: el PC apagado, suspendido, o el medidor muerto. Se dibuja
//               rayado y se cuenta aparte, porque «no medimos» no es «no pasó nada».
export type Estado = "activo" | "inactivo" | "bloqueado" | "sin_datos";

export type Segmento = {
  inicio: string; fin: string; estado: Estado;
  app: string | null; surface: string | null; tcode: string | null; encounter_key: string | null; sap_user: string | null;
  active_ms: number; typing_ms: number; keystrokes: number; clicks: number; sap_wait_ms: number;
  cubetas: number;
};

export type Marca = { t: string; kind: string; detail: Record<string, string | number | boolean | null> };

export type PacienteDelDia = {
  encounter_key: string; primera_vez: string; ultima_vez: string; consulta_ms: number; activo_ms: number; visitas: number; tramos: number;
};

export type MedicoVisto = { sap_user: string; nombre: string | null; desde: string; hasta: string };

/** Lo que llega de `samples` (una fila por cubeta y contexto). */
export type Bucket = {
  bucket_start: string | Date; bucket_ms: number; seq: number;
  app: string; surface: string | null; encounter_key: string | null; sap_user: string | null;
  foreground_ms: number; active_ms: number; typing_ms: number; keystrokes: number; clicks: number; sap_wait_ms: number;
};

export const CUBETA_MS = 15_000;
/** Lo declarado por la fila: 15 s lo normal, o el tramo entero cuando el medidor fundió cubetas
 * en las que no pasaba nada (una noche bloqueado son unas pocas filas, no miles). */
export const anchoDe = (b: Pick<Bucket, "bucket_ms">) => (b.bucket_ms > 0 ? b.bucket_ms : CUBETA_MS);

/**
 * LO QUE UNA CUBETA CUBRE DE VERDAD, que no siempre es lo que dice `bucket_ms`.
 *
 * El medidor funde los tramos en los que no pasa nada en UNA fila que declara el tramo entero en
 * `bucket_ms` (hasta 5 min). El servidor recortaba ese `bucket_ms` a 15 s al guardarlo, así que
 * de un tramo de 3 minutos quedaba una fila de 15 s y un agujero de 2 min 45 s detrás. Con eso,
 * las seis jornadas del estudio salían con una cobertura del 49-78 % y quedaban EXCLUIDAS, pese a
 * estar medidas enteras.
 *
 * El recorte ya no está (lib/ingesta.ts), pero las filas guardadas antes siguen ahí con su
 * `bucket_ms` mutilado — y su `foreground_ms` intacto, que dice cuánto midió esa fila de verdad.
 * De ahí esta regla, que además es la correcta en general: una cubeta cubre lo que midió, con dos
 * topes — nunca menos que lo declarado, y nunca tanto como para pisar la cubeta siguiente.
 */
export function spanDeCubeta(partes: Pick<Bucket, "bucket_ms" | "foreground_ms">[], hastaLaSiguienteMs?: number): number {
  const declarado = Math.max(...partes.map(anchoDe));
  const medido = partes.reduce((s, p) => s + Math.max(0, p.foreground_ms), 0);
  const span = Math.max(declarado, medido);
  return hastaLaSiguienteMs != null && hastaLaSiguienteMs > 0 ? Math.min(span, hastaLaSiguienteMs) : span;
}
/** Un hueco mayor que esto entre dos cubetas consecutivas es «sin datos». Dos cubetas
 * seguidas distan 15 s; 30 s tolera una cubeta perdida sin abrir un agujero en el dibujo. */
export const HUECO_MS = 30_000;
export const APP_BLOQUEADO = "bloqueado";

const ms = (t: string | Date | number) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
const iso = (t: number) => new Date(t).toISOString();

export function estadoDe(b: Pick<Bucket, "app" | "active_ms">): Estado {
  if (b.app === APP_BLOQUEADO) return "bloqueado";
  return b.active_ms > 0 ? "activo" : "inactivo";
}

/** La transacción de una pantalla SAP: `sapgui://SID/TCODE/...` → TCODE. */
export function tcodeDe(surface: string | null): string | null {
  const m = surface?.match(/^sapgui:\/\/[^/]+\/([^/]*)/);
  return m && m[1] ? m[1] : null;
}

type Seg = Omit<Segmento, "inicio" | "fin"> & { inicioMs: number; finMs: number };

function mismaClave(s: Seg, b: Bucket, estado: Estado): boolean {
  return s.estado === estado && s.app === b.app && s.surface === (b.surface ?? null)
    && s.encounter_key === (b.encounter_key ?? null) && s.sap_user === (b.sap_user ?? null);
}

/**
 * Cubetas → segmentos. Cada cubeta cubre lo que midió (`spanDeCubeta`), sin pisar a la siguiente.
 * Dentro de una misma cubeta, las partes (seq 0, 1, 2…) se reparten ese ancho en proporción a su
 * foreground_ms, en orden: así el tramo de cada parte es contiguo al anterior y las partes suman
 * exactamente la cubeta.
 */
export function segmentar(buckets: Bucket[], huecoMs = HUECO_MS): Segmento[] {
  const orden = [...buckets].sort((a, b) => ms(a.bucket_start) - ms(b.bucket_start) || a.seq - b.seq);
  const out: Seg[] = [];

  let i = 0;
  while (i < orden.length) {
    const T = ms(orden[i].bucket_start);
    let j = i;
    while (j < orden.length && ms(orden[j].bucket_start) === T) j++;
    const partes = orden.slice(i, j);
    i = j;

    const total = partes.reduce((s, p) => s + Math.max(0, p.foreground_ms), 0);
    const siguiente = i < orden.length ? ms(orden[i].bucket_start) - T : undefined;
    const ancho = spanDeCubeta(partes, siguiente);
    let cursor = T;
    partes.forEach((b, k) => {
      const ultima = k === partes.length - 1;
      const dur = ultima ? T + ancho - cursor
        : total > 0 ? Math.round((Math.max(0, b.foreground_ms) / total) * ancho) : Math.round(ancho / partes.length);
      const inicio = cursor, fin = Math.min(T + ancho, cursor + Math.max(0, dur));
      cursor = fin;
      if (fin <= inicio) return;

      const estado = estadoDe(b);
      const prev = out[out.length - 1];
      if (prev && inicio - prev.finMs > huecoMs) {
        out.push({ inicioMs: prev.finMs, finMs: inicio, estado: "sin_datos", app: null, surface: null, tcode: null, encounter_key: null, sap_user: null,
          active_ms: 0, typing_ms: 0, keystrokes: 0, clicks: 0, sap_wait_ms: 0, cubetas: 0 });
      }
      const last = out[out.length - 1];
      if (last && last.estado !== "sin_datos" && mismaClave(last, b, estado) && inicio - last.finMs <= huecoMs) {
        last.finMs = Math.max(last.finMs, fin);
        last.active_ms += b.active_ms; last.typing_ms += b.typing_ms; last.keystrokes += b.keystrokes;
        last.clicks += b.clicks; last.sap_wait_ms += b.sap_wait_ms; last.cubetas += 1;
        return;
      }
      out.push({
        inicioMs: inicio, finMs: fin, estado, app: b.app, surface: b.surface ?? null, tcode: tcodeDe(b.surface ?? null),
        encounter_key: b.encounter_key ?? null, sap_user: b.sap_user ?? null,
        active_ms: b.active_ms, typing_ms: b.typing_ms, keystrokes: b.keystrokes, clicks: b.clicks, sap_wait_ms: b.sap_wait_ms, cubetas: 1,
      });
    });
  }

  return out.map(({ inicioMs, finMs, ...s }) => ({ inicio: iso(inicioMs), fin: iso(finMs), ...s }));
}

/** Los pacientes del día a partir de los segmentos: primera y última vez, duración de
 * consulta en reloj de pared, activo, visitas SAP y cuántos tramos (A→B→A: A tiene 2). */
export function pacientesDelDia(segs: Segmento[], visitas: { encounter_key: string | null }[]): PacienteDelDia[] {
  const porClave = new Map<string, PacienteDelDia>();
  let anterior: string | null = null;
  for (const s of segs) {
    if (s.estado === "sin_datos" || !s.encounter_key) continue;
    const k = s.encounter_key;
    let p = porClave.get(k);
    if (!p) { p = { encounter_key: k, primera_vez: s.inicio, ultima_vez: s.fin, consulta_ms: 0, activo_ms: 0, visitas: 0, tramos: 0 }; porClave.set(k, p); }
    if (s.inicio < p.primera_vez) p.primera_vez = s.inicio;
    if (s.fin > p.ultima_vez) p.ultima_vez = s.fin;
    p.activo_ms += s.active_ms;
    if (anterior !== k) p.tramos += 1;
    anterior = k;
  }
  for (const v of visitas) { const p = v.encounter_key ? porClave.get(v.encounter_key) : undefined; if (p) p.visitas += 1; }
  return [...porClave.values()]
    .map((p) => ({ ...p, consulta_ms: ms(p.ultima_vez) - ms(p.primera_vez) }))
    .sort((a, b) => a.primera_vez.localeCompare(b.primera_vez));
}

/** Rachas de usuario SAP: quién estuvo en el PC y cuándo. Los segmentos sin usuario (fuera
 * de SAP, bloqueado) no cortan la racha. El nombre sale del roster, si lo hay. */
export function medicosVistos(segs: Segmento[], roster: { id: string; display_name: string; sap_users: string[] }[]): MedicoVisto[] {
  const nombreDe = (u: string) => roster.find((r) => r.sap_users.some((x) => x.toUpperCase() === u.toUpperCase()))?.display_name ?? null;
  const out: MedicoVisto[] = [];
  for (const s of segs) {
    if (!s.sap_user) continue;
    const last = out[out.length - 1];
    if (last && last.sap_user === s.sap_user) { last.hasta = s.fin; continue; }
    out.push({ sap_user: s.sap_user, nombre: nombreDe(s.sap_user), desde: s.inicio, hasta: s.fin });
  }
  return out;
}

/** Suma por estado, para tiles y tooltips. */
export function totalesPorEstado(segs: Segmento[]): Record<Estado, number> {
  const t: Record<Estado, number> = { activo: 0, inactivo: 0, bloqueado: 0, sin_datos: 0 };
  for (const s of segs) t[s.estado] += ms(s.fin) - ms(s.inicio);
  return t;
}
