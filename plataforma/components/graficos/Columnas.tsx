// COLUMNAS SOBRE UN EJE X, apiladas o agrupadas. Es el gráfico de «el día típico» (24 horas ×
// SAP · otras · sin uso) y el del histograma de esperas. De servidor, sin JavaScript.
import { Leyenda, SinDatos, TablaDeSeries } from "./Piezas";
import { apilar, bandas, rectRedondeadoArriba, topeBonito, type Fmt, type SerieXY } from "@/lib/graficos";

const ARR = 16, ABA = 28;
/** El grosor máximo de una marca. Una barra nunca llena su carril: el aire que sobra es lo que
 * deja leer la fila de al lado. */
const GRUESO_MAX = 24;
/** El hueco entre segmentos apilados, en unidades del viewBox. Es superficie, no un borde: se
 * separa con blanco, nunca añadiendo tinta que no es dato. */
const HUECO = 2;

type Props = {
  /** El ancho del lienzo en unidades del viewBox: ver la nota de `Lineas`. Aproximadamente los
   * píxeles que va a ocupar, para que el texto salga del tamaño que dice. */
  ancho?: number;
  xs: string[];
  etiquetaX: (x: string, i: number) => string;
  etiquetaLarga?: (x: string, i: number) => string;
  series: SerieXY[];
  modo?: "apilado" | "agrupado";
  /** Un tope común, para que dos gráficos pequeños se puedan comparar de verdad. */
  tope?: number;
  /** Líneas verticales con nombre (p50, p95…), en índice fraccionario del eje. */
  marcas?: { x: number; etiqueta: string }[];
  fmt: Fmt;
  ariaLabel: string;
  alto?: number;
  cabeceraTabla?: string;
  notaTabla?: string;
  sinTabla?: boolean;
};

export function Columnas({
  ancho: ANCHO = 1000, xs, etiquetaX, etiquetaLarga, series, modo = "apilado", tope: topeDado, marcas,
  fmt, ariaLabel, alto = 220, cabeceraTabla = "", notaTabla, sinTabla,
}: Props) {
  if (xs.length === 0 || series.length === 0) return <SinDatos />;
  const IZQ = Math.max(44, ANCHO * 0.066), DER = Math.max(10, ANCHO * 0.014);

  const porX = xs.map((_, i) => series.map((s) => Math.max(0, s.valores[i] ?? 0)));
  const maximo = modo === "apilado"
    ? Math.max(...porX.map((v) => v.reduce((a, b) => a + b, 0)))
    : Math.max(...porX.flat());
  if (maximo <= 0) return <SinDatos />;

  const tope = topeDado ?? topeBonito(maximo);
  const anchoUtil = ANCHO - IZQ - DER, altoUtil = alto - ARR - ABA;
  const zonas = bandas(xs.length, IZQ + anchoUtil / (xs.length * 2), ANCHO - DER - anchoUtil / (xs.length * 2));
  const banda = anchoUtil / xs.length;
  const grueso = Math.min(GRUESO_MAX, banda * 0.7 / (modo === "agrupado" ? series.length : 1));
  const y = (v: number) => ARR + altoUtil - (v / tope) * altoUtil;
  const marcasY = [0, 0.5, 1].map((p) => tope * p);
  const paso = Math.max(1, Math.ceil(xs.length / 12));
  const larga = (x: string, i: number) => (etiquetaLarga ?? etiquetaX)(x, i);
  // Cada 24 h el eje se lee de dos en dos: 24 etiquetas seguidas se pisan.
  const verEtiqueta = (i: number) => i % paso === 0 || i === xs.length - 1;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${ANCHO} ${alto}`} role="img" aria-label={ariaLabel} tabIndex={0}>
        {marcasY.map((v) => (
          <g key={v}>
            <line x1={IZQ} x2={ANCHO - DER} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--color-axis)" : "var(--color-line)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={IZQ - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)" className="tabular">{fmt(v)}</text>
          </g>
        ))}

        {xs.map((x, i) => verEtiqueta(i) && (
          <text key={x} x={zonas[i].cx} y={alto - 9} textAnchor="middle" fontSize={11} fill="var(--color-muted)" className="tabular">{etiquetaX(x, i)}</text>
        ))}

        {xs.map((_, i) => {
          const alturas = apilar(porX[i]);
          return series.map((s, k) => {
            const v = porX[i][k];
            if (v <= 0) return null;
            const cx = modo === "agrupado"
              ? zonas[i].cx - (series.length * grueso) / 2 + k * grueso + grueso / 2
              : zonas[i].cx;
            const apilado = modo === "apilado";
            // Arriba del segmento y abajo, en píxeles del lienzo (la Y crece hacia abajo).
            const arribaPx = apilado ? y(alturas[k].y1) : y(v);
            const abajoPx = apilado ? y(alturas[k].y0) : y(0);
            // El hueco entre segmentos se le quita al de arriba, así la pila sigue apoyada en el
            // cero y la suma de las alturas sigue siendo la del total.
            const yy = arribaPx;
            const hh = Math.max(0, abajoPx - arribaPx - (apilado && k > 0 ? HUECO : 0));
            // Solo el segmento de más arriba lleva el extremo redondeado: es el final del dato.
            const esUltimo = !apilado || k === series.length - 1 || porX[i].slice(k + 1).every((x) => x <= 0);
            const d = esUltimo
              ? rectRedondeadoArriba(cx - grueso / 2, yy, grueso, hh, 4)
              : `M${cx - grueso / 2},${yy}h${grueso}v${hh}h${-grueso}Z`;
            if (!d) return null;
            return (
              <path key={`${i}-${s.id}`} d={d} fill={s.color}
                data-x={i} data-serie={s.nombre} data-valor={fmt(v)} data-color={s.color} />
            );
          });
        })}

        {marcas?.map((m) => {
          const x = xs.length === 1 ? zonas[0].cx : IZQ + ((m.x + 0.5) / xs.length) * anchoUtil;
          return (
            <g key={m.etiqueta}>
              <line x1={x} x2={x} y1={ARR - 4} y2={y(0)} stroke="var(--color-secondary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={x} y={ARR - 7} textAnchor="middle" fontSize={11} fill="var(--color-secondary)">{m.etiqueta}</text>
            </g>
          );
        })}

        {zonas.map((z, i) => (
          <rect key={i} x={z.cx - banda / 2} y={ARR} width={banda} height={altoUtil} fill="transparent"
            data-x={i} data-cx={z.cx.toFixed(1)} data-etiqueta={larga(xs[i], i)} />
        ))}
      </svg>
      <Leyenda items={series.map((s) => ({ nombre: s.nombre, color: s.color }))} />
      {!sinTabla && <TablaDeSeries xs={xs.map(larga)} series={series} fmt={fmt} cabeceraX={cabeceraTabla} nota={notaTabla} />}
    </figure>
  );
}
