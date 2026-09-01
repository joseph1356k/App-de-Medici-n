// Las promesas de la ingesta, sin base de datos: la segunda valla de privacidad y la
// idempotencia. Espejo del contrato del .exe (medidor/Contrato) del lado servidor.
import { describe, it, expect } from "vitest";
import { construir, filaEvento, filaMuestra, filaTurno, filaVisita, uid, type Rechazo } from "../lib/ingesta";
import { saneaDetalle, surfaceValida, esEncounterKey } from "../lib/vocabulario";

const DEV = "22222222-2222-2222-2222-222222222222";
const SHIFT = "33333333-3333-3333-3333-333333333333";
const HUELLA = "a".repeat(32);
const TITULO = "Historia clínica — Juan Pérez Gómez (CC 123456789) - Google Chrome";

describe("privacidad: lo que no puede entrar", () => {
  it("una surface con forma de título se rechaza; las normalizadas pasan", () => {
    expect(surfaceValida(TITULO)).toBe(false);
    expect(surfaceValida("sapgui://PRD/NV2000/SAPMNPA10/0100")).toBe(true);
    expect(surfaceValida("sapgui://PRD/NWP1/SAPLN_WP_FRAMEWORK/0100/ssubVIEW_SCREEN:SAPLN1LSTAMB:0007")).toBe(true);
    expect(surfaceValida("sapgui://PRD/NV2000/SAPMNPA10/0100/vista:Pacientes de Juan")).toBe(false);
    expect(surfaceValida("web://itsmiracleai.com.co")).toBe(true);
    expect(surfaceValida(null)).toBe(true);
    expect(() => filaMuestra(DEV, { shift_id: SHIFT, bucket_start: "2026-09-01T13:00:00Z", surface: TITULO })).toThrow(/surface/);
  });

  it("el detail de un evento solo conserva las claves de la lista blanca, sin anidados", () => {
    const limpio = saneaDetalle({ reason: "manual", titulo: TITULO, paciente: { nombre: "Juan" }, ms: 12, count: null, user: "x".repeat(500) });
    expect(Object.keys(limpio).sort()).toEqual(["count", "ms", "reason", "user"]);
    expect(limpio.user).toHaveLength(120);
    expect(JSON.stringify(limpio)).not.toContain("Juan");
  });

  it("un kind desconocido y una huella con otra forma se rechazan", () => {
    expect(() => filaEvento(DEV, { spool_seq: 1, kind: "teclas_capturadas", occurred_at: "2026-09-01T13:00:00Z" })).toThrow(/kind/);
    expect(esEncounterKey("Juan Pérez")).toBe(false);
    expect(esEncounterKey(HUELLA)).toBe(true);
    expect(() => filaMuestra(DEV, { shift_id: SHIFT, bucket_start: "2026-09-01T13:00:00Z", encounter_key: "123456789" })).toThrow(/encounter_key/);
    expect(() => filaVisita(DEV, { spool_seq: 3, shift_id: SHIFT, entered_at: "2026-09-01T13:00:00Z", encounter_key: TITULO })).toThrow(/encounter_key/);
  });
});

describe("idempotencia y robustez del lote", () => {
  it("el uid es determinista por (device, colección, spool_seq): reenviar da el mismo uid", () => {
    expect(uid(DEV, "eventos", 42)).toBe(`${DEV}:eventos:42`);
    expect(filaEvento(DEV, { spool_seq: 42, kind: "lock", occurred_at: "2026-09-01T13:00:00Z" }).event_uid)
      .toBe(filaEvento(DEV, { spool_seq: 42, kind: "lock", occurred_at: "2026-09-01T13:00:00Z" }).event_uid);
    expect(filaVisita(DEV, { spool_seq: 7, shift_id: SHIFT, entered_at: "2026-09-01T13:00:00Z" }).visit_uid).toBe(`${DEV}:visitas:7`);
  });

  it("el seq de una muestra es el segmento de la cubeta, y el rechazo reporta el spool_seq (no el de la cubeta)", () => {
    const m = filaMuestra(DEV, { spool_seq: 900, seq: 1, shift_id: SHIFT, bucket_start: "2026-09-01T13:00:00Z", app: "sap" });
    expect(m.seq).toBe(1);
    const rejected: Rechazo[] = [];
    construir("samples", [{ spool_seq: 901, seq: 0, shift_id: SHIFT, bucket_start: "2026-09-01T13:00:00Z", surface: TITULO }], (r) => filaMuestra(DEV, r), rejected);
    expect(rejected[0].seq).toBe(901);
  });

  it("una fila envenenada va a rejected[] con su seq y el resto del lote sigue", () => {
    const rejected: Rechazo[] = [];
    const filas = construir("samples", [
      { spool_seq: 1, shift_id: SHIFT, bucket_start: "2026-09-01T13:00:00Z", app: "sap", surface: "sapgui://PRD/NV2000/SAPMNPA10/0100", active_ms: 1000 },
      { spool_seq: 2, shift_id: SHIFT, bucket_start: "2026-09-01T13:00:15Z", app: "chrome", surface: TITULO },
      { spool_seq: 3, shift_id: "no-es-uuid", bucket_start: "2026-09-01T13:00:30Z" },
      { spool_seq: 4, shift_id: SHIFT, bucket_start: "2026-09-01T13:00:45Z", app: "otro" },
    ], (r) => filaMuestra(DEV, r), rejected);
    expect(filas).toHaveLength(2);
    expect(rejected.map((r) => r.seq)).toEqual([2, 3]);
    expect(rejected[0].reason).toMatch(/surface/);
  });

  it("un turno normaliza la causa de cierre a un conjunto cerrado y no se cree cualquier fecha", () => {
    const t = filaTurno({ shift_id: SHIFT, started_at: "2026-09-01T12:00:00Z", ended_at: "2026-09-01T18:00:00Z", end_reason: "manual", dia_operativo: "2026-09-01", doctor_display: "Dra. X" });
    expect(t.end_reason).toBe("manual");
    expect(t.dia_operativo).toBe("2026-09-01");
    expect(filaTurno({ shift_id: SHIFT, started_at: "2026-09-01T12:00:00Z", end_reason: "se fue" }).end_reason).toBe("desconocido");
    expect(filaTurno({ shift_id: SHIFT, started_at: "2026-09-01T12:00:00Z", dia_operativo: "ayer" }).dia_operativo).toBeNull();
    expect(() => filaTurno({ shift_id: SHIFT, started_at: "cuando sea" })).toThrow(/started_at/);
  });

  it("la app se normaliza a minúscula y un nombre raro se rechaza", () => {
    expect(filaMuestra(DEV, { shift_id: SHIFT, bucket_start: "2026-09-01T13:00:00Z", app: "SAP" }).app).toBe("sap");
    expect(() => filaMuestra(DEV, { shift_id: SHIFT, bucket_start: "2026-09-01T13:00:00Z", app: "Juan Pérez.exe" })).toThrow(/app/);
  });
});
