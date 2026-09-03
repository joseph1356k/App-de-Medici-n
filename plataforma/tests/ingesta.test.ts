// Las promesas de la ingesta, sin base de datos: la segunda valla de privacidad, la
// idempotencia y que un rechazo hable en los nombres del spool del .exe. Espejo del contrato
// del .exe (medidor/Contrato) del lado servidor.
import { describe, it, expect } from "vitest";
import {
  LIMITES, construir, diaOperativo, filaEvento, filaJornada, filaMuestra, filaVisita, sapUser, tomar, uid,
  type Contexto, type Rechazo,
} from "../lib/ingesta";
import { saneaDetalle, surfaceValida, esEncounterKey } from "../lib/vocabulario";

const DEV = "22222222-2222-2222-2222-222222222222";
const CONS = "44444444-4444-4444-4444-444444444444";
const PROC = "33333333-3333-3333-3333-333333333333";
const HUELLA = "a".repeat(32);
const TITULO = "Historia clínica — Juan Pérez Gómez (CC 123456789) - Google Chrome";
const ctx: Contexto = { deviceId: DEV, consultorioId: CONS };
const T = "2026-09-01T13:00:00Z";

describe("privacidad: lo que no puede entrar", () => {
  it("una surface con forma de título se rechaza; las normalizadas pasan", () => {
    expect(surfaceValida(TITULO)).toBe(false);
    expect(surfaceValida("sapgui://PRD/NV2000/SAPMNPA10/0100")).toBe(true);
    expect(surfaceValida("sapgui://PRD/NWP1/SAPLN_WP_FRAMEWORK/0100/ssubVIEW_SCREEN:SAPLN1LSTAMB:0007")).toBe(true);
    expect(surfaceValida("sapgui://PRD/NV2000/SAPMNPA10/0100/vista:Pacientes de Juan")).toBe(false);
    expect(surfaceValida("web://itsmiracleai.com.co")).toBe(true);
    expect(surfaceValida(null)).toBe(true);
    expect(() => filaMuestra(ctx, { spool_seq: 1, bucket_start: T, surface: TITULO })).toThrow(/surface/);
  });

  it("el detail de un evento solo conserva las claves de la lista blanca, sin anidados", () => {
    const limpio = saneaDetalle({ reason: "manual", titulo: TITULO, paciente: { nombre: "Juan" }, ms: 12, count: null, user: "x".repeat(500) });
    expect(Object.keys(limpio).sort()).toEqual(["count", "ms", "reason", "user"]);
    expect(limpio.user).toHaveLength(120);
    expect(JSON.stringify(limpio)).not.toContain("Juan");
  });

  it("un kind desconocido y una huella con otra forma se rechazan", () => {
    expect(() => filaEvento(ctx, { spool_seq: 1, kind: "teclas_capturadas", occurred_at: T })).toThrow(/kind/);
    expect(() => filaEvento(ctx, { spool_seq: 1, kind: "shift_start", occurred_at: T })).toThrow(/kind/);
    expect(esEncounterKey("Juan Pérez")).toBe(false);
    expect(esEncounterKey(HUELLA)).toBe(true);
    expect(() => filaMuestra(ctx, { spool_seq: 1, bucket_start: T, encounter_key: "123456789" })).toThrow(/encounter_key/);
    expect(() => filaVisita(ctx, { spool_seq: 3, entered_at: T, encounter_key: TITULO })).toThrow(/encounter_key/);
  });

  it("un login SAP se normaliza a mayúscula; un valor con espacios (un nombre colado) se rechaza", () => {
    expect(sapUser("med01")).toBe("MED01");
    expect(sapUser("")).toBeNull();
    expect(sapUser(undefined)).toBeNull();
    expect(() => sapUser("Juan Pérez")).toThrow(/sap_user/);
    expect(() => filaMuestra(ctx, { spool_seq: 1, bucket_start: T, app: "sap", sap_user: "Dra. Juana" })).toThrow(/sap_user/);
  });
});

describe("la cubeta bloqueada", () => {
  it("con app = bloqueado no viaja pantalla, paciente ni usuario, y el activo es 0", () => {
    const m = filaMuestra(ctx, { spool_seq: 1, bucket_start: T, app: "bloqueado", surface: "sapgui://PRD/NV2000/SAPMNPA10/0100", encounter_key: HUELLA, sap_user: "MED01", active_ms: 5000, foreground_ms: 15000 });
    expect(m.app).toBe("bloqueado");
    expect([m.surface, m.encounter_key, m.sap_user, m.active_ms, m.foreground_ms]).toEqual([null, null, null, 0, 15000]);
  });
});

