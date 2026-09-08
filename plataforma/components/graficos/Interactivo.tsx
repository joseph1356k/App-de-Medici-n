"use client";

// EL ÚNICO JAVASCRIPT DEL PANEL que toca un gráfico. Envuelve cualquiera de ellos y le pone
// cruceta y globo leyendo los atributos `data-*` que el servidor ya escribió en las marcas
// (ver el contrato en lib/graficos.ts). Por eso no hay una versión cliente de cada gráfico:
// hay CINCO gráficos de servidor y UN envoltorio, y añadir un sexto no añade JavaScript.
//
// Tres reglas que no se negocian:
//   · El globo AÑADE, nunca guarda: todo valor que enseña está también en la tabla gemela
//     («ver tabla»), así que el gráfico se lee sin ratón, con teclado y en papel.
//   · Nada de innerHTML. Los nombres de app y de pantalla vienen del medidor: son datos de
//     fuera, y entran al DOM con textContent.
//   · Lo que se dibuja no se toca. El servidor manda el SVG entero; aquí solo se añaden dos
//     elementos y se quitan al desmontar. Cero riesgo de desajuste al hidratar.
import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** `cruceta` para ejes con X (líneas, columnas): una línea que sigue al puntero y UN globo con
   * todas las series de esa X. `marca` para barras y celdas: el globo es de la marca señalada. */
  modo?: "cruceta" | "marca";
  className?: string;
};

