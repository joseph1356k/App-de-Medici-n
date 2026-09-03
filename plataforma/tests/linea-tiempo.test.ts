// La geometría de la línea de tiempo, como lógica pura: ventana, escala, plegado sub-píxel,
// pacientes, marcas. Un día sintético (tests/fixtures/dia-sintetico.ts) hace de base.
import { describe, it, expect } from "vitest";
import {
  ANCHO, agruparMarcas, escalaX, fusionar, horaLocal, indicePacientes, topApps,
  tramosApp, tramosEstado, tramosPacientes, tramosSap, ventanaAuto, ventanaDesdeQuery,
} from "../lib/linea-tiempo";
import { A, B, C, DIA0, FECHA, diaSintetico, hora, marca, visita } from "./fixtures/dia-sintetico";

const HORA = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

describe("escalaX", () => {
  it("0 al principio, 1000 al final, 500 en medio; ticks por hora en 8 h", () => {
    const esc = escalaX({ desde: hora("07:00"), hasta: hora("15:00") });
    expect(esc.x(hora("07:00"))).toBe(0);
    expect(esc.x(hora("15:00"))).toBe(ANCHO);
    expect(esc.x(hora("11:00"))).toBe(500);
    expect(esc.pct(hora("11:00"))).toBe(50);
    expect(esc.ticks).toHaveLength(9);
    expect(esc.ticks[0].etiqueta).toBe("07:00");
    expect(esc.ticks[8].etiqueta).toBe("15:00");
    expect(esc.ticks.map((t) => t.x)).toEqual([0, 125, 250, 375, 500, 625, 750, 875, 1000]);
  });

  it("acota fuera de la ventana y pone ticks cada 30 min en 4 h y cada 2 h en el día entero", () => {
    const corta = escalaX({ desde: hora("08:00"), hasta: hora("12:00") });
    expect(corta.x(hora("06:00"))).toBe(0);
    expect(corta.x(hora("20:00"))).toBe(ANCHO);
    expect(corta.ticks).toHaveLength(9);
    expect(corta.ticks[1].etiqueta).toBe("08:30");
    const dia = escalaX({ desde: DIA0, hasta: DIA0 + 24 * HORA });
    expect(dia.ticks).toHaveLength(13);
    expect(dia.ticks.map((t) => t.etiqueta).slice(0, 3)).toEqual(["06:00", "08:00", "10:00"]);
    // el paso de 2 h se alinea a la hora par de Bogotá aunque la ventana empiece impar
    const impar = escalaX({ desde: hora("07:00"), hasta: hora("07:00") + 20 * HORA });
    expect(impar.ticks[0].etiqueta).toBe("08:00");
  });

  it("horaLocal cruza la medianoche y el cambio de día", () => {
    expect(horaLocal(hora("23:59"))).toBe("23:59");
    expect(horaLocal(hora("00:30"))).toBe("00:30");
    expect(horaLocal(DIA0 + 24 * HORA)).toBe("06:00");
  });
});

