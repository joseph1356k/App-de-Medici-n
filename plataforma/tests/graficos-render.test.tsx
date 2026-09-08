// Los gráficos, dibujados de verdad. Se comprueba el HTML que sale del servidor, que es donde
// aparecen los fallos que no se ven leyendo el código: un NaN en una coordenada, una leyenda que
// falta, una tabla gemela vacía, o —lo más importante— una marca sin los data-* con los que el
// envoltorio interactivo construye el globo. Sin esos atributos el gráfico se dibuja igual y no
// responde al ratón, que es la clase de fallo que llega a producción.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Lineas, Tendencia } from "../components/graficos/Lineas";
import { Columnas } from "../components/graficos/Columnas";
import { Barras } from "../components/graficos/Barras";
import { Histograma } from "../components/graficos/Histograma";
import { Interactivo } from "../components/graficos/Interactivo";
import { Cifra } from "../components/Cifra";

const XS = ["2026-09-01", "2026-09-02", "2026-09-03"];
const SERIES = [
  { id: "c1", nombre: "Consultorio 1", color: "var(--color-s1)", valores: [60000, null, 90000] },
  { id: "c2", nombre: "Consultorio 2", color: "var(--color-s2)", valores: [30000, 45000, 50000] },
];
const min = (v: number) => `${Math.round(v / 60000)} min`;
const html = (n: React.ReactNode) => renderToStaticMarkup(n as React.ReactElement);

