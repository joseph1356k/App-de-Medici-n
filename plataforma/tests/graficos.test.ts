// La aritmética de los gráficos, con números a mano. Lo que se prueba aquí es justo lo que se
// equivoca en silencio: una escala que no llega, una banda que deja un hueco donde el ratón se
// pierde, un porcentaje que no suma 100, un «—» convertido en cero.
import { describe, it, expect } from "vitest";
import {
  COLOR_SERIE, LIMITES_ESPERA, apilar, bandas, colorConsultorio, cubetaDeEspera, cubetasEspera,
  mediana, medianaPorDia, posicionEnCubetas, rectRedondeadoArriba, seriesATabla, topN, topeBonito,
} from "../lib/graficos";

describe("topeBonito", () => {
  it("sube al siguiente número redondo, y nunca deja el máximo fuera del eje", () => {
    expect(topeBonito(6.37)).toBe(8);
    expect(topeBonito(0.9)).toBe(1);
    expect(topeBonito(120)).toBe(150);
    expect(topeBonito(1000)).toBe(1000);
    for (const v of [0.3, 7, 43, 999, 12345]) expect(topeBonito(v)).toBeGreaterThanOrEqual(v);
  });

  it("sin datos el eje sigue existiendo: 0 y lo imposible dan 1, no NaN ni infinito", () => {
    expect(topeBonito(0)).toBe(1);
    expect(topeBonito(-5)).toBe(1);
    expect(topeBonito(NaN)).toBe(1);
  });
});

describe("bandas", () => {
  it("cubren el eje ENTERO sin huecos: apuntar a una fecha no puede fallar", () => {
    const b = bandas(5, 60, 1000);
    expect(b[0].x0).toBe(60);
    expect(b[4].x1).toBe(1000);
    for (let i = 1; i < b.length; i++) expect(b[i].x0).toBeCloseTo(b[i - 1].x1, 6);
    expect(b.reduce((s, x) => s + (x.x1 - x.x0), 0)).toBeCloseTo(940, 6);
  });

  it("con un solo punto la banda es todo el ancho, y el centro va en medio", () => {
    const [b] = bandas(1, 0, 100);
    expect(b).toEqual({ x0: 0, x1: 100, cx: 50 });
  });

  it("sin puntos no hay bandas", () => expect(bandas(0, 0, 100)).toEqual([]));
});

describe("apilar", () => {
  it("cada tramo empieza donde acabó el anterior", () => {
    expect(apilar([10, 5, 2])).toEqual([{ y0: 0, y1: 10 }, { y0: 10, y1: 15 }, { y0: 15, y1: 17 }]);
  });

  it("un negativo no resta: en una barra apilada no significa nada", () => {
    expect(apilar([10, -4, 3])).toEqual([{ y0: 0, y1: 10 }, { y0: 10, y1: 10 }, { y0: 10, y1: 13 }]);
  });
});

describe("topN", () => {
  const resto = (suma: number, cuantos: number) => ({ n: `resto (${cuantos})`, v: suma });
  it("pliega la cola en una sola entrada, con su suma", () => {
    const items = [{ n: "a", v: 10 }, { n: "b", v: 8 }, { n: "c", v: 3 }, { n: "d", v: 1 }];
    expect(topN(items, 2, (x) => x.v, resto)).toEqual([{ n: "a", v: 10 }, { n: "b", v: 8 }, { n: "resto (2)", v: 4 }]);
  });

  it("si cabe todo no inventa una fila de resto, y una cola de ceros tampoco", () => {
    const items = [{ n: "a", v: 10 }, { n: "b", v: 0 }];
    expect(topN(items, 5, (x) => x.v, resto)).toHaveLength(2);
    expect(topN(items, 1, (x) => x.v, resto)).toEqual([{ n: "a", v: 10 }]);
  });
});

