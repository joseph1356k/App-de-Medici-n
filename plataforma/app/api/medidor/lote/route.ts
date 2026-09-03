// POST /api/medidor/lote — el latido del .exe, cada minuto. Recibe
//   {device_id, batch_id, client_now, app_version, jornadas[], samples[], events[], sap_visits[]}
// y persiste con idempotencia (claves naturales + ON CONFLICT DO NOTHING → jamás 409). Todo
// lo que llega se estampa con el consultorio que el panel le asignó al PC (NULL si aún no).
//
// La respuesta habla en los NOMBRES DEL SPOOL del .exe (muestras/eventos/visitas/jornadas):
//   rechazadas[]    filas envenenadas, con su spool_seq: el .exe las saca del spool
//   no_procesadas[] filas que sobraron del tope por colección: el .exe las REENVÍA
//   consultorio     el asignado, para que el icono lo muestre
// Un lote vacío es el heartbeat. Al final resume las jornadas tocadas (con acelerador de 5
// min), así el panel va a minutos del terreno sin esperar al cron.
//
// Compatibilidad con el .exe v1 durante el recambio de los PCs: acepta un sobre con `shifts[]`
// en vez de `jornadas[]` (cada turno es una foto de proceso) y devuelve además `rejected[]`
// con la forma vieja pero los nombres del spool.
import { sql } from "@/lib/db";
import { exigirClave, json } from "@/lib/api";
import {
  LIMITES, construir, filaEvento, filaJornada, filaMuestra, filaVisita, spoolSeqDe, str, toIso, tomar, uuidOrNull,
  type Coleccion, type Contexto, type Crudo, type FilaEvento, type FilaMuestra, type FilaVisita, type NoProcesada, type Rechazo,
} from "@/lib/ingesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COLS_MUESTRA = ["device_id", "consultorio_id", "dia_operativo", "bucket_start", "bucket_ms", "seq", "app", "surface", "encounter_key", "sap_user",
  "foreground_ms", "active_ms", "typing_ms", "keystrokes", "clicks", "scroll_ticks", "context_switches", "sap_roundtrips", "sap_wait_ms",
  "tabs", "enters", "correcciones", "copias", "pegados", "guardados"] as const;
const COLS_EVENTO = ["event_uid", "device_id", "consultorio_id", "dia_operativo", "occurred_at", "encounter_key", "kind", "detail"] as const;
const COLS_VISITA = ["visit_uid", "device_id", "consultorio_id", "dia_operativo", "encounter_key", "sap_user", "sid", "tcode", "dynpro", "surface",
  "entered_at", "left_at", "dwell_ms", "ready_ms", "sap_wait_ms", "roundtrips", "exit_to"] as const;

type Device = { id: string; status: string; config_version: number; hmac_version: number; consultorio_id: string | null; consultorio: string | null };

