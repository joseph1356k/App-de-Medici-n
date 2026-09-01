"use client";

// Serie diaria: dos series (activo y en SAP) como líneas de 2 px con marcador final,
// crosshair que busca la fecha más cercana y un tooltip con las dos series a la vez.
// Leyenda siempre (son dos series) + etiqueta directa solo en el último punto.
// Tabla gemela en <details> para lectores y para copiar.
import { useMemo, useRef, useState } from "react";
import { fmtFecha, fmtMin } from "@/lib/formato";

type Punto = { fecha: string; turnos: number; activo_ms: number | null; his_ms: number | null };

const SERIES = [
  { clave: "activo_ms" as const, nombre: "Activo en el PC", color: "var(--color-s1)" },
  { clave: "his_ms" as const, nombre: "En SAP (HIS)", color: "var(--color-s2)" },
];

export function SerieDiaria({ puntos }: { puntos: Punto[] }) {
  const [ancho, setAncho] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const alto = 220, mL = 44, mR = 96, mT = 12, mB = 28;

  const escala = useMemo(() => {
    const max = Math.max(60 * 60000, ...puntos.flatMap((p) => [p.activo_ms ?? 0, p.his_ms ?? 0]));
    const techo = Math.ceil(max / 3600000) * 3600000; // horas redondas
    const w = Math.max(ancho - mL - mR, 40);
    const x = (i: number) => mL + (puntos.length <= 1 ? w / 2 : (i * w) / (puntos.length - 1));
    const y = (ms: number) => mT + (alto - mT - mB) * (1 - ms / techo);
    return { techo, x, y };
  }, [puntos, ancho]);

  const observar = (el: HTMLDivElement | null) => {
    if (!el || ref.current === el) return;
    ref.current = el;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(320, e.contentRect.width)));
    ro.observe(el);
  };

  if (puntos.length === 0) return <p className="text-sm text-muted">Sin turnos de buena calidad en este rango.</p>;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * escala.techo);
  const camino = (clave: "activo_ms" | "his_ms") =>
    puntos.map((p, i) => `${i === 0 ? "M" : "L"}${escala.x(i).toFixed(1)},${escala.y(p[clave] ?? 0).toFixed(1)}`).join(" ");
  const ultimo = puntos.length - 1;
  const cadaN = Math.max(1, Math.ceil(puntos.length / Math.max(3, Math.floor((ancho - mL - mR) / 70))));

  const alMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let mejor = 0, dist = Infinity;
    puntos.forEach((_, i) => { const d = Math.abs(escala.x(i) - px); if (d < dist) { dist = d; mejor = i; } });
    setHover(mejor);
  };

  const h = hover != null ? puntos[hover] : null;
  const tooltipX = hover != null ? Math.min(escala.x(hover) + 12, ancho - 190) : 0;

  return (
    <div ref={observar} className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-secondary">
        {SERIES.map((s) => (
          <span key={s.clave} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden /> {s.nombre}
          </span>
        ))}
        <span className="text-muted">· mediana por turno, cada día</span>
      </div>
      <svg width="100%" height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Minutos activos y en SAP por turno, por día"
        onPointerMove={alMover} onPointerLeave={() => setHover(null)} style={{ touchAction: "none" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={mL} x2={ancho - mR} y1={escala.y(t)} y2={escala.y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={mL - 6} y={escala.y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)" className="tabular">{Math.round(t / 3600000)} h</text>
          </g>
        ))}
        {puntos.map((p, i) => (i % cadaN === 0 || i === ultimo) && (
          <text key={p.fecha} x={escala.x(i)} y={alto - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{fmtFecha(p.fecha)}</text>
        ))}
        {SERIES.map((s) => (
          <g key={s.clave}>
            <path d={camino(s.clave)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={escala.x(ultimo)} cy={escala.y(puntos[ultimo][s.clave] ?? 0)} r={6} fill="var(--color-surface)" />
            <circle cx={escala.x(ultimo)} cy={escala.y(puntos[ultimo][s.clave] ?? 0)} r={4} fill={s.color} />
            <text x={escala.x(ultimo) + 10} y={escala.y(puntos[ultimo][s.clave] ?? 0) + 4} fontSize={11} fill="var(--color-secondary)">{fmtMin(puntos[ultimo][s.clave])}</text>
          </g>
        ))}
        {hover != null && (
          <g>
            <line x1={escala.x(hover)} x2={escala.x(hover)} y1={mT} y2={alto - mB} stroke="var(--color-axis)" strokeWidth={1} />
            {SERIES.map((s) => (
              <g key={s.clave}>
                <circle cx={escala.x(hover)} cy={escala.y(puntos[hover][s.clave] ?? 0)} r={6} fill="var(--color-surface)" />
                <circle cx={escala.x(hover)} cy={escala.y(puntos[hover][s.clave] ?? 0)} r={4} fill={s.color} />
              </g>
            ))}
          </g>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-8 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md" style={{ left: tooltipX }}>
          <p className="mb-1 font-medium text-ink">{fmtFecha(h.fecha)} · {h.turnos} turno{h.turnos === 1 ? "" : "s"}</p>
          {SERIES.map((s) => (
            <p key={s.clave} className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
              <strong className="text-ink">{fmtMin(h[s.clave])}</strong>
              <span className="text-muted">{s.nombre}</span>
            </p>
          ))}
        </div>
      )}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Ver como tabla</summary>
        <table className="tabla mt-2"><thead><tr><th>Día</th><th className="num">Turnos</th><th className="num">Activo</th><th className="num">En SAP</th></tr></thead>
          <tbody>{puntos.map((p) => <tr key={p.fecha}><td>{p.fecha}</td><td className="num">{p.turnos}</td><td className="num">{fmtMin(p.activo_ms)}</td><td className="num">{fmtMin(p.his_ms)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
