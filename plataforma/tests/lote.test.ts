// La ruta de ingesta de punta a punta, con la base SIMULADA: lo que el .exe manda y lo que
// recibe de vuelta. Es la pieza que en la v1 perdía datos (respondía con los nombres de las
// tablas y el .exe borraba del spool lo que no encontraba), así que aquí se juzga la forma
// exacta de la respuesta, no solo que no explote.
import { beforeEach, describe, expect, it, vi } from "vitest";

const DEV = "22222222-2222-2222-2222-222222222222";
const CONS = "44444444-4444-4444-4444-444444444444";
const PROC = "33333333-3333-3333-3333-333333333333";
const HUELLA = "a".repeat(32);
const TITULO = "Historia clínica — Juan Pérez";

type Llamada = { texto: string; valores: unknown[] };
const llamadas: Llamada[] = [];
let fallaBloque: ((texto: string, filas: Record<string, unknown>[]) => boolean) | null = null;
let device: Record<string, unknown> | null = { id: DEV, status: "active", config_version: 1, hmac_version: 1, consultorio_id: CONS, consultorio: "Consultorio 1" };

// Un postgres.js de mentira: la etiqueta `sql\`…\`` devuelve filas según el texto; `sql(filas, ...cols)`
// (el helper de insert masivo) devuelve un marcador con las filas, para poder mirarlas.
function sqlFalso(primero: unknown, ...resto: unknown[]): unknown {
  if (Array.isArray(primero) && !("raw" in (primero as object))) return { __filas: primero, __cols: resto };
  const partes = primero as TemplateStringsArray;
  const texto = partes.join("?").replace(/\s+/g, " ").trim();
  const filasInsertadas = (resto.find((v) => v && typeof v === "object" && "__filas" in (v as object)) as { __filas: Record<string, unknown>[] } | undefined)?.__filas ?? [];
  llamadas.push({ texto, valores: resto });
  const responder = (filas: unknown[]) => Promise.resolve(filas);
  if (texto.startsWith("select d.id, d.status")) return responder(device ? [device] : []);
  if (texto.startsWith("select config_version, hmac_version from settings")) return responder([{ config_version: 3, hmac_version: 1 }]);
  if (texto.startsWith("insert into")) {
    if (fallaBloque && fallaBloque(texto, filasInsertadas)) return Promise.reject(new Error("fila mala (simulada)"));
    return responder([]);
  }
  return responder([]);
}
sqlFalso.json = (x: unknown) => ({ __json: x });

vi.mock("../lib/db", () => ({ sql: sqlFalso, sqlLargo: sqlFalso }));

const { POST } = await import("../app/api/medidor/lote/route");

function peticion(cuerpo: unknown, clave = "clave-de-prueba") {
  return new Request("http://localhost/api/medidor/lote", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": clave }, body: JSON.stringify(cuerpo),
  });
}

const muestra = (spool_seq: number, extra: Record<string, unknown> = {}) => ({
  spool_seq, dia_operativo: "2026-09-02", bucket_start: `2026-09-02T12:${String(spool_seq % 60).padStart(2, "0")}:00Z`, bucket_ms: 15000, seq: 0,
  app: "sap", surface: "sapgui://PRD/NV2000/SAPMNPA10/0100", encounter_key: HUELLA, sap_user: "MED01",
  foreground_ms: 15000, active_ms: 12000, typing_ms: 3000, keystrokes: 20, clicks: 3, ...extra,
});

const jornada = { spool_seq: 1, proceso_id: PROC, dia_operativo: "2026-09-02", primera_muestra_at: "2026-09-02T12:00:00Z", ultima_muestra_at: "2026-09-02T12:59:45Z",
  app_version: "2.0.0", hmac_version: 1, huecos_ms: 0, clock_jumps: 0, spool_dropped: 0, hooks_degradados: false, hooks_rearmados: 0,
  ticks_sap_saltados_busy: 0, sap_scripting: true, sap_eventos_com: false, relanzos: 0 };

beforeEach(() => {
  process.env.MEDIDOR_API_KEY = "clave-de-prueba";
  llamadas.length = 0;
  fallaBloque = null;
  device = { id: DEV, status: "active", config_version: 1, hmac_version: 1, consultorio_id: CONS, consultorio: "Consultorio 1" };
});

const insertadas = (tabla: string) => llamadas.filter((l) => l.texto.startsWith(`insert into ${tabla}`))
  .flatMap((l) => (l.valores.find((v) => v && typeof v === "object" && "__filas" in (v as object)) as { __filas: Record<string, unknown>[] }).__filas);

