// BARRAS HORIZONTALES: una fila por entidad, con una o varias partes. En HTML y no en SVG a
// propósito — las etiquetas de categoría son texto de verdad (nombres de app, transacciones,
// consultorios) y aquí se recortan y se envuelven como texto, no como un `<text>` que se sale.
//
// Dos modos: `absoluto` compara magnitudes contra un tope común, y `cien` reparte el 100 % de
// cada fila (de qué está hecho ese tiempo). La `referencia` es un pelo vertical, no otra barra:
// es un punto de comparación, no un dato más.
import Link from "next/link";
import { Leyenda, SinDatos, TablaDeDatos } from "./Piezas";

export type ParteBarra = {
  id: string; nombre: string; valor: number; color: string;
  /** Ya formateado. */ texto: string;
  /** Segunda línea del globo. */ extra?: string;
};
export type FilaBarra = { id: string; etiqueta: string; href?: string; partes: ParteBarra[]; texto?: string };

type Props = {
  filas: FilaBarra[];
  modo?: "absoluto" | "cien";
  /** Tope común del eje. Sin él se usa el mayor total de las filas. */
  tope?: number;
  referencia?: { valor: number; etiqueta: string };
  ariaLabel: string;
  cabeceraTabla?: string;
  notaTabla?: string;
  sinTabla?: boolean;
  /** Con una sola parte por fila la leyenda sobra; con varias (apps, fases) hace falta. */
  leyenda?: boolean;
};

export function Barras({ filas, modo = "absoluto", tope: topeDado, referencia, ariaLabel, cabeceraTabla = "", notaTabla, sinTabla, leyenda }: Props) {
  if (filas.length === 0) return <SinDatos />;
  const total = (f: FilaBarra) => f.partes.reduce((s, p) => s + Math.max(0, p.valor), 0);
  const tope = modo === "cien" ? 0 : (topeDado ?? Math.max(1, ...filas.map(total), referencia?.valor ?? 0));
  if (modo === "absoluto" && !(tope > 0)) return <SinDatos />;

  const ancho = (f: FilaBarra, p: ParteBarra) => {
    const v = Math.max(0, p.valor);
    const base = modo === "cien" ? total(f) : tope;
    return base > 0 ? (v / base) * 100 : 0;
  };

  // La leyenda sale de la primera fila que tenga partes: todas comparten el mismo reparto.
  const claves = filas.find((f) => f.partes.length > 1)?.partes ?? [];

  return (
    <figure className="m-0">
      <div className="barras" role="img" aria-label={ariaLabel}>
        {filas.map((f) => {
          const cuerpo = (
            <>
              <span className="barras__nombre" title={f.etiqueta}>{f.etiqueta}</span>
              <span className="barras__pista">
                {f.partes.filter((p) => p.valor > 0).map((p) => (
                  <span key={p.id} style={{ width: `${ancho(f, p)}%`, background: p.color }}
                    data-serie={p.nombre} data-valor={p.texto} data-color={p.color} data-extra={p.extra} />
                ))}
                {referencia && referencia.valor > 0 && tope > 0 && (
                  <span className="barras__ref" style={{ left: `${Math.min(100, (referencia.valor / tope) * 100)}%` }}
                    title={referencia.etiqueta} aria-hidden />
                )}
              </span>
              <span className="barras__valor">{f.texto ?? f.partes[0]?.texto ?? "—"}</span>
            </>
          );
          if (f.href) return <Link key={f.id} href={f.href} className="barras__fila hover:underline" data-etiqueta={f.etiqueta}>{cuerpo}</Link>;
          return <div key={f.id} className="barras__fila" data-etiqueta={f.etiqueta} tabIndex={0}>{cuerpo}</div>;
        })}
      </div>

      {referencia && <p className="mt-2 text-xs text-muted"><span className="mr-1 inline-block h-3 w-px align-middle" style={{ background: "var(--color-ink)", opacity: 0.45 }} aria-hidden />{referencia.etiqueta}</p>}
      {leyenda && <Leyenda items={claves.map((p) => ({ nombre: p.nombre, color: p.color }))} />}
      {!sinTabla && (
        <TablaDeDatos
          columnas={claves.length > 1 ? [cabeceraTabla, ...claves.map((p) => p.nombre)] : [cabeceraTabla, "Valor"]}
          filas={filas.map((f) => claves.length > 1
            ? [f.etiqueta, ...claves.map((c) => f.partes.find((p) => p.id === c.id)?.texto ?? "—")]
            : [f.etiqueta, f.texto ?? f.partes[0]?.texto ?? "—"])}
          nota={notaTabla}
        />
      )}
    </figure>
  );
}
