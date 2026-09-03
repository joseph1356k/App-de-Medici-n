// La exportación en STREAMING: los datos salen fila a fila con un cursor de Postgres, así
// un rango grande no se carga entero en memoria ni choca con el límite de tamaño de
// respuesta del hosting. Tres formatos: CSV (Excel), JSON (array) y NDJSON (una línea
// por fila, para procesar por lotes). El dataset JSON lleva el diccionario dentro.
//
// Todo va por CONSULTORIO y JORNADA (consultorio × día operativo). El médico aparece como
// anotación derivada del login SAP (medico_id / medico), nunca como clave.
import { sql } from "./db";
import { DICCIONARIO } from "./diccionario";
import type { Filtros } from "./filtros";
import { filtroJornadas } from "./consultas";

type Fila = Record<string, unknown>;

export const COLUMNAS = {
  jornadas: ["device_id", "pc", "consultorio_id", "consultorio", "dia_operativo", "phase", "primera_actividad", "ultima_actividad", "ventana_ms",
    "foreground_ms", "activo_ms", "his_ms", "miracle_ms", "typing_ms", "keystrokes", "clicks", "scroll_ticks", "context_switches",
    "tabs", "enters", "correcciones", "copias", "pegados", "guardados",
    "pacientes", "consulta_ms_mediana", "activo_por_paciente_mediana", "entre_consultas_ms_mediana", "post_atencion_ms", "interrupciones", "pacientes_por_hora",
    "visitas", "pantallas_distintas", "revisitas_sap", "sap_wait_ms", "sap_roundtrips", "ready_ms_p50", "ready_ms_p95",
    "bloqueado_ms", "inactivo_ms", "sin_datos_ms", "cobertura_pct", "carga_admin_pct", "tramos", "tramos_ms", "procesos", "app_version",
    "pre_atencion_ms", "cola_post_jornada_ms", "consulta_ms_p25", "consulta_ms_p75", "por_app", "por_hora",
    "activo_por_app", "sap_users", "calidad", "calidad_ok", "calidad_motivos", "algo_version", "resumido_en"],
  pacientes: ["device_id", "consultorio_id", "consultorio", "dia_operativo", "phase", "orden", "encounter_key", "sap_user", "medico_id", "medico",
    "primera_vez", "ultima_vez", "consulta_ms", "activo_ms", "his_ms", "miracle_ms", "typing_ms", "keystrokes", "clicks",
    "tabs", "enters", "correcciones", "copias", "pegados", "guardados", "tramos", "post_atencion_ms", "siguiente_ms",
    "visitas", "pantallas_distintas", "sap_wait_ms", "ready_ms_p50"],
  muestras: ["device_id", "consultorio_id", "dia_operativo", "phase", "bucket_start", "bucket_ms", "seq", "app", "surface", "encounter_key", "sap_user", "medico_id", "medico",
    "foreground_ms", "active_ms", "typing_ms", "keystrokes", "clicks", "scroll_ticks", "context_switches", "sap_roundtrips", "sap_wait_ms",
    "tabs", "enters", "correcciones", "copias", "pegados", "guardados"],
  visitas: ["device_id", "consultorio_id", "dia_operativo", "phase", "encounter_key", "sap_user", "medico_id", "sid", "tcode", "dynpro", "surface",
    "entered_at", "left_at", "dwell_ms", "ready_ms", "sap_wait_ms", "roundtrips", "exit_to"],
  eventos: ["device_id", "consultorio_id", "dia_operativo", "occurred_at", "kind", "encounter_key", "detail"],
} as const;

export type Coleccion = keyof typeof COLUMNAS;

const jornadasFiltradas = (f: Filtros) => sql`select j.device_id, j.dia_operativo from jornada_summary j where ${filtroJornadas(f)}`;

