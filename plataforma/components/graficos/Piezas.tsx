// Las piezas que comparten todos los gráficos: la leyenda, la tabla gemela y el hueco cuando no
// hay nada. Son de servidor y no llevan estado: lo único que hace falta para que un gráfico
// nuevo cumpla las reglas de la casa.
import type { Fmt, SerieXY } from "@/lib/graficos";
import { seriesATabla } from "@/lib/graficos";

/**
 * LA LEYENDA, siempre que haya dos series o más. Es el canal de identidad fiable: nadie debería
 * tener que emparejar colores de memoria. Con UNA sola serie no se pone — un recuadro con un
 * color repite lo que ya dice el título y ocupa sitio.
 *
 * El texto va en tinta, nunca del color de su serie: un amarillo de serie es ilegible como letra.
 * El color lo lleva la muestra que va al lado.
 */
export function Leyenda({ items, forma = "cuadro" }: { items: { nombre: string; color: string }[]; forma?: "cuadro" | "linea" }) {
  if (items.length < 2) return null;
  return (
    <figcaption className="grafico__leyenda">
      {items.map((s) => (
        <span key={s.nombre}>
          <i style={{ background: s.color, width: forma === "linea" ? 16 : 10, height: forma === "linea" ? 2 : 10, borderRadius: forma === "linea" ? 999 : 2 }} aria-hidden />
          {s.nombre}
        </span>
      ))}
    </figcaption>
  );
}

/**
 * LA TABLA GEMELA. Cada gráfico lleva la suya con los mismos números: es lo que hace que ningún
 * valor viva solo dentro de un globo que hay que perseguir con el ratón. Se abre sola al
 * imprimir (lo hace `Interactivo`).
 */
export function TablaDeDatos({ columnas, filas, nota }: { columnas: string[]; filas: string[][]; nota?: string }) {
  if (filas.length === 0) return null;
  return (
    <details className="grafico__tabla">
      <summary>Ver tabla</summary>
      <div className="caja-tabla mt-2">
        <table className="tabla tabla--cebra">
          <thead>
            <tr>{columnas.map((c, i) => <th key={c || i} className={i === 0 ? "" : "num"}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>{f.map((celda, j) => <td key={j} className={j === 0 ? "whitespace-nowrap text-ink" : "num"}>{celda}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {nota && <p className="mt-2 text-xs text-muted">{nota}</p>}
    </details>
  );
}

/** La tabla gemela de un gráfico con eje X, hecha de sus propias series. */
export function TablaDeSeries({ xs, series, fmt, cabeceraX, nota }: { xs: string[]; series: SerieXY[]; fmt: Fmt; cabeceraX?: string; nota?: string }) {
  const t = seriesATabla(xs, series, fmt, cabeceraX);
  return <TablaDeDatos columnas={t.columnas} filas={t.filas} nota={nota} />;
}

/** Un gráfico sin datos dice qué falta, no se queda en blanco. */
export function SinDatos({ texto = "Sin datos en este rango." }: { texto?: string }) {
  return <p className="grafico__vacio">{texto}</p>;
}
