// LOS GRÁFICOS DE LA PÁGINA DE DATOS. Todo SVG servido desde el servidor: sin librería, sin
// JavaScript en el navegador y sin capa de hidratación — se imprime, se copia y se lee igual
// en el PC del hospital que en un móvil. Los tooltips son <title> nativos.
//
// Tres reglas que se repiten en los tres gráficos:
//   · El color sigue a la ENTIDAD (un consultorio siempre del mismo color, en todas las
//     secciones), nunca al orden ni al valor.
//   · El eje Y arranca SIEMPRE en cero. Un eje recortado exagera diferencias y este panel
//     existe para decidir sobre el trabajo de gente real.
//   · «No medido» se dibuja como un hueco en la línea, no como un cero.
import { fmtDiaCorto, fmtFecha } from "@/lib/formato";

export const COLOR_SERIE = ["var(--color-s1)", "var(--color-s2)", "var(--color-s3)", "var(--color-s4)", "var(--color-s7)", "var(--color-s6)"];

const ANCHO = 1000;
const IZQ = 66, DER = 14, ARR = 14;

/** Un tope «redondo» por encima del máximo: 1-2-5 × 10ⁿ. Un eje que acaba en 6,37 h no se lee. */
function topeBonito(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= max) return m * exp;
  return 10 * exp;
}

export type SerieDia = { id: string; nombre: string; color: string; puntos: Map<string, number | null> };

/**
 * UNA LÍNEA POR CONSULTORIO sobre los días del rango. El día es la unidad del estudio, así
 * que el eje X son días operativos completos: si un día no tiene jornada de ese consultorio,
 * la línea se corta ahí en vez de bajar a cero (que sería decir «ese día no trabajó nadie»).
 */
