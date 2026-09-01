// La exportación en STREAMING: los datos salen fila a fila con un cursor de Postgres, así
// un rango grande no se carga entero en memoria ni choca con el límite de tamaño de
// respuesta del hosting. Tres formatos: CSV (Excel), JSON (array) y NDJSON (una línea
// por fila, para procesar por lotes). El dataset JSON lleva el diccionario dentro.
import { sql } from "./db";
import { DICCIONARIO } from "./diccionario";
import type { Filtros } from "./filtros";
import { filtroTurnos } from "./consultas";

type Fila = Record<string, unknown>;

export const COLUMNAS = {
  turnos: ["shift_id", "fecha_operativa", "phase", "doctor_id", "medico", "device_id", "pc", "pc_etiqueta", "started_at", "ended_at", "end_reason",
    "duracion_ms", "foreground_ms_total", "active_ms_total", "his_ms", "miracle_ms", "typing_ms", "keystrokes", "clicks", "scroll_ticks", "context_switches",
    "encounters", "encounter_active_ms_mediana", "post_atencion_ms", "cola_post_turno_ms", "sap_wait_ms_total", "sap_roundtrips", "ready_ms_p50", "ready_ms_p95",
    "pantallas_distintas", "visitas", "tabs", "enters", "correcciones", "copias", "pegados", "guardados",
    "interrupciones", "revisitas_sap", "consultas_por_hora", "consulta_ms_mediana", "entre_consultas_ms_mediana", "carga_admin_pct",
    "cobertura_pct", "calidad_ok", "active_ms_por_app", "sap_user_seen", "app_version", "huecos_ms", "clock_jumps",
    "spool_dropped", "hooks_degradados", "ticks_sap_saltados_busy", "algo_version"],
  muestras: ["shift_id", "device_id", "doctor_id", "phase", "bucket_start", "bucket_ms", "seq", "app", "surface", "encounter_key", "foreground_ms", "active_ms",
    "typing_ms", "keystrokes", "clicks", "scroll_ticks", "context_switches", "sap_roundtrips", "sap_wait_ms",
    "tabs", "enters", "correcciones", "copias", "pegados", "guardados"],
  visitas: ["shift_id", "device_id", "doctor_id", "phase", "encounter_key", "sid", "tcode", "dynpro", "surface", "entered_at", "left_at", "dwell_ms", "ready_ms",
    "sap_wait_ms", "roundtrips", "exit_to"],
  eventos: ["shift_id", "device_id", "occurred_at", "kind", "encounter_key", "detail"],
} as const;

export type Coleccion = keyof typeof COLUMNAS;

const turnosFiltrados = (f: Filtros) => sql`select m.shift_id from shift_summary m where ${filtroTurnos(f)}`;

export function consulta(col: Coleccion, f: Filtros) {
  switch (col) {
    case "turnos":
      return sql`select m.shift_id, m.fecha_operativa::text as fecha_operativa, m.phase, m.doctor_id, r.display_name as medico, m.device_id, d.machine_name as pc, d.label as pc_etiqueta,
        m.started_at, m.ended_at, s.end_reason, m.duracion_ms, m.foreground_ms_total, m.active_ms_total, m.his_ms, m.miracle_ms, m.typing_ms, m.keystrokes, m.clicks,
        m.scroll_ticks, m.context_switches, m.encounters, m.encounter_active_ms_mediana, m.post_atencion_ms, m.cola_post_turno_ms, m.sap_wait_ms_total, m.sap_roundtrips,
        m.ready_ms_p50, m.ready_ms_p95, m.pantallas_distintas, m.visitas,
        m.tabs, m.enters, m.correcciones, m.copias, m.pegados, m.guardados,
        m.interrupciones, m.revisitas_sap, m.consultas_por_hora, m.consulta_ms_mediana, m.entre_consultas_ms_mediana, m.carga_admin_pct,
        m.cobertura_pct, m.calidad_ok, m.active_ms_por_app, s.sap_user_seen, s.app_version,
        s.huecos_ms, s.clock_jumps, s.spool_dropped, s.hooks_degradados, s.ticks_sap_saltados_busy, m.algo_version
        from shift_summary m join shifts s on s.shift_id = m.shift_id left join roster r on r.id = m.doctor_id left join devices d on d.id = m.device_id
        where ${filtroTurnos(f)} order by m.started_at`;
    case "muestras":
      return sql`select x.shift_id, x.device_id, s.doctor_id, s.phase, x.bucket_start, x.bucket_ms, x.seq, x.app, x.surface, x.encounter_key, x.foreground_ms, x.active_ms,
        x.typing_ms, x.keystrokes, x.clicks, x.scroll_ticks, x.context_switches, x.sap_roundtrips, x.sap_wait_ms,
        x.tabs, x.enters, x.correcciones, x.copias, x.pegados, x.guardados
        from samples x join shifts s on s.shift_id = x.shift_id
        where x.shift_id in (${turnosFiltrados(f)}) order by x.bucket_start, x.seq`;
    case "visitas":
      return sql`select v.shift_id, v.device_id, s.doctor_id, s.phase, v.encounter_key, v.sid, v.tcode, v.dynpro, v.surface, v.entered_at, v.left_at, v.dwell_ms, v.ready_ms,
        v.sap_wait_ms, v.roundtrips, v.exit_to
        from sap_visits v join shifts s on s.shift_id = v.shift_id
        where v.shift_id in (${turnosFiltrados(f)}) order by v.entered_at`;
    case "eventos":
      return sql`select e.shift_id, e.device_id, e.occurred_at, e.kind, e.encounter_key, e.detail
        from events e where e.shift_id in (${turnosFiltrados(f)}) order by e.occurred_at`;
  }
}