export function consulta(col: Coleccion, f: Filtros) {
  switch (col) {
    case "jornadas":
      return sql`select j.device_id, d.machine_name as pc, j.consultorio_id, c.nombre as consultorio, j.dia_operativo::text as dia_operativo, j.phase,
        j.primera_actividad, j.ultima_actividad, j.ventana_ms,
        j.foreground_ms, j.activo_ms, j.his_ms, j.miracle_ms, j.typing_ms, j.keystrokes, j.clicks, j.scroll_ticks, j.context_switches,
        j.tabs, j.enters, j.correcciones, j.copias, j.pegados, j.guardados,
        j.pacientes, j.consulta_ms_mediana, j.activo_por_paciente_mediana, j.entre_consultas_ms_mediana, j.post_atencion_ms, j.interrupciones, j.pacientes_por_hora,
        j.visitas, j.pantallas_distintas, j.revisitas_sap, j.sap_wait_ms, j.sap_roundtrips, j.ready_ms_p50, j.ready_ms_p95,
        j.bloqueado_ms, j.inactivo_ms, j.sin_datos_ms, j.cobertura_pct, j.carga_admin_pct, j.tramos, j.tramos_ms, j.procesos, j.app_version,
        j.pre_atencion_ms, j.cola_post_jornada_ms, j.consulta_ms_p25, j.consulta_ms_p75, j.por_app, j.por_hora,
        j.activo_por_app, j.sap_users, j.calidad, j.calidad_ok, j.calidad_motivos, j.algo_version, j.resumido_en
        from jornada_summary j left join consultorios c on c.id = j.consultorio_id left join devices d on d.id = j.device_id
        where ${filtroJornadas(f)} order by j.dia_operativo, c.orden, d.machine_name`;
    case "pacientes":
      return sql`select e.device_id, e.consultorio_id, c.nombre as consultorio, e.dia_operativo::text as dia_operativo, j.phase, e.orden, e.encounter_key,
        e.sap_user, medico_de(e.sap_user) as medico_id, r.display_name as medico,
        e.primera_vez, e.ultima_vez, e.consulta_ms, e.activo_ms, e.his_ms, e.miracle_ms, e.typing_ms, e.keystrokes, e.clicks,
        e.tabs, e.enters, e.correcciones, e.copias, e.pegados, e.guardados, e.tramos, e.post_atencion_ms, e.siguiente_ms,
        e.visitas, e.pantallas_distintas, e.sap_wait_ms, e.ready_ms_p50
        from encuentros e
        left join jornada_summary j on j.device_id = e.device_id and j.dia_operativo = e.dia_operativo
        left join consultorios c on c.id = e.consultorio_id
        left join roster r on r.id = medico_de(e.sap_user)
        where (e.device_id, e.dia_operativo) in (${jornadasFiltradas(f)}) order by e.dia_operativo, e.device_id, e.orden`;
    case "muestras":
      return sql`select x.device_id, x.consultorio_id, x.dia_operativo::text as dia_operativo, j.phase, x.bucket_start, x.bucket_ms, x.seq, x.app, x.surface, x.encounter_key,
        x.sap_user, medico_de(x.sap_user) as medico_id, r.display_name as medico,
        x.foreground_ms, x.active_ms, x.typing_ms, x.keystrokes, x.clicks, x.scroll_ticks, x.context_switches, x.sap_roundtrips, x.sap_wait_ms,
        x.tabs, x.enters, x.correcciones, x.copias, x.pegados, x.guardados
        from samples x
        left join jornada_summary j on j.device_id = x.device_id and j.dia_operativo = x.dia_operativo
        left join roster r on r.id = medico_de(x.sap_user)
        where (x.device_id, x.dia_operativo) in (${jornadasFiltradas(f)}) order by x.bucket_start, x.seq`;
    case "visitas":
      return sql`select v.device_id, v.consultorio_id, v.dia_operativo::text as dia_operativo, j.phase, v.encounter_key, v.sap_user, medico_de(v.sap_user) as medico_id,
        v.sid, v.tcode, v.dynpro, v.surface, v.entered_at, v.left_at, v.dwell_ms, v.ready_ms, v.sap_wait_ms, v.roundtrips, v.exit_to
        from sap_visits v
        left join jornada_summary j on j.device_id = v.device_id and j.dia_operativo = v.dia_operativo
        where (v.device_id, v.dia_operativo) in (${jornadasFiltradas(f)}) order by v.entered_at`;
    case "eventos":
      return sql`select e.device_id, e.consultorio_id, e.dia_operativo::text as dia_operativo, e.occurred_at, e.kind, e.encounter_key, e.detail
        from events e where (e.device_id, e.dia_operativo) in (${jornadasFiltradas(f)}) order by e.occurred_at`;
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

/** El dataset autodescriptivo: diccionario + catálogos + jornadas + pacientes + visitas + eventos (+ muestras). */
export async function* dataset(f: Filtros, conMuestras: boolean): AsyncGenerator<string> {
  const [fases, consultorios, medicos, dispositivos] = await Promise.all([
    sql`select phase, starts_on::text as starts_on, ends_on::text as ends_on, notes from study_phases order by starts_on`,
    sql`select id, nombre, orden, activo from consultorios order by orden, nombre`,
    sql`select id, display_name, sap_users, active from roster order by sort_order, display_name`,
    sql`select d.id, d.machine_name, d.consultorio_id, c.nombre as consultorio, d.status, d.app_version, d.registered_at, d.last_seen_at
        from devices d left join consultorios c on c.id = d.consultorio_id order by c.orden, d.machine_name`,
  ]);
  const cabecera = {
    _leeme: {
      ...DICCIONARIO, generado_en: new Date().toISOString(),
      rango: { desde: f.desde, hasta: f.hasta, fase: f.fase, consultorio_id: f.consultorio, device_id: f.dispositivo, incluye_mala_calidad: f.incluirMala },
      topes: "visitas_sap y eventos se cortan en 200000 filas; muestras (si se pidieron) en 500000. Para más, usa las exportaciones por colección en NDJSON o acota el rango.",
    },
    fases, consultorios, medicos, dispositivos,
  };
  const texto = JSON.stringify(cabecera, null, 2);
  yield texto.slice(0, -2) + ",\n  \"jornadas\": ";
  yield* arrayJson("jornadas", f, 1_000_000);
  yield ",\n  \"pacientes\": ";
  yield* arrayJson("pacientes", f, 500_000);
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