export async function POST(req: Request) {
  const rechazo = exigirClave(req);
  if (rechazo) return rechazo;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const deviceId = uuidOrNull(body.device_id);
  if (!deviceId) return json({ error: "device_id inválido" }, 400);

  // El device manda la identidad y el estado. NUNCA se cree al payload.
  const [dev] = await sql<Device[]>`
    select d.id, d.status, d.config_version, d.hmac_version, d.consultorio_id, c.nombre as consultorio
    from devices d left join consultorios c on c.id = d.consultorio_id where d.id = ${deviceId}`;
  if (!dev) return json({ error: "Dispositivo no encontrado. Vuelve a registrarte." }, 403);
  if (dev.status !== "active") return json({ error: "Dispositivo pausado o retirado.", status: dev.status }, 403);

  const ctx: Contexto = { deviceId, consultorioId: dev.consultorio_id };
  const rechazadas: Rechazo[] = [];
  const noProcesadas: NoProcesada[] = [];
  const aceptadas = { jornadas: 0, muestras: 0, eventos: 0, visitas: 0 };
  const appVersion = str(body.app_version).slice(0, 40);
  const clientNow = toIso(body.client_now);
  const skewMs = clientNow ? Date.now() - Date.parse(clientNow) : null;
  const tocados = new Set<string>();

  const tomarDe = (coleccion: Coleccion, crudo: unknown): Crudo[] => {
    const { filas, sobrantes } = tomar(crudo, LIMITES[coleccion]);
    for (const s of sobrantes) noProcesadas.push({ coleccion, spool_seq: spoolSeqDe(s) });
    return filas;
  };

  // Jornadas: la foto de calidad por proceso. Una por una porque el upsert es una función.
  const v1 = !Array.isArray(body.jornadas) && Array.isArray(body.shifts);
  const jornadas = construir("jornadas", tomarDe("jornadas", v1 ? body.shifts : body.jornadas), (r) => filaJornada(ctx, r), rechazadas);
  for (const j of jornadas) {
    try {
      await sql`select upsert_jornada(${j.device_id}::uuid, ${j.dia_operativo}::date, ${j.proceso_id}::uuid, ${j.consultorio_id}::uuid,
        ${j.primera_muestra_at}::timestamptz, ${j.ultima_muestra_at}::timestamptz, ${j.app_version}, ${j.hmac_version},
        ${j.huecos_ms}, ${j.clock_jumps}, ${j.spool_dropped}, ${j.hooks_degradados}, ${j.hooks_rearmados}, ${j.ticks_sap_saltados_busy},
        ${j.sap_scripting}, ${j.sap_eventos_com}, ${j.relanzos})`;
      aceptadas.jornadas++;
      tocados.add(j.dia_operativo);
    } catch (err) {
      rechazadas.push({ coleccion: "jornadas", spool_seq: j.spool_seq, motivo: motivo(err) });
    }
  }

  const muestras = construir("muestras", tomarDe("muestras", body.samples), (r) => filaMuestra(ctx, r), rechazadas);
  aceptadas.muestras = await insertar("muestras", muestras, rechazadas, (filas) =>
    sql`insert into samples ${sql(filas, ...COLS_MUESTRA)} on conflict (device_id, bucket_start, seq) do nothing`);
  let ultimaCubeta: string | null = null;
  for (const m of muestras) { tocados.add(m.dia_operativo); if (!ultimaCubeta || m.bucket_start > ultimaCubeta) ultimaCubeta = m.bucket_start; }

  const eventos = construir("eventos", tomarDe("eventos", body.events), (r) => filaEvento(ctx, r), rechazadas);
  aceptadas.eventos = await insertar("eventos", eventos, rechazadas, (filas) =>
    sql`insert into events ${sql(filas.map((e) => ({ ...e, detail: sql.json(e.detail as never) })), ...COLS_EVENTO)} on conflict (event_uid) do nothing`);
  for (const e of eventos) tocados.add(e.dia_operativo);

  const visitas = construir("visitas", tomarDe("visitas", body.sap_visits), (r) => filaVisita(ctx, r), rechazadas);
  aceptadas.visitas = await insertar("visitas", visitas, rechazadas, (filas) =>
    sql`insert into sap_visits ${sql(filas, ...COLS_VISITA)} on conflict (visit_uid) do nothing`);
  for (const v of visitas) tocados.add(v.dia_operativo);

  // Latido del dispositivo (best-effort: no tumba lo ya persistido).
  try {
    await sql`update devices set last_seen_at = now(),
      app_version = coalesce(nullif(${appVersion}, ''), app_version),
      last_sample_at = case when ${ultimaCubeta}::timestamptz is null then last_sample_at
                            else greatest(coalesce(last_sample_at, '-infinity'::timestamptz), ${ultimaCubeta}::timestamptz) end
      where id = ${deviceId}`;
  } catch { /* nada */ }

  // Resumen de las jornadas tocadas, con acelerador: como mucho una vez cada 5 minutos por
  // jornada dentro de la petición; el resto queda sucio y lo termina el cron.
  const dias = [...tocados].sort();
  for (const dia of dias.slice(-8)) {
    try { await sql`select recompute_jornada(${deviceId}::uuid, ${dia}::date, interval '5 minutes')`; }
    catch (err) { console.error("resumen", deviceId, dia, motivo(err)); }
  }
  for (const dia of dias.slice(0, -8)) {
    try {
      await sql`insert into jornada_summary (device_id, dia_operativo, consultorio_id) values (${deviceId}::uuid, ${dia}::date, ${dev.consultorio_id}::uuid)
        on conflict (device_id, dia_operativo) do update set sucia = true`;
    } catch { /* el cron lo recoge */ }
  }

  const [a] = await sql<{ config_version: number; hmac_version: number }[]>`select config_version, hmac_version from settings where id = 1`;
  return json({
    ok: true,
    aceptadas, rechazadas, no_procesadas: noProcesadas,
    // Espejo para el .exe v1 (lee rejected[].col/seq). Quitar cuando los tres PCs tengan el v2.
    rejected: rechazadas.map((r) => ({ col: r.coleccion, seq: r.spool_seq ?? -1, reason: r.motivo })),
    clock_skew_ms: skewMs,
    config_version: a?.config_version ?? dev.config_version,
    hmac_version: a?.hmac_version ?? dev.hmac_version,
    consultorio: dev.consultorio_id ? { id: dev.consultorio_id, nombre: dev.consultorio } : null,
  });
}

type ConSeq = { spool_seq: number | null };

// Inserta en bloque; si el bloque entero falla, reintenta por trozos de 100 y solo el trozo
// culpable fila a fila, para que únicamente la fila mala vaya a rechazadas[] con su spool_seq.
async function insertar<T extends ConSeq>(coleccion: Coleccion, filas: T[], rechazadas: Rechazo[], bloque: (filas: T[]) => Promise<unknown>): Promise<number> {
  if (filas.length === 0) return 0;
  try { await bloque(filas); return filas.length; }
  catch (err) {
    console.error(`lote ${coleccion}: el bloque falló (${motivo(err)}); reintentando por trozos`);
    let ok = 0;
    for (let i = 0; i < filas.length; i += 100) {
      const trozo = filas.slice(i, i + 100);
      try { await bloque(trozo); ok += trozo.length; continue; } catch { /* fila a fila */ }
      for (const f of trozo) {
        try { await bloque([f]); ok++; }
        catch (e2) { rechazadas.push({ coleccion, spool_seq: f.spool_seq, motivo: motivo(e2) }); }
      }
    }
    return ok;
  }
}

function motivo(err: unknown): string {
  return `${(err as Error)?.message ?? err}`.slice(0, 160);
}

// Para que el compilador vigile que las listas de columnas y los tipos de fila no se separen.
type _Muestra = (typeof COLS_MUESTRA)[number] extends keyof FilaMuestra ? true : never;
type _Evento = (typeof COLS_EVENTO)[number] extends keyof FilaEvento ? true : never;
type _Visita = (typeof COLS_VISITA)[number] extends keyof FilaVisita ? true : never;
const _vigia: [_Muestra, _Evento, _Visita] = [true, true, true];
void _vigia;
