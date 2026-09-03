// La línea de tiempo como lógica pura: cubetas sintéticas → segmentos, pacientes y médicos.
import { describe, it, expect } from "vitest";
import { medicosVistos, pacientesDelDia, segmentar, tcodeDe, totalesPorEstado, type Bucket } from "../lib/segmentos";

const T0 = Date.parse("2026-09-01T13:00:00Z");
const A = "a".repeat(32), B = "b".repeat(32);
const SAP = "sapgui://PRD/NV2000/SAPMNPA10/0100";

function cubeta(i: number, extra: Partial<Bucket> = {}): Bucket {
  return {
    bucket_start: new Date(T0 + i * 15000).toISOString(), bucket_ms: 15000, seq: 0,
    app: "sap", surface: SAP, encounter_key: A, sap_user: "MED01",
    foreground_ms: 15000, active_ms: 12000, typing_ms: 3000, keystrokes: 20, clicks: 3, sap_wait_ms: 200,
    ...extra,
  };
}
const dur = (s: { inicio: string; fin: string }) => Date.parse(s.fin) - Date.parse(s.inicio);

describe("segmentar", () => {
  it("cuatro cubetas iguales y seguidas son un solo segmento de 60 s con los contadores sumados", () => {
    const segs = segmentar([0, 1, 2, 3].map((i) => cubeta(i)));
    expect(segs).toHaveLength(1);
    expect(dur(segs[0])).toBe(60_000);
    expect(segs[0]).toMatchObject({ estado: "activo", app: "sap", tcode: "NV2000", encounter_key: A, sap_user: "MED01", active_ms: 48_000, keystrokes: 80, clicks: 12, cubetas: 4 });
  });

  it("un cambio de app, de paciente o de usuario corta el segmento", () => {
    const segs = segmentar([cubeta(0), cubeta(1, { app: "chrome", surface: null }), cubeta(2), cubeta(3, { encounter_key: B }), cubeta(4, { encounter_key: B, sap_user: "MED02" })]);
    expect(segs.map((s) => [s.app, s.encounter_key, s.sap_user])).toEqual([["sap", A, "MED01"], ["chrome", A, "MED01"], ["sap", A, "MED01"], ["sap", B, "MED01"], ["sap", B, "MED02"]]);
  });

  it("sin input es inactivo; con app bloqueado es bloqueado", () => {
    const segs = segmentar([cubeta(0, { active_ms: 0 }), cubeta(1, { app: "bloqueado", surface: null, encounter_key: null, sap_user: null, active_ms: 0 })]);
    expect(segs.map((s) => s.estado)).toEqual(["inactivo", "bloqueado"]);
  });

  it("un hueco de 45 s abre un segmento sin_datos exacto y no funde a través de él", () => {
    const segs = segmentar([cubeta(0), cubeta(1), cubeta(4), cubeta(5)]); // falta 2 y 3: 30 s sin cubeta entre el fin de 1 y el inicio de 4
    // fin de 1 = T0+30 s, inicio de 4 = T0+60 s → hueco de exactamente 30 s: se tolera (<= 30 s)
    expect(segs).toHaveLength(1);
    const conHueco = segmentar([cubeta(0), cubeta(1), cubeta(5), cubeta(6)]); // hueco de 45 s
    expect(conHueco.map((s) => s.estado)).toEqual(["activo", "sin_datos", "activo"]);
    expect(conHueco[1].inicio).toBe(new Date(T0 + 30_000).toISOString());
    expect(conHueco[1].fin).toBe(new Date(T0 + 75_000).toISOString());
    expect(dur(conHueco[1])).toBe(45_000);
  });

  it("dentro de una cubeta, las partes se reparten los 15 s en proporción a su foreground y quedan contiguas", () => {
    const segs = segmentar([cubeta(0, { seq: 0, foreground_ms: 9000, active_ms: 9000 }), cubeta(0, { seq: 1, app: "chrome", surface: null, foreground_ms: 6000, active_ms: 6000 })]);
    expect(segs).toHaveLength(2);
    expect(dur(segs[0])).toBe(9_000);
    expect(segs[1].inicio).toBe(segs[0].fin);
    expect(dur(segs[1])).toBe(6_000);
    expect(segs[1].fin).toBe(new Date(T0 + 15_000).toISOString());
  });

  it("las cubetas llegan desordenadas y aun así el resultado es cronológico", () => {
    const segs = segmentar([cubeta(2), cubeta(0), cubeta(1)]);
    expect(segs).toHaveLength(1);
    expect(dur(segs[0])).toBe(45_000);
  });

  it("los totales por estado suman el día entero, huecos incluidos", () => {
    const segs = segmentar([cubeta(0), cubeta(1, { active_ms: 0 }), cubeta(5, { app: "bloqueado", surface: null, encounter_key: null, sap_user: null, active_ms: 0 })]);
    const t = totalesPorEstado(segs);
    expect(t).toEqual({ activo: 15_000, inactivo: 15_000, sin_datos: 45_000, bloqueado: 15_000 });
  });

  it("una fila fundida vale por todo su tramo, no por 15 s", () => {
    // El medidor funde en UNA fila los tramos en los que no pasa nada (una noche bloqueado son
    // unas pocas filas, no miles). Si aquí se diera por hecho 15 s, ese tiempo desaparecería del
    // dibujo y de los totales.
    const bloqueo = cubeta(4, { app: "bloqueado", surface: null, encounter_key: null, sap_user: null, active_ms: 0, bucket_ms: 600_000, foreground_ms: 600_000 });
    const segs = segmentar([cubeta(0), cubeta(1), cubeta(2), cubeta(3), bloqueo]);
    expect(segs.map((s) => s.estado)).toEqual(["activo", "bloqueado"]);
    expect(dur(segs[1])).toBe(600_000);
    expect(segs[1].inicio).toBe(segs[0].fin); // pegada a lo anterior: sin hueco inventado
    expect(totalesPorEstado(segs)).toEqual({ activo: 60_000, inactivo: 0, bloqueado: 600_000, sin_datos: 0 });
  });

  it("y tras una fila fundida el hueco se mide desde donde de verdad terminó", () => {
    const bloqueo = cubeta(0, { app: "bloqueado", surface: null, encounter_key: null, sap_user: null, active_ms: 0, bucket_ms: 600_000, foreground_ms: 600_000 });
    // La siguiente cubeta empieza justo al acabar el tramo: contiguo, sin «sin datos».
    const pegada = cubeta(40);
    expect(segmentar([bloqueo, pegada]).map((s) => s.estado)).toEqual(["bloqueado", "activo"]);
    // Una que empieza 45 s después del fin del tramo sí abre un hueco.
    const tarde = cubeta(43);
    const conHueco = segmentar([bloqueo, tarde]);
    expect(conHueco.map((s) => s.estado)).toEqual(["bloqueado", "sin_datos", "activo"]);
    expect(dur(conHueco[1])).toBe(45_000);
  });

  it("tcodeDe saca la transacción de la pantalla SAP", () => {
    expect(tcodeDe(SAP)).toBe("NV2000");
    expect(tcodeDe("sapgui://PRD//SAPMSYST/0100")).toBeNull();
    expect(tcodeDe("web://itsmiracleai.com.co")).toBeNull();
    expect(tcodeDe(null)).toBeNull();
  });
});