export function Interactivo({ children, modo = "cruceta", className }: Props) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raiz = caja.current;
    if (!raiz) return;

    const globo = document.createElement("div");
    globo.className = "grafico__tooltip";
    globo.hidden = true;
    globo.setAttribute("aria-hidden", "true");
    raiz.appendChild(globo);

    const cursor = document.createElement("div");
    cursor.className = "grafico__cursor";
    cursor.hidden = true;
    if (modo === "cruceta") raiz.appendChild(cursor);

    let marcadas: Element[] = [];
    const desmarcar = () => { for (const m of marcadas) m.classList.remove("activo"); marcadas = []; };

    const esconder = () => { globo.hidden = true; cursor.hidden = true; desmarcar(); };

    /** Pinta el globo. `filas` son [color, nombre, valor] ya formateados por el servidor. */
    function escribir(titulo: string, filas: [string, string, string][]) {
      globo.replaceChildren();
      if (titulo) {
        const b = document.createElement("b");
        b.textContent = titulo;
        globo.appendChild(b);
      }
      for (const [color, nombre, valor] of filas) {
        const fila = document.createElement("div");
        fila.className = "fila";
        const punto = document.createElement("i");
        if (color) punto.style.background = color;
        const n = document.createElement("u");
        n.textContent = nombre;
        const v = document.createElement("s");
        v.textContent = valor;
        fila.append(punto, n, v);
        globo.appendChild(fila);
      }
      globo.hidden = false;
    }

    /** El globo cabe siempre: si se sale por la derecha, se pone a la izquierda del puntero. */
    function colocar(x: number, y: number) {
      const ancho = raiz!.clientWidth;
      const w = globo.offsetWidth;
      globo.style.left = `${x + 12 + w > ancho ? Math.max(0, x - 12 - w) : x + 12}px`;
      globo.style.top = `${Math.max(0, Math.min(y, raiz!.clientHeight - globo.offsetHeight))}px`;
    }

    function porCruceta(destino: Element) {
      const marca = destino.closest<SVGElement | HTMLElement>("[data-x]");
      const svg = raiz!.querySelector("svg");
      if (!marca || !svg) return esconder();
      const i = marca.dataset.x!;
      const golpe = svg.querySelector<SVGElement>(`[data-cx][data-x="${CSS.escape(i)}"]`);
      if (!golpe) return esconder();

      // Del viewBox a píxeles de pantalla: se recalcula en cada movimiento, así que sobrevive a
      // un cambio de tamaño de la ventana sin escuchar resize.
      const rs = svg.getBoundingClientRect();
      const rr = raiz!.getBoundingClientRect();
      const k = rs.width / (svg.viewBox.baseVal.width || rs.width);
      const x = rs.left - rr.left + Number(golpe.dataset.cx) * k;

      const filas: [string, string, string][] = [];
      desmarcar();
      for (const m of Array.from(svg.querySelectorAll<SVGElement>(`[data-valor][data-x="${CSS.escape(i)}"]`))) {
        if (!m.dataset.serie) continue;
        filas.push([m.dataset.color ?? "", m.dataset.serie, m.dataset.valor ?? ""]);
        m.classList.add("activo");
        marcadas.push(m);
      }
      if (filas.length === 0) return esconder();

      escribir(golpe.dataset.etiqueta ?? "", filas);
      const rg = golpe.getBoundingClientRect();
      cursor.style.left = `${x}px`;
      cursor.style.top = `${rg.top - rr.top}px`;
      cursor.style.height = `${rg.height}px`;
      cursor.hidden = false;
      colocar(x, rg.top - rr.top);
    }

    function porMarca(destino: Element) {
      const marca = destino.closest<SVGElement | HTMLElement>("[data-valor]");
      if (!marca) return esconder();
      desmarcar();
      marca.classList.add("activo");
      marcadas.push(marca);
      const titulo = marca.closest<HTMLElement>("[data-etiqueta]")?.dataset.etiqueta ?? "";
      const filas: [string, string, string][] = [[marca.dataset.color ?? "", marca.dataset.serie ?? "", marca.dataset.valor ?? ""]];
      if (marca.dataset.extra) filas.push(["", marca.dataset.extra, ""]);
      escribir(titulo, filas);
      const rm = marca.getBoundingClientRect();
      const rr = raiz!.getBoundingClientRect();
      colocar(rm.left - rr.left + rm.width / 2, Math.max(0, rm.top - rr.top - globo.offsetHeight - 6));
    }

    const mirar = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element)) return esconder();
      if (modo === "cruceta") porCruceta(t); else porMarca(t);
    };

    // Teclado: mismo globo que con el ratón. La flecha mueve por el eje; Escape lo cierra.
    const teclas = (e: KeyboardEvent) => {
      const svg = raiz!.querySelector("svg");
      if (!svg) return;
      if (e.key === "Escape") return esconder();
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!paso && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const golpes = Array.from(svg.querySelectorAll<SVGElement>("[data-cx]"));
      if (golpes.length === 0) return;
      const actual = golpes.findIndex((g) => g.dataset.x === (globo.dataset.x ?? ""));
      const i = e.key === "Home" ? 0 : e.key === "End" ? golpes.length - 1
        : Math.min(golpes.length - 1, Math.max(0, (actual < 0 ? 0 : actual) + paso));
      globo.dataset.x = golpes[i].dataset.x;
      porCruceta(golpes[i]);
    };

    raiz.addEventListener("pointermove", mirar);
    raiz.addEventListener("pointerleave", esconder);
    raiz.addEventListener("focusin", mirar);
    raiz.addEventListener("focusout", esconder);
    if (modo === "cruceta") raiz.addEventListener("keydown", teclas);

    // AL IMPRIMIR se abre la tabla gemela de cada gráfico: en papel no hay ratón, y un gráfico
    // sin sus números no se puede comprobar. CSS no puede abrir un <details>, por eso está aquí.
    const abiertos = new Set<HTMLDetailsElement>();
    const antesDeImprimir = () => {
      for (const d of Array.from(raiz.querySelectorAll<HTMLDetailsElement>("details.grafico__tabla"))) {
        if (!d.open) { d.open = true; abiertos.add(d); }
      }
      esconder();
    };
    const despuesDeImprimir = () => { for (const d of abiertos) d.open = false; abiertos.clear(); };
    window.addEventListener("beforeprint", antesDeImprimir);
    window.addEventListener("afterprint", despuesDeImprimir);

    return () => {
      raiz.removeEventListener("pointermove", mirar);
      raiz.removeEventListener("pointerleave", esconder);
      raiz.removeEventListener("focusin", mirar);
      raiz.removeEventListener("focusout", esconder);
      raiz.removeEventListener("keydown", teclas);
      window.removeEventListener("beforeprint", antesDeImprimir);
      window.removeEventListener("afterprint", despuesDeImprimir);
      globo.remove();
      cursor.remove();
    };
  }, [modo]);

  return <div ref={caja} className={`grafico grafico--${modo}${className ? ` ${className}` : ""}`}>{children}</div>;
}