function valorCsv(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === "object" ? JSON.stringify(v) : `${v}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function* csv(col: Coleccion, f: Filtros): AsyncGenerator<string> {
  const cols = COLUMNAS[col];
  yield "﻿" + cols.join(",") + "\n"; // BOM: Excel abre los acentos bien
  for await (const filas of consulta(col, f).cursor(500)) {
    yield (filas as Fila[]).map((r) => cols.map((c) => valorCsv(r[c])).join(",")).join("\n") + "\n";
  }
}

export async function* ndjson(col: Coleccion, f: Filtros): AsyncGenerator<string> {
  for await (const filas of consulta(col, f).cursor(500)) {
    yield (filas as Fila[]).map((r) => JSON.stringify(r)).join("\n") + "\n";
  }
}

export async function* json(col: Coleccion, f: Filtros): AsyncGenerator<string> {
  yield "[";
  let primera = true;
  for await (const filas of consulta(col, f).cursor(500)) {
    for (const r of filas as Fila[]) { yield (primera ? "\n" : ",\n") + JSON.stringify(r); primera = false; }
  }
  yield "\n]\n";
}

async function* arrayJson(col: Coleccion, f: Filtros, tope: number): AsyncGenerator<string> {
  yield "[";
  let primera = true, n = 0;
  for await (const filas of consulta(col, f).cursor(500)) {
    for (const r of filas as Fila[]) {
      if (n++ >= tope) break;
      yield (primera ? "\n    " : ",\n    ") + JSON.stringify(r); primera = false;
    }
    if (n >= tope) break;
  }
  yield "\n  ]";
}

/** El dataset autodescriptivo: diccionario + catálogos + turnos + visitas + eventos (+ muestras). */
export async function* dataset(f: Filtros, conMuestras: boolean): AsyncGenerator<string> {
  const [fases, medicos, dispositivos] = await Promise.all([
    sql`select phase, starts_on::text as starts_on, ends_on::text as ends_on, notes from study_phases order by starts_on`,
    sql`select id, display_name, sap_users, active from roster order by sort_order, display_name`,
    sql`select id, machine_name, label, status, app_version, registered_at, last_seen_at from devices order by machine_name`,
  ]);
  const cabecera = {
    _leeme: { ...DICCIONARIO, generado_en: new Date().toISOString(), rango: { desde: f.desde, hasta: f.hasta, fase: f.fase, doctor_id: f.medico, device_id: f.dispositivo, incluye_mala_calidad: f.incluirMala },
      topes: "visitas_sap y eventos se cortan en 200000 filas; muestras (si se pidieron) en 500000. Para más, usa las exportaciones por colección en NDJSON o acota el rango." },
    fases, medicos, dispositivos,
  };
  const texto = JSON.stringify(cabecera, null, 2);
  yield texto.slice(0, -2) + ",\n  \"turnos\": ";
  yield* arrayJson("turnos", f, 1_000_000);
  yield ",\n  \"visitas_sap\": ";
  yield* arrayJson("visitas", f, 200_000);
  yield ",\n  \"eventos\": ";
  yield* arrayJson("eventos", f, 200_000);
  if (conMuestras) {
    yield ",\n  \"muestras\": ";
    yield* arrayJson("muestras", f, 500_000);
  }
  yield "\n}\n";
}

export function aStream(gen: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close(); else controller.enqueue(enc.encode(value));
      } catch (e) { controller.error(e); }
    },
    cancel() { void gen.return(undefined); },
  });
}