describe("idempotencia y robustez del lote", () => {
  it("el uid es determinista por (device, colección, spool_seq): reenviar da el mismo uid", () => {
    expect(uid(DEV, "eventos", 42)).toBe(`${DEV}:eventos:42`);
    expect(filaEvento(ctx, { spool_seq: 42, kind: "lock", occurred_at: T }).event_uid).toBe(filaEvento(ctx, { spool_seq: 42, kind: "lock", occurred_at: T }).event_uid);
    expect(filaVisita(ctx, { spool_seq: 7, entered_at: T }).visit_uid).toBe(`${DEV}:visitas:7`);
  });

  it("una fila sin spool_seq no es idempotente: se rechaza en vez de inventarle un uid", () => {
    expect(() => filaEvento(ctx, { kind: "lock", occurred_at: T })).toThrow(/spool_seq/);
    expect(() => filaVisita(ctx, { entered_at: T })).toThrow(/spool_seq/);
  });

  it("el rechazo habla en el nombre del spool del .exe y lleva el spool_seq (nunca -1)", () => {
    const rechazadas: Rechazo[] = [];
    construir("muestras", [{ spool_seq: 901, seq: 0, bucket_start: T, surface: TITULO }], (r) => filaMuestra(ctx, r), rechazadas);
    expect(rechazadas).toEqual([{ coleccion: "muestras", spool_seq: 901, motivo: expect.stringMatching(/surface/) }]);
    construir("muestras", [{ seq: 0, bucket_start: "cuando sea" }], (r) => filaMuestra(ctx, r), rechazadas);
    expect(rechazadas[1].spool_seq).toBeNull();
  });

  it("el seq de una muestra es el segmento de la cubeta, distinto del spool_seq", () => {
    const m = filaMuestra(ctx, { spool_seq: 900, seq: 1, bucket_start: T, app: "sap" });
    expect(m.seq).toBe(1);
    expect(m.spool_seq).toBe(900);
  });

  it("una fila envenenada va a rechazadas[] con su seq y el resto del lote sigue", () => {
    const rechazadas: Rechazo[] = [];
    const filas = construir("muestras", [
      { spool_seq: 1, bucket_start: T, app: "sap", surface: "sapgui://PRD/NV2000/SAPMNPA10/0100", active_ms: 1000 },
      { spool_seq: 2, bucket_start: "2026-09-01T13:00:15Z", app: "chrome", surface: TITULO },
      { spool_seq: 3, bucket_start: "no es fecha" },
      { spool_seq: 4, bucket_start: "2026-09-01T13:00:45Z", app: "otro" },
    ], (r) => filaMuestra(ctx, r), rechazadas);
    expect(filas).toHaveLength(2);
    expect(rechazadas.map((r) => r.spool_seq)).toEqual([2, 3]);
    expect(rechazadas[0].motivo).toMatch(/surface/);
  });

  it("lo que sobra del tope no se descarta: vuelve como sobrante con su spool_seq", () => {
    const muchas = Array.from({ length: LIMITES.muestras + 1 }, (_, i) => ({ spool_seq: i + 1 }));
    const { filas, sobrantes } = tomar(muchas, LIMITES.muestras);
    expect(filas).toHaveLength(LIMITES.muestras);
    expect(sobrantes).toEqual([{ spool_seq: LIMITES.muestras + 1 }]);
    expect(tomar("no es un arreglo", 10)).toEqual({ filas: [], sobrantes: [] });
  });

  it("los topes del servidor doblan los del .exe (SpoolSqlite.LimitesDeLote = 1000/500/300/20)", () => {
    expect(LIMITES.muestras).toBeGreaterThanOrEqual(2000);
    expect(LIMITES.eventos).toBeGreaterThanOrEqual(1000);
    expect(LIMITES.visitas).toBeGreaterThanOrEqual(600);
    expect(LIMITES.jornadas).toBeGreaterThanOrEqual(40);
  });

  it("toda fila lleva el consultorio del contexto y su día operativo", () => {
    const m = filaMuestra(ctx, { spool_seq: 1, bucket_start: T, app: "sap", dia_operativo: "2026-09-01" });
    expect([m.device_id, m.consultorio_id, m.dia_operativo]).toEqual([DEV, CONS, "2026-09-01"]);
    const e = filaEvento({ deviceId: DEV, consultorioId: null }, { spool_seq: 2, kind: "lock", occurred_at: T });
    expect(e.consultorio_id).toBeNull();
    expect(e.dia_operativo).toBe("2026-09-01");
  });

  it("el día operativo se toma del .exe si viene bien formado; si no, se calcula con el corte de las 06:00 Bogotá", () => {
    expect(diaOperativo({ dia_operativo: "2026-09-01" }, T)).toBe("2026-09-01");
    expect(diaOperativo({ dia_operativo: "ayer" }, "2026-09-02T10:59:00Z")).toBe("2026-09-01"); // 05:59 Bogotá
    expect(diaOperativo({}, "2026-09-02T11:01:00Z")).toBe("2026-09-02");                        // 06:01 Bogotá
    expect(diaOperativo({}, "2026-09-02T02:30:00Z")).toBe("2026-09-01");                        // 21:30 del día anterior
  });

  it("una jornada exige proceso_id (o el shift_id de un .exe v1) y sus contadores nunca son negativos", () => {
    const j = filaJornada(ctx, { spool_seq: 5, proceso_id: PROC, dia_operativo: "2026-09-01", primera_muestra_at: T, huecos_ms: -3, clock_jumps: "2", sap_scripting: true });
    expect([j.proceso_id, j.huecos_ms, j.clock_jumps, j.sap_scripting, j.sap_eventos_com]).toEqual([PROC, 0, 2, true, null]);
    expect(filaJornada(ctx, { spool_seq: 6, shift_id: PROC, started_at: T }).proceso_id).toBe(PROC);
    expect(filaJornada(ctx, { spool_seq: 6, shift_id: PROC, started_at: T }).dia_operativo).toBe("2026-09-01");
    expect(() => filaJornada(ctx, { spool_seq: 7, dia_operativo: "2026-09-01" })).toThrow(/proceso_id/);
  });

  it("los contadores de teclas de control viajan como cantidades y faltantes valen 0", () => {
    const m = filaMuestra(ctx, { spool_seq: 1, bucket_start: T, app: "sap", tabs: 3, pegados: 1, guardados: 2 });
    expect([m.tabs, m.enters, m.correcciones, m.copias, m.pegados, m.guardados]).toEqual([3, 0, 0, 0, 1, 2]);
  });

  it("la app se normaliza a minúscula y un nombre raro se rechaza", () => {
    expect(filaMuestra(ctx, { spool_seq: 1, bucket_start: T, app: "SAP" }).app).toBe("sap");
    expect(() => filaMuestra(ctx, { spool_seq: 1, bucket_start: T, app: "Juan Pérez.exe" })).toThrow(/app/);
  });
});