describe("fusionar", () => {
  it("5 760 cubetas alternas quedan en ≤ 1 000 tramos, sin perder un milisegundo ni bajar de un píxel", () => {
    const d = diaSintetico([{ desde: "06:00", hasta: "06:00", app: "sap", alterna: "chrome", encounter: A }]);
    // «06:00»–«06:00» es el día entero: hora() manda la segunda al día siguiente
    expect(d.segmentos.length).toBe(5760);
    const esc = escalaX({ desde: DIA0, hasta: DIA0 + 24 * HORA });
    const tramos = tramosApp(d.segmentos, esc, ["sap", "chrome"]);
    expect(tramos.length).toBeLessThanOrEqual(1000);
    expect(tramos.length).toBeGreaterThan(100);
    const ms = tramos.reduce((s, t) => s + t.ms, 0);
    expect(ms).toBe(5760 * 15_000);
    for (const t of tramos) expect(t.x1 - t.x0).toBeGreaterThanOrEqual(1 - 1e-9);
    for (let i = 1; i < tramos.length; i++) expect(tramos[i].x0).toBeGreaterThanOrEqual(tramos[i - 1].x1 - 1e-9);
    expect(tramos[0].mezcla).toBeDefined();
    expect(Object.keys(tramos[0].mezcla!).sort()).toEqual(["chrome", "sap"]);
  });

  it("no funde a través de un hueco, y sí funde la misma clave contigua aunque cambie el paciente", () => {
    const d = diaSintetico([
      { desde: "08:00", hasta: "09:00", app: "sap", encounter: A },
      { desde: "09:00", hasta: "09:30", app: "sap", encounter: B },
      { desde: "10:00", hasta: "11:00", app: "sap", encounter: B },
    ]);
    const esc = escalaX({ desde: hora("07:00"), hasta: hora("15:00") });
    const apps = tramosApp(d.segmentos, esc, ["sap"]);
    expect(apps.map((t) => [horaLocal(t.t0), horaLocal(t.t1), t.clave, t.n])).toEqual([["08:00", "09:30", "sap", 2], ["10:00", "11:00", "sap", 1]]);
    const estado = tramosEstado(d.segmentos, esc);
    expect(estado.map((t) => t.clave)).toEqual(["activo", "sin_datos", "activo"]);
    expect(estado[1].ms).toBe(30 * 60_000);
    expect(estado.reduce((s, t) => s + t.ms, 0)).toBe(3 * HORA);
  });

  it("descarta lo que cae fuera de la ventana y respeta un accesor de ms propio", () => {
    const esc = escalaX({ desde: hora("08:00"), hasta: hora("12:00") });
    const items = [
      { a: hora("06:00"), b: hora("07:00"), k: "x", peso: 5 },
      { a: hora("09:00"), b: hora("10:00"), k: "x", peso: 7 },
      { a: hora("10:00"), b: hora("11:00"), k: "x", peso: 1 },
      { a: hora("13:00"), b: hora("14:00"), k: "x", peso: 9 },
    ];
    const t = fusionar(items, { inicio: (i) => i.a, fin: (i) => i.b, clave: (i) => i.k, ms: (i) => i.peso }, esc);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ x0: 250, x1: 750, ms: 8, n: 2 });
  });

  it("un tramo sub-píxel entre dos grandes se ensancha a un píxel sin pisar al siguiente", () => {
    const esc = escalaX({ desde: hora("06:00"), hasta: hora("06:00") + 24 * HORA });
    const items = [
      { a: hora("08:00"), b: hora("10:00"), k: "sap" },
      { a: hora("10:00"), b: hora("10:00") + 15_000, k: "chrome" },
      { a: hora("10:00") + 15_000, b: hora("12:00"), k: "sap" },
    ];
    const t = fusionar(items, { inicio: (i) => i.a, fin: (i) => i.b, clave: (i) => i.k }, esc);
    expect(t.map((x) => x.clave)).toEqual(["sap", "chrome", "sap"]);
    expect(t[1].x1 - t[1].x0).toBeCloseTo(1, 6);
    expect(t[2].x0).toBeCloseTo(t[1].x1, 6);
    expect(t.reduce((s, x) => s + x.ms, 0)).toBe(4 * HORA);
  });
});

describe("tramosPacientes", () => {
  it("A→B→A da tres tramos y el índice numera por primera aparición", () => {
    const d = diaSintetico([
      { desde: "08:00", hasta: "08:30", encounter: A },
      { desde: "08:30", hasta: "09:00", encounter: B },
      { desde: "09:00", hasta: "09:20", encounter: A },
      { desde: "09:20", hasta: "09:40", encounter: null, app: "chrome" },
      { desde: "09:40", hasta: "10:00", encounter: C },
    ]);
    const esc = escalaX({ desde: hora("07:00"), hasta: hora("15:00") });
    const { tramos, indice } = tramosPacientes(d.segmentos, d.pacientes, esc);
    expect(tramos.map((t) => t.clave)).toEqual([A, B, A, C]);
    expect(indice).toEqual({ [A]: 1, [B]: 2, [C]: 3 });
    expect(tramos.slice(0, 3).map((t) => t.ms)).toEqual([30 * 60_000, 30 * 60_000, 20 * 60_000]);
    expect(indicePacientes(d.segmentos, [])).toEqual({ [A]: 1, [B]: 2, [C]: 3 });
  });
});

describe("tramosSap y agruparMarcas", () => {
  it("una visita abierta termina en «ahora» y la espera se convierte en fracción", () => {
    const esc = escalaX({ desde: hora("07:00"), hasta: hora("15:00") });
    const abierta = visita("NWP1", "09:00", 0, { left_at: null, dwell_ms: 0, sap_wait_ms: 0 });
    const t = tramosSap([visita("NV2000", "08:00", 60, { sap_wait_ms: 15_000 }), abierta, visita("XX", "16:00", 60)], esc, hora("09:30"));
    expect(t).toHaveLength(2);
    expect(t[0].esperaFrac).toBeCloseTo(0.25, 6);
    expect(horaLocal(t[1].t1)).toBe("09:30");
    expect(t[1].x1 - t[1].x0).toBeCloseTo(62.5, 6);
  });

  it("los eventos a menos de 8 unidades se agrupan y los de fuera de la ventana se descartan", () => {
    const esc = escalaX({ desde: hora("07:00"), hasta: hora("15:00") }); // 1 min ≈ 2,08 unidades
    const g = agruparMarcas([marca("lock", "08:00"), marca("unlock", "08:03"), marca("resume", "12:00"), marca("suspend", "05:00")], esc);
    expect(g).toHaveLength(2);
    expect(g[0].marcas.map((m) => m.kind)).toEqual(["lock", "unlock"]);
    expect(g[1].marcas.map((m) => m.kind)).toEqual(["resume"]);
    expect(g[0].x).toBe(125);
  });

  it("topApps ordena por tiempo delante y deja fuera «bloqueado»", () => {
    const d = diaSintetico([
      { desde: "08:00", hasta: "10:00", app: "sap" },
      { desde: "10:00", hasta: "10:30", app: "chrome", surface: null },
      { desde: "10:30", hasta: "13:00", bloqueado: true },
      { desde: "13:00", hasta: "13:10", app: "office", surface: null },
    ]);
    expect(topApps(d.segmentos)).toEqual(["sap", "chrome", "office"]);
    expect(topApps(d.segmentos, 1)).toEqual(["sap"]);
  });
});