export function LineasPorDia({
  series, fechas, fmt, ariaLabel, alto = 280, unidad,
}: {
  series: SerieDia[]; fechas: string[]; fmt: (v: number) => string; ariaLabel: string; alto?: number; unidad?: string;
}) {
  const ABA = 30;
  if (fechas.length === 0 || series.length === 0) return <p className="text-sm text-muted">Sin datos en este rango.</p>;

  const valores = series.flatMap((s) => [...s.puntos.values()].filter((v): v is number => v != null));
  const tope = topeBonito(Math.max(...valores, 0));
  const anchoUtil = ANCHO - IZQ - DER, altoUtil = alto - ARR - ABA;
  const x = (i: number) => IZQ + (fechas.length === 1 ? anchoUtil / 2 : (i / (fechas.length - 1)) * anchoUtil);
  const y = (v: number) => ARR + altoUtil - (v / tope) * altoUtil;

  const marcasY = [0, 0.25, 0.5, 0.75, 1].map((p) => ({ v: tope * p, y: y(tope * p) }));
  const paso = Math.max(1, Math.ceil(fechas.length / 8));
  const marcasX = fechas.map((f, i) => ({ f, i })).filter(({ i }) => i % paso === 0 || i === fechas.length - 1);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${ANCHO} ${alto}`} width="100%" style={{ height: "auto", display: "block" }} role="img" aria-label={ariaLabel}>
        {marcasY.map((m, k) => (
          <g key={k}>
            <line x1={IZQ} x2={ANCHO - DER} y1={m.y} y2={m.y} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={IZQ - 8} y={m.y + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)">{fmt(m.v)}</text>
          </g>
        ))}
        {marcasX.map(({ f, i }) => (
          <text key={f} x={x(i)} y={alto - 10} textAnchor="middle" fontSize={12} fill="var(--color-muted)">{fmtDiaCorto(f)}</text>
        ))}
        {series.map((s) => {
          // Un hueco parte la línea en dos trazos: no se interpola sobre un día sin datos.
          const trazos: string[] = [];
          let actual: string[] = [];
          fechas.forEach((f, i) => {
            const v = s.puntos.get(f);
            if (v == null) { if (actual.length) trazos.push(actual.join(" ")); actual = []; return; }
            actual.push(`${actual.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          });
          if (actual.length) trazos.push(actual.join(" "));
          return (
            <g key={s.id}>
              {trazos.map((d, k) => <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
              {fechas.map((f, i) => {
                const v = s.puntos.get(f);
                if (v == null) return null;
                return (
                  <circle key={f} cx={x(i)} cy={y(v)} r={3.5} fill="var(--color-surface)" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke">
                    <title>{`${s.nombre} · ${fmtFecha(f)} · ${fmt(v)}${unidad ? " " + unidad : ""}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        <line x1={IZQ} x2={ANCHO - DER} y1={y(0)} y2={y(0)} stroke="var(--color-axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
        {series.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden />{s.nombre}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * LA FORMA DEL DÍA: 24 columnas, una por hora de Bogotá. Con varios consultorios las barras
 * se apilan lado a lado dentro de la hora — mismo eje para todos, que es lo único que hace
 * que dos consultorios se puedan comparar de un vistazo.
 */
export function BarrasPorHora({
  series, fmt, ariaLabel, alto = 200,
}: {
  series: { id: string; nombre: string; color: string; horas: Map<string, number> }[]; fmt: (v: number) => string; ariaLabel: string; alto?: number;
}) {
  const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const max = Math.max(1, ...series.flatMap((s) => [...s.horas.values()]));
  const conAlgo = HORAS.filter((h) => series.some((s) => (s.horas.get(h) ?? 0) > 0));
  if (conAlgo.length === 0) return <p className="text-sm text-muted">Sin actividad por hora en este rango.</p>;
  // Se enseña de la primera a la última hora con algo, con un margen: 24 columnas vacías no
  // dicen nada y aplastan las que sí.
  const desde = Math.max(0, HORAS.indexOf(conAlgo[0]) - 1);
  const hasta = Math.min(23, HORAS.indexOf(conAlgo[conAlgo.length - 1]) + 1);
  const visibles = HORAS.slice(desde, hasta + 1);

  return (
    <figure className="m-0">
      <div className="grafico-horas" role="img" aria-label={ariaLabel} style={{ height: alto }}>
        {visibles.map((h) => (
          <div key={h} className="grafico-horas__col">
            <div className="grafico-horas__barras">
              {series.map((s) => {
                const v = s.horas.get(h) ?? 0;
                return (
                  <span key={s.id} title={`${s.nombre} · ${h}:00–${h}:59 · ${fmt(v)}`}
                    style={{ height: `${v === 0 ? 0 : Math.max(2, (v / max) * 100)}%`, background: s.color }} />
                );
              })}
            </div>
            <span className="grafico-horas__eje">{h}</span>
          </div>
        ))}
      </div>
      {series.length > 1 && (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.nombre}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * EL CAMBIO respecto al periodo anterior del mismo largo. Se dice qué significa subir: en
 * «tiempo en SAP» subir es malo y en «pacientes» es bueno, así que el color lo decide quien
 * llama (`mejor`), nunca el signo por su cuenta. Sin dato anterior no se inventa un 0 %.
 */
export function Delta({ antes, ahora, mejor = "menos" }: { antes: number | null | undefined; ahora: number | null | undefined; mejor?: "mas" | "menos" | "neutro" }) {
  if (antes == null || ahora == null || Number(antes) === 0) return <span className="text-muted">sin periodo anterior</span>;
  const pct = ((Number(ahora) - Number(antes)) / Math.abs(Number(antes))) * 100;
  if (Math.abs(pct) < 1) return <span className="text-muted">igual que antes</span>;
  const sube = pct > 0;
  const bueno = mejor === "neutro" ? null : (sube === (mejor === "mas"));
  const color = bueno == null ? "text-secondary" : bueno ? "text-good-text" : "text-critical";
  return (
    <span className={color} title="Frente al periodo anterior del mismo largo">
      {sube ? "▲" : "▼"} {Math.abs(pct).toFixed(0)} %
    </span>
  );
}