describe("POST /api/medidor/lote (v2)", () => {
  it("acepta un sobre v2, estampa el consultorio, rechaza por nombre del spool y devuelve el consultorio", async () => {
    const res = await POST(peticion({
      device_id: DEV, batch_id: "b1", client_now: new Date().toISOString(), app_version: "2.0.0",
      jornadas: [jornada],
      samples: [muestra(2), muestra(3, { app: "chrome", surface: TITULO, encounter_key: null }), muestra(4, { app: "bloqueado", surface: null, encounter_key: null, sap_user: null, active_ms: 0 })],
      events: [{ spool_seq: 5, dia_operativo: "2026-09-02", occurred_at: "2026-09-02T12:00:00Z", kind: "jornada_inicio", detail: { version: "2.0.0", titulo: TITULO } }],
      sap_visits: [],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.aceptadas).toEqual({ jornadas: 1, muestras: 2, eventos: 1, visitas: 0 });
    expect(body.rechazadas).toEqual([{ coleccion: "muestras", spool_seq: 3, motivo: expect.stringMatching(/surface/) }]);
    expect(body.rejected).toEqual([{ col: "muestras", seq: 3, reason: expect.stringMatching(/surface/) }]); // espejo v1, nombres del spool
    expect(body.no_procesadas).toEqual([]);
    expect(body.consultorio).toEqual({ id: CONS, nombre: "Consultorio 1" });
    expect(body.config_version).toBe(3);

    const muestras = insertadas("samples");
    expect(muestras).toHaveLength(2);
    expect(muestras.every((m) => m.consultorio_id === CONS && m.dia_operativo === "2026-09-02")).toBe(true);
    const bloqueada = muestras.find((m) => m.app === "bloqueado")!;
    expect([bloqueada.surface, bloqueada.encounter_key, bloqueada.sap_user, bloqueada.active_ms]).toEqual([null, null, null, 0]);
    expect(JSON.stringify(llamadas)).not.toContain("Juan Pérez"); // ni en el detail saneado ni en ningún sitio

    const upsert = llamadas.find((l) => l.texto.includes("upsert_jornada"))!;
    expect(upsert.valores).toContain(PROC);
    expect(llamadas.some((l) => l.texto.includes("recompute_jornada") && l.texto.includes("5 minutes"))).toBe(true);
  });

  it("lo que sobra del tope vuelve en no_procesadas con su spool_seq, y no se descarta", async () => {
    const res = await POST(peticion({ device_id: DEV, samples: Array.from({ length: 2001 }, (_, i) => muestra(i + 1, { bucket_start: new Date(Date.UTC(2026, 8, 2, 11, 0, 15 * (i % 4000))).toISOString() })) }));
    const body = await res.json();
    expect(body.aceptadas.muestras).toBe(2000);
    expect(body.no_procesadas).toEqual([{ coleccion: "muestras", spool_seq: 2001 }]);
  });

  it("un .exe v1 que aún manda shifts[] no rompe nada: el turno es una foto de proceso", async () => {
    const res = await POST(peticion({ device_id: DEV, shifts: [{ spool_seq: 9, shift_id: PROC, started_at: "2026-09-02T12:00:00Z", app_version: "1.0.3" }], samples: [], events: [], sap_visits: [] }));
    const body = await res.json();
    expect(body.aceptadas.jornadas).toBe(1);
    expect(llamadas.find((l) => l.texto.includes("upsert_jornada"))!.valores).toContain(PROC);
  });

  it("si el bloque falla, solo la fila culpable va a rechazadas con su spool_seq y el resto entra", async () => {
    fallaBloque = (texto, filas) => texto.startsWith("insert into samples") && filas.some((f) => f.spool_seq === 7);
    const res = await POST(peticion({ device_id: DEV, samples: [muestra(6), muestra(7), muestra(8)] }));
    const body = await res.json();
    expect(body.aceptadas.muestras).toBe(2);
    expect(body.rechazadas).toEqual([{ coleccion: "muestras", spool_seq: 7, motivo: expect.stringMatching(/simulada/) }]);
  });

  it("un dispositivo desconocido o pausado recibe 403 y una clave mala 401", async () => {
    device = null;
    expect((await POST(peticion({ device_id: DEV }))).status).toBe(403);
    device = { id: DEV, status: "paused", config_version: 1, hmac_version: 1, consultorio_id: null, consultorio: null };
    expect((await POST(peticion({ device_id: DEV }))).status).toBe(403);
    expect((await POST(peticion({ device_id: DEV }, "otra"))).status).toBe(401);
  });

  it("un PC sin consultorio manda igual: consultorio null en la fila y en la respuesta", async () => {
    device = { id: DEV, status: "active", config_version: 1, hmac_version: 1, consultorio_id: null, consultorio: null };
    const res = await POST(peticion({ device_id: DEV, samples: [muestra(1)] }));
    const body = await res.json();
    expect(body.consultorio).toBeNull();
    expect(insertadas("samples")[0].consultorio_id).toBeNull();
  });
});
