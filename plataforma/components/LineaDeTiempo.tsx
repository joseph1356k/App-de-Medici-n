"use client";

// La línea de tiempo de UN turno: columnas apiladas por app en cubos de 5 minutos, con
// un hueco de 2 px del color de la superficie entre segmentos; debajo, marcas de los
// pacientes abiertos (huellas, no nombres). Tooltip por columna con todas las apps.
import { useMemo, useRef, useState } from "react";
import { colorApp, etiquetaApp, fmtHora, fmtMin } from "@/lib/formato";

type Bin = { t: string; app: string; active_ms: number; foreground_ms: number; clicks: number; typing_ms: number };
type Marca = { t: string; encounter_key: string | null; kind: string };

export function LineaDeTiempo({ bins, marcas, inicio, fin }: { bins: Bin[]; marcas: Marca[]; inicio: string; fin: string | null }) {
  const [ancho, setAncho] = useState(760);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const observar = (el: HTMLDivElement | null) => {
    if (!el || ref.current === el) return;
    ref.current = el;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(320, e.contentRect.width)));
    ro.observe(el);
  };

  const modelo = useMemo(() => {
    const t0 = Math.floor(new Date(inicio).getTime() / 300000) * 300000;
    const t1 = Math.ceil(new Date(fin ?? Date.now()).getTime() / 300000) * 300000;
    const n = Math.max(1, Math.min(600, Math.round((t1 - t0) / 300000)));
    const columnas: { t: number; porApp: Map<string, Bin> ; total: number }[] = Array.from({ length: n }, (_, i) => ({ t: t0 + i * 300000, porApp: new Map(), total: 0 }));
    const apps = new Map<string, number>();
    for (const b of bins) {
      const i = Math.round((new Date(b.t).getTime() - t0) / 300000);
      if (i < 0 || i >= n) continue;
      columnas[i].porApp.set(b.app, b);
      columnas[i].total += b.active_ms;
      apps.set(b.app, (apps.get(b.app) ?? 0) + b.active_ms);
    }
    // Máximo 8 apps con color propio; el resto se pliega en «otro».
    const orden = [...apps.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
    const visibles = orden.slice(0, 7);
    return { t0, n, columnas, apps: [...visibles, ...(orden.length > 7 ? ["otro"] : [])], visibles };
  }, [bins, inicio, fin]);

  const mL = 36, mR = 12, mT = 8, mB = 36, alto = 190;
  const w = Math.max(ancho - mL - mR, 60);
  const colW = w / modelo.n;
  const barW = Math.min(24, Math.max(2, colW - 1));
  const y = (ms: number) => mT + (alto - mT - mB) * (1 - ms / 300000);
  const x = (i: number) => mL + i * colW + (colW - barW) / 2;
  const cadaN = Math.max(1, Math.ceil(modelo.n / Math.max(4, Math.floor(w / 70))));

  const col = hover != null ? modelo.columnas[hover] : null;
  const tooltipX = hover != null ? Math.min(x(hover) + 14, ancho - 200) : 0;

  return (
    <div ref={observar} className="relative">
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-secondary">
        {modelo.apps.map((a) => (
          <span key={a} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorApp(a) }} aria-hidden />{etiquetaApp(a)}</span>
        ))}
        <span className="text-muted">· minutos activos en cada tramo de 5 min</span>
      </div>
      <svg width="100%" height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Actividad del turno por app a lo largo del tiempo"
        onPointerLeave={() => setHover(null)}>
        {[0, 150000, 300000].map((t) => (
          <g key={t}>
            <line x1={mL} x2={ancho - mR} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={mL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)" className="tabular">{t / 60000}</text>
          </g>
        ))}
        {modelo.columnas.map((c, i) => {
          let acumulado = 0;
          const segmentos = modelo.apps.map((a) => {
            const ms = a === "otro"
              ? [...c.porApp.entries()].filter(([k]) => !modelo.visibles.includes(k)).reduce((s, [, b]) => s + b.active_ms, 0)
              : c.porApp.get(a)?.active_ms ?? 0;
            const y0 = y(acumulado), y1 = y(acumulado + ms);
            acumulado += ms;
            return { a, ms, y0, y1 };
          });
          return (
            <g key={c.t} onPointerEnter={() => setHover(i)} style={{ cursor: "default" }}>
              <rect x={mL + i * colW} y={mT} width={colW} height={alto - mT - mB} fill="transparent" />
              {segmentos.filter((s) => s.ms > 0).map((s) => (
                <rect key={s.a} x={x(i)} y={s.y1 + 1} width={barW} height={Math.max(0, s.y0 - s.y1 - 2)} fill={colorApp(s.a)} opacity={hover === i ? 0.85 : 1} rx={1} />
              ))}
              {(i % cadaN === 0) && <text x={mL + i * colW + colW / 2} y={alto - 20} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{fmtHora(new Date(c.t))}</text>}
            </g>
          );
        })}
        {marcas.map((m, k) => {
          const i = (new Date(m.t).getTime() - modelo.t0) / 300000;
          if (i < 0 || i > modelo.n) return null;
          const px = mL + i * colW;
          return (
            <g key={k}>
              <line x1={px} x2={px} y1={alto - mB + 4} y2={alto - mB + 12} stroke="var(--color-s7)" strokeWidth={2} />
              <title>{m.kind === "encounter_enter" ? `Paciente ${m.encounter_key?.slice(0, 8)}… abierto a las ${fmtHora(m.t)}` : m.kind}</title>
            </g>
          );
        })}
        <text x={mL} y={alto - 2} fontSize={10} fill="var(--color-muted)">│ paciente abierto</text>
      </svg>
      {col && (
        <div className="pointer-events-none absolute top-8 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md" style={{ left: tooltipX }}>
          <p className="mb-1 font-medium text-ink">{fmtHora(new Date(col.t))} – {fmtHora(new Date(col.t + 300000))} · activo {fmtMin(col.total)}</p>
          {[...col.porApp.values()].sort((a, b) => b.active_ms - a.active_ms).map((b) => (
            <p key={b.app} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colorApp(modelo.visibles.includes(b.app) ? b.app : "otro") }} />
              <strong className="text-ink">{fmtMin(b.active_ms)}</strong>
              <span className="text-muted">{etiquetaApp(b.app)} · {b.clicks} clics · {fmtMin(b.typing_ms)} escribiendo</span>
            </p>
          ))}
          {col.porApp.size === 0 && <p className="text-muted">sin actividad</p>}
        </div>
      )}
    </div>
  );
}