describe("pacientesDelDia", () => {
  it("A→B→A: A tiene dos tramos, B uno; la consulta va en reloj de pared; las visitas se cuentan por huella", () => {
    const segs = segmentar([cubeta(0), cubeta(1), cubeta(2, { encounter_key: B }), cubeta(3, { encounter_key: B }), cubeta(4), cubeta(5, { encounter_key: null, app: "chrome", surface: null })]);
    const p = pacientesDelDia(segs, [{ encounter_key: A }, { encounter_key: A }, { encounter_key: B }, { encounter_key: null }]);
    expect(p.map((x) => x.encounter_key)).toEqual([A, B]);
    expect(p[0]).toMatchObject({ tramos: 2, visitas: 2, consulta_ms: 75_000, activo_ms: 36_000 });
    expect(p[1]).toMatchObject({ tramos: 1, visitas: 1, consulta_ms: 30_000 });
    expect(p[0].primera_vez).toBe(new Date(T0).toISOString());
    expect(p[0].ultima_vez).toBe(new Date(T0 + 75_000).toISOString());
  });
});

describe("medicosVistos", () => {
  it("las rachas de usuario SAP no se cortan por segmentos sin usuario y toman el nombre del roster", () => {
    const segs = segmentar([cubeta(0), cubeta(1, { app: "chrome", surface: null, sap_user: null }), cubeta(2), cubeta(3, { sap_user: "MED02" })]);
    const m = medicosVistos(segs, [{ id: "x", display_name: "Dra. Uno", sap_users: ["MED01"] }]);
    expect(m).toEqual([
      { sap_user: "MED01", nombre: "Dra. Uno", desde: new Date(T0).toISOString(), hasta: new Date(T0 + 45_000).toISOString() },
      { sap_user: "MED02", nombre: null, desde: new Date(T0 + 45_000).toISOString(), hasta: new Date(T0 + 60_000).toISOString() },
    ]);
  });
});

// EL RELOJ DE PARED QUE SE ARRASTRA. Los PCs del HGM numeran las cubetas con la hora del
// sistema y las llenan con ticks medidos en el reloj monotónico; cuando la hora del sistema se
// corrige hacia atrás en pasitos, todos los ticks de ese rato caen en la MISMA cubeta y la
// siguiente aparece minutos después. El tiempo está medido —dentro de esa fila— y el dibujo
// tiene que enseñarlo, no convertirlo en un agujero de «sin datos».
describe("una cubeta cubre lo que midió, no lo que suponemos", () => {
  it("una cubeta con 180 s de foreground cubre 180 s, y no abre un hueco hasta la siguiente", () => {
    const segs = segmentar([
      cubeta(0),
      { ...cubeta(1), foreground_ms: 180_000, active_ms: 0 },   // 12 cubetas de ticks en una fila
      cubeta(13),                                               // la siguiente, 180 s después
    ]);
    expect(segs.some((s) => s.estado === "sin_datos")).toBe(false);
    expect(dur(segs[1])).toBe(180_000);
    expect(Date.parse(segs[1].fin)).toBe(Date.parse(segs[2].inicio));
  });

  it("pero nunca se pasa de la cubeta siguiente: si la siguiente llega a los 15 s, cubre 15 s", () => {
    const segs = segmentar([
      { ...cubeta(0), foreground_ms: 180_000, active_ms: 0, app: "chrome", surface: null },
      cubeta(1),
    ]);
    expect(dur(segs[0])).toBe(15_000);
  });

  it("un hueco de verdad (sin cubetas y sin foreground que lo explique) sigue siendo «sin datos»", () => {
    const segs = segmentar([cubeta(0), cubeta(20)]);
    expect(segs.map((s) => s.estado)).toEqual(["activo", "sin_datos", "activo"]);
  });

  it("la última cubeta no tiene siguiente que la limite: cubre lo que midió", () => {
    const segs = segmentar([cubeta(0), { ...cubeta(1), foreground_ms: 120_000, active_ms: 0, app: "chrome", surface: null }]);
    expect(dur(segs[1])).toBe(120_000);
  });
});