describe("seriesATabla", () => {
  it("la tabla dice lo mismo que el dibujo, y lo no medido sale «—», nunca 0", () => {
    const t = seriesATabla(["lun", "mar"], [
      { id: "1", nombre: "Consultorio 1", color: "x", valores: [60000, null] },
      { id: "2", nombre: "Consultorio 2", color: "y", valores: [null, 120000] },
    ], (v) => `${v / 60000} min`, "Día");
    expect(t.columnas).toEqual(["Día", "Consultorio 1", "Consultorio 2"]);
    expect(t.filas).toEqual([["lun", "1 min", "—"], ["mar", "—", "2 min"]]);
  });
});

describe("mediana y medianaPorDia", () => {
  it("par e impar, y lo no medido no cuenta", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([null, 5, undefined])).toBe(5);
    expect(mediana([null, null])).toBeNull();
    expect(mediana([])).toBeNull();
  });

  it("un día sin jornadas es null —hueco en la línea— y no un cero que diría «no trabajó nadie»", () => {
    const puntos = [
      { fecha: "2026-09-01", valor: 10 }, { fecha: "2026-09-01", valor: 20 },
      { fecha: "2026-09-03", valor: 7 },
    ];
    expect(medianaPorDia(puntos, ["2026-09-01", "2026-09-02", "2026-09-03"])).toEqual([15, null, 7]);
  });
});

describe("las cubetas de espera de SAP", () => {
  it("cada espera cae en su tramo, y los bordes van al de arriba", () => {
    expect(cubetaDeEspera(0)).toBe(0);
    expect(cubetaDeEspera(999)).toBe(0);
    expect(cubetaDeEspera(1000)).toBe(1);
    expect(cubetaDeEspera(2400)).toBe(2);   // la mediana real del HGM
    expect(cubetaDeEspera(46000)).toBe(5);  // su p95
    expect(cubetaDeEspera(200000)).toBe(6); // su p99
    expect(cubetaDeEspera(LIMITES_ESPERA[LIMITES_ESPERA.length - 1])).toBe(6);
  });

  it("los porcentajes suman 100, y sin visitas son ceros, no NaN", () => {
    const c = cubetasEspera([10, 20, 30, 20, 10, 5, 5]);
    expect(c).toHaveLength(7);
    expect(c.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 6);
    const vacio = cubetasEspera([]);
    expect(vacio.every((x) => x.n === 0 && x.pct === 0)).toBe(true);
  });

  it("la marca del p50 cae DENTRO de su tramo, no en el centro de la columna", () => {
    const p = posicionEnCubetas(2400);
    expect(p).toBeGreaterThan(2);
    expect(p).toBeLessThan(3);
    expect(posicionEnCubetas(500)).toBeGreaterThanOrEqual(0);
    expect(posicionEnCubetas(500)).toBeLessThan(1);
    expect(posicionEnCubetas(200000)).toBeGreaterThanOrEqual(6);
    expect(Number.isFinite(posicionEnCubetas(0))).toBe(true);
  });
});

describe("rectRedondeadoArriba", () => {
  it("redondea arriba y deja la base cuadrada sobre el cero", () => {
    const d = rectRedondeadoArriba(10, 20, 24, 100, 4);
    expect(d).toContain("a4,4");
    expect(d.split("a4,4").length - 1).toBe(2); // las dos esquinas de arriba, y solo esas
  });

  it("una barra más baja que el radio sale recta: una pastilla no se lee como un valor", () => {
    expect(rectRedondeadoArriba(0, 0, 24, 2, 4)).not.toContain("a");
    expect(rectRedondeadoArriba(0, 0, 24, 0, 4)).toBe("");
  });
});

describe("colorConsultorio", () => {
  it("el color va con la ENTIDAD: filtrar un consultorio no repinta a los demás", () => {
    expect(colorConsultorio(1)).toBe(COLOR_SERIE[0]);
    expect(colorConsultorio(2)).toBe(COLOR_SERIE[1]);
    expect(colorConsultorio(3)).toBe(COLOR_SERIE[2]);
  });

  it("«sin consultorio» va en gris, nunca en un slot de serie", () => {
    expect(colorConsultorio(999)).toBe("var(--color-otro)");
    expect(colorConsultorio(0)).toBe("var(--color-otro)");
  });
});