describe("Lineas", () => {
  const salida = html(<Lineas xs={XS} etiquetaX={(x) => x.slice(8)} etiquetaLarga={(x) => `día ${x}`} series={SERIES} fmt={min} ariaLabel="prueba" />);

  it("no escupe NaN ni undefined en ninguna coordenada", () => expect(salida).not.toMatch(/NaN|undefined/));
  it("es un lienzo de 1000 de ancho, como el resto del panel", () => expect(salida).toContain('viewBox="0 0 1000 280"'));

  it("cada punto lleva lo que el globo necesita, ya formateado", () => {
    expect(salida).toContain('data-serie="Consultorio 1"');
    expect(salida).toContain('data-valor="1 min"');
    expect(salida).toContain('data-color="var(--color-s1)"');
  });

  it("las zonas de golpe cubren el eje y llevan la etiqueta larga", () => {
    expect(salida).toContain('data-cx=');
    expect(salida).toContain('data-etiqueta="día 2026-09-02"');
    expect((salida.match(/data-cx=/g) ?? [])).toHaveLength(XS.length);
  });

  it("con dos series hay leyenda, y con una no", () => {
    expect(salida).toContain("grafico__leyenda");
    expect(html(<Lineas xs={XS} etiquetaX={(x) => x} series={[SERIES[0]]} fmt={min} ariaLabel="p" />)).not.toContain("grafico__leyenda");
  });

  it("lleva su tabla gemela, con «—» donde no se midió", () => {
    expect(salida).toContain("Ver tabla");
    expect(salida).toContain("—");
    expect(html(<Lineas xs={XS} etiquetaX={(x) => x} series={SERIES} fmt={min} ariaLabel="p" sinTabla />)).not.toContain("Ver tabla");
  });

  it("se puede llegar con el teclado", () => expect(salida).toContain('tabindex="0"'));

  it("sin datos no dibuja un lienzo vacío: dice que no hay", () => {
    const vacio = html(<Lineas xs={[]} etiquetaX={(x) => x} series={[]} fmt={min} ariaLabel="p" />);
    expect(vacio).toContain("grafico__vacio");
    expect(vacio).not.toContain("<svg");
  });

  it("un día sin medir PARTE la línea en vez de bajar a cero", () => {
    // La serie 1 tiene un hueco en medio: dos trazos, no uno.
    const trazos = (salida.match(/<path d="M/g) ?? []).length;
    expect(trazos).toBeGreaterThanOrEqual(3); // 2 de la serie con hueco + 1 de la entera
  });
});

describe("Columnas", () => {
  const perfil = [
    { id: "sap", nombre: "SAP", color: "var(--color-perfil-sap)", valores: [10, 20, 30] },
    { id: "otras", nombre: "Otras apps", color: "var(--color-perfil-otras)", valores: [5, 5, 5] },
  ];
  const salida = html(<Columnas xs={["06", "07", "08"]} etiquetaX={(x) => x} series={perfil} fmt={(v) => `${v} min`} ariaLabel="perfil" />);

  it("apila sin NaN y con los data-* de cada segmento", () => {
    expect(salida).not.toMatch(/NaN|undefined/);
    expect(salida).toContain('data-serie="SAP"');
    expect(salida).toContain('data-serie="Otras apps"');
  });

  it("el segmento de arriba lleva el extremo redondeado y el de abajo no", () => {
    expect(salida).toContain("a4,4");
    expect(salida).toMatch(/d="M[\d.,]+h[\d.-]+v[\d.-]+h[\d.-]+Z"/); // el rectángulo recto de abajo
  });

  it("un tope común deja comparar dos gráficos pequeños", () => {
    const a = html(<Columnas xs={["06"]} etiquetaX={(x) => x} series={[{ id: "s", nombre: "S", color: "c", valores: [10] }]} fmt={(v) => `${v}`} ariaLabel="a" tope={100} />);
    const b = html(<Columnas xs={["06"]} etiquetaX={(x) => x} series={[{ id: "s", nombre: "S", color: "c", valores: [90] }]} fmt={(v) => `${v}`} ariaLabel="b" tope={100} />);
    expect(a).toContain(">100<");
    expect(b).toContain(">100<");
  });

  it("las marcas verticales se dibujan con su nombre", () => {
    const con = html(<Columnas xs={["a", "b"]} etiquetaX={(x) => x} series={perfil.map((s) => ({ ...s, valores: [1, 2] }))} fmt={(v) => `${v}`} ariaLabel="m" marcas={[{ x: 0.5, etiqueta: "p50 2 s" }]} />);
    expect(con).toContain("p50 2 s");
  });

  it("todo a cero es lo mismo que no tener datos", () => {
    expect(html(<Columnas xs={["a"]} etiquetaX={(x) => x} series={[{ id: "s", nombre: "S", color: "c", valores: [0] }]} fmt={(v) => `${v}`} ariaLabel="z" />)).toContain("grafico__vacio");
  });
});

describe("Barras", () => {
  const filas = [
    { id: "1", etiqueta: "Consultorio 1", partes: [{ id: "a", nombre: "Activo", valor: 100, color: "var(--color-s1)", texto: "100 min" }] },
    { id: "2", etiqueta: "Consultorio 2", partes: [{ id: "a", nombre: "Activo", valor: 50, color: "var(--color-s1)", texto: "50 min" }] },
  ];

  it("cada parte lleva su globo, y la fila su etiqueta", () => {
    const salida = html(<Barras filas={filas} ariaLabel="b" />);
    expect(salida).not.toMatch(/NaN|undefined/);
    expect(salida).toContain('data-etiqueta="Consultorio 1"');
    expect(salida).toContain('data-valor="100 min"');
  });

  it("en modo cien el ancho de una fila suma 100 %", () => {
    const salida = html(<Barras modo="cien" ariaLabel="b" leyenda filas={[{
      id: "1", etiqueta: "C1", partes: [
        { id: "sap", nombre: "SAP", valor: 75, color: "a", texto: "75 %" },
        { id: "otras", nombre: "Otras", valor: 25, color: "b", texto: "25 %" },
      ],
    }]} />);
    expect(salida).toContain("width:75%");
    expect(salida).toContain("width:25%");
    expect(salida).toContain("grafico__leyenda");
  });

  it("la referencia del conjunto es un pelo con su leyenda, no otra barra", () => {
    const salida = html(<Barras filas={filas} ariaLabel="b" tope={200} referencia={{ valor: 75, etiqueta: "mediana de todos: 75 min" }} />);
    expect(salida).toContain("barras__ref");
    expect(salida).toContain("mediana de todos: 75 min");
  });

  it("una fila con enlace es un enlace, y una sin él llega por teclado", () => {
    expect(html(<Barras ariaLabel="b" filas={[{ ...filas[0], href: "/x" }]} />)).toContain('href="/x"');
    expect(html(<Barras filas={filas} ariaLabel="b" />)).toContain('tabindex="0"');
  });
});

describe("Histograma", () => {
  it("dibuja los siete tramos con p50 y p95 en su sitio", () => {
    const salida = html(<Histograma conteos={[10, 20, 30, 20, 10, 5, 5]} p50={2400} p95={46000} ariaLabel="h" />);
    expect(salida).not.toMatch(/NaN|undefined/);
    expect(salida).toContain("&lt; 1 s");
    expect(salida).toContain("&gt; 60 s");
    expect(salida).toContain("p50 2,4 s");
    expect(salida).toContain("p95 46 s");
  });

  it("sin visitas lo dice, en vez de dibujar siete columnas de cero", () => {
    expect(html(<Histograma conteos={[]} p50={null} p95={null} ariaLabel="h" />)).toContain("Sin pantallas SAP medidas");
  });
});

describe("Interactivo", () => {
  it("en el servidor solo pone el envoltorio: el gráfico llega dibujado y sin JavaScript", () => {
    const salida = html(<Interactivo modo="cruceta"><Lineas xs={XS} etiquetaX={(x) => x} series={SERIES} fmt={min} ariaLabel="p" /></Interactivo>);
    expect(salida).toContain('class="grafico grafico--cruceta"');
    expect(salida).toContain("<svg");
    expect(salida).not.toContain("grafico__tooltip"); // lo crea el efecto, no el servidor
  });
});

describe("Cifra", () => {
  it("las cuatro tallas dicen jerarquía", () => {
    expect(html(<Cifra etiqueta="Activo" valor="9 h 16 min" variante="hero" />)).toContain("cifra--hero");
    expect(html(<Cifra etiqueta="Teclas" valor="27.759" variante="menor" />)).toContain("cifra--menor");
  });

  it("una cifra apagada dice POR QUÉ está vacía, y nunca inventa un cero", () => {
    const salida = html(<Cifra etiqueta="Pacientes" valor="—" variante="apagada" motivo="La regla de identidad todavía no encuentra al paciente en SAP." />);
    expect(salida).toContain("todavía no encuentra");
    expect(salida).toContain('aria-disabled="true"');
    expect(salida).toContain("—");
  });

  it("una apagada no lleva delta ni chispa: no hay nada que comparar", () => {
    const salida = html(<Cifra etiqueta="X" valor="—" variante="apagada" motivo="m" delta={{ antes: 10, ahora: 20 }} tendencia={{ valores: [1, 2, 3] }} />);
    expect(salida).not.toContain("▲");
    expect(salida).not.toContain("<svg");
  });

  it("el reparto es la firma: partes que suman el 100 % del número de arriba", () => {
    const salida = html(<Cifra etiqueta="Activo" valor="9 h" reparto={[
      { nombre: "SAP", valor: 75, color: "a" }, { nombre: "Otras", valor: 25, color: "b" },
    ]} />);
    expect(salida).toContain("width:75%");
    expect(salida).toContain("SAP 75 %");
  });

  it("la chispa necesita dos puntos: con uno no es una tendencia", () => {
    expect(html(<Tendencia valores={[5]} />)).toBe("");
    expect(html(<Tendencia valores={[5, 9, 7]} />)).toContain("<svg");
  });
});
