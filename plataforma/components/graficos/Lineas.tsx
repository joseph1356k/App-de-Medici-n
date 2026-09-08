// LÍNEAS SOBRE UN EJE X, y la chispa (sparkline) que va dentro de una cifra. Componentes de
// SERVIDOR: se dibujan enteros en el HTML y no llevan JavaScript. El globo y la cruceta los pone
// `Interactivo` alrededor, leyendo los data-* de las marcas.
import { Leyenda, SinDatos, TablaDeSeries } from "./Piezas";
import { bandas, topeBonito, type Fmt, type SerieXY } from "@/lib/graficos";

const ANCHO = 1000;
const IZQ = 66, DER = 14, ARR = 14, ABA = 30;

type Props = {
  xs: string[];
  /** La etiqueta corta del eje («03 sept»). */
  etiquetaX: (x: string, i: number) => string;
  /** La larga, para el globo («jue, 03 de sept»). Si falta, se usa la corta. */
  etiquetaLarga?: (x: string, i: number) => string;
  series: SerieXY[];
  fmt: Fmt;
  ariaLabel: string;
  alto?: number;
  cabeceraTabla?: string;
  notaTabla?: string;
  sinTabla?: boolean;
};

/**
 * Una línea por serie. Un valor `null` PARTE la línea en vez de bajar a cero: en este panel «no
 * medido» y «cero» son cosas distintas, y unir por encima de un hueco dibujaría un día de trabajo
 * que nunca existió.
 *
 * El eje Y arranca siempre en cero. Recortarlo exagera diferencias, y aquí se decide sobre el
 * trabajo de gente real.
 */
export function Lineas({ xs, etiquetaX, etiquetaLarga, series, fmt, ariaLabel, alto = 280, cabeceraTabla = "", notaTabla, sinTabla }: Props) {
  if (xs.length === 0 || series.length === 0) return <SinDatos />;
  const valores = series.flatMap((s) => s.valores.filter((v): v is number => v != null));
  if (valores.length === 0) return <SinDatos />;

  const tope = topeBonito(Math.max(...valores));
  const anchoUtil = ANCHO - IZQ - DER, altoUtil = alto - ARR - ABA;
  const zonas = bandas(xs.length, IZQ, ANCHO - DER);
  const y = (v: number) => ARR + altoUtil - (v / tope) * altoUtil;
  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((p) => tope * p);
  const paso = Math.max(1, Math.ceil(xs.length / 8));
  const larga = (x: string, i: number) => (etiquetaLarga ?? etiquetaX)(x, i);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${ANCHO} ${alto}`} role="img" aria-label={ariaLabel} tabIndex={0}>
        {marcasY.map((v) => (
          <g key={v}>
            <line x1={IZQ} x2={ANCHO - DER} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--color-axis)" : "var(--color-line)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={IZQ - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)" className="tabular">{fmt(v)}</text>
          </g>
        ))}

        {xs.map((x, i) => (i % paso === 0 || i === xs.length - 1) && (
          <text key={x} x={zonas[i].cx} y={alto - 10} textAnchor="middle" fontSize={12} fill="var(--color-muted)" className="tabular">{etiquetaX(x, i)}</text>
        ))}

        {series.map((s) => {
          const trazos: string[] = [];
          let actual: string[] = [];
          s.valores.forEach((v, i) => {
            if (v == null) { if (actual.length) trazos.push(actual.join(" ")); actual = []; return; }
            actual.push(`${actual.length ? "L" : "M"}${zonas[i].cx.toFixed(1)},${y(v).toFixed(1)}`);
          });
          if (actual.length) trazos.push(actual.join(" "));
          return (
            <g key={s.id}>
              {trazos.map((d, k) => (
                <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ))}
              {s.valores.map((v, i) => v == null ? null : (
                // El anillo del color de la superficie mantiene el punto legible donde dos líneas
                // se cruzan: separar con blanco, no con un borde de tinta.
                <circle key={i} cx={zonas[i].cx} cy={y(v)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2}
                  data-x={i} data-serie={s.nombre} data-valor={fmt(v)} data-color={s.color} />
              ))}
            </g>
          );
        })}

        {/* Las zonas de golpe, al final para quedar por encima: bandas contiguas de alto completo,
            así apuntar a una fecha nunca falla y no hay que acertarle a un punto de 8 px. */}
        {zonas.map((z, i) => (
          <rect key={i} x={z.x0} y={ARR} width={Math.max(0, z.x1 - z.x0)} height={altoUtil} fill="transparent"
            data-x={i} data-cx={z.cx.toFixed(1)} data-etiqueta={larga(xs[i], i)} />
        ))}
      </svg>
      <Leyenda items={series.map((s) => ({ nombre: s.nombre, color: s.color }))} forma="linea" />
      {!sinTabla && <TablaDeSeries xs={xs.map(larga)} series={series} fmt={fmt} cabeceraX={cabeceraTabla} nota={notaTabla} />}
    </figure>
  );
}

/**
 * LA CHISPA de una cifra: la misma serie, del tamaño de una palabra. Sin ejes, sin globo y sin
 * eco para el lector de pantalla — el número grande que tiene encima ya lo dice todo, y la
 * tendencia completa está en su sección. Con menos de dos puntos no se dibuja: una línea de un
 * solo punto no es una tendencia.
 */
export function Tendencia({ valores, color = "var(--color-accent)", ancho = 120, alto = 28 }: {
  valores: (number | null)[]; color?: string; ancho?: number; alto?: number;
}) {
  const hay = valores.filter((v): v is number => v != null);
  if (hay.length < 2) return null;
  const max = Math.max(...hay), min = Math.min(...hay);
  const rango = max - min || 1;
  const r = 2.5;
  const x = (i: number) => (valores.length === 1 ? ancho / 2 : r + (i / (valores.length - 1)) * (ancho - 2 * r));
  const y = (v: number) => alto - r - ((v - min) / rango) * (alto - 2 * r);

  const trazos: string[] = [];
  let actual: string[] = [];
  valores.forEach((v, i) => {
    if (v == null) { if (actual.length) trazos.push(actual.join(" ")); actual = []; return; }
    actual.push(`${actual.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (actual.length) trazos.push(actual.join(" "));

  const ultimo = valores.length - 1 - [...valores].reverse().findIndex((v) => v != null);

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} aria-hidden focusable="false" style={{ width: ancho, height: alto }}>
      {trazos.map((d, k) => <path key={k} d={d} fill="none" stroke="var(--color-axis)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
      <circle cx={x(ultimo)} cy={y(valores[ultimo] as number)} r={r} fill={color} />
    </svg>
  );
}