describe("ventanaAuto", () => {
  it("un día vacío se ve de 07:00 a 15:00", () => {
    const v = ventanaAuto(diaSintetico([]), iso(hora("15:00") + 10 * 24 * HORA));
    expect([horaLocal(v.desde), horaLocal(v.hasta)]).toEqual(["07:00", "15:00"]);
  });

  it("se ajusta a la actividad redondeada a la hora, con un mínimo de 8 h", () => {
    const v = ventanaAuto(diaSintetico([{ desde: "08:20", hasta: "10:40" }]), iso(DIA0 + 3 * 24 * HORA));
    expect([horaLocal(v.desde), horaLocal(v.hasta)]).toEqual(["08:00", "16:00"]);
    const larga = ventanaAuto(diaSintetico([{ desde: "07:05", hasta: "18:50" }]), iso(DIA0 + 3 * 24 * HORA));
    expect([horaLocal(larga.desde), horaLocal(larga.hasta)]).toEqual(["07:00", "19:00"]);
  });

  it("hoy crece hasta «ahora», y nunca se sale del día operativo", () => {
    const hoy = ventanaAuto(diaSintetico([{ desde: "08:00", hasta: "10:00" }]), iso(hora("17:20")));
    expect([horaLocal(hoy.desde), horaLocal(hoy.hasta)]).toEqual(["08:00", "18:00"]);
    const noche = ventanaAuto(diaSintetico([{ desde: "03:00", hasta: "05:30" }]), iso(DIA0 + 3 * 24 * HORA));
    expect(noche.hasta).toBe(DIA0 + 24 * HORA);
    expect(horaLocal(noche.desde)).toBe("22:00");
    const madrugada = ventanaAuto(diaSintetico([{ desde: "06:00", hasta: "06:30" }]), iso(hora("06:40")));
    expect(madrugada.desde).toBe(DIA0);
    expect(horaLocal(madrugada.hasta)).toBe("14:00");
  });

  it("los segmentos inactivos o bloqueados sirven cuando no hay ninguno activo", () => {
    const v = ventanaAuto(diaSintetico([{ desde: "09:00", hasta: "11:00", bloqueado: true }]), iso(DIA0 + 3 * 24 * HORA));
    expect([horaLocal(v.desde), horaLocal(v.hasta)]).toEqual(["09:00", "17:00"]);
  });
});

describe("ventanaDesdeQuery", () => {
  const base = { desde: hora("07:00"), hasta: hora("15:00") };
  it("lee HH:MM de Bogotá dentro del día operativo y las madrugadas caen al día siguiente", () => {
    const v = ventanaDesdeQuery(base, FECHA, "06:30", "12:00");
    expect([horaLocal(v.desde), horaLocal(v.hasta)]).toEqual(["06:30", "12:00"]);
    const noche = ventanaDesdeQuery(base, FECHA, "22:00", "02:00");
    expect(noche.hasta - noche.desde).toBe(4 * HORA);
    expect(ventanaDesdeQuery(base, FECHA, "20:00", "06:00").hasta).toBe(DIA0 + 24 * HORA);
  });
  it("lo inválido o vacío devuelve la base; un solo extremo completa con la base", () => {
    expect(ventanaDesdeQuery(base, FECHA, null, null)).toBe(base);
    expect(ventanaDesdeQuery(base, FECHA, "25:00", "x")).toBe(base);
    expect(ventanaDesdeQuery(base, FECHA, "12:00", "09:00")).toBe(base);
    const solo = ventanaDesdeQuery(base, FECHA, "09:00", null);
    expect([horaLocal(solo.desde), horaLocal(solo.hasta)]).toEqual(["09:00", "15:00"]);
  });
});
