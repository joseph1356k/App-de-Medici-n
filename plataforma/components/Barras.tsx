"use client";

// Barras horizontales: una serie, marcas de <= 24 px con extremo redondeado (4 px) y
// base cuadrada, etiqueta directa del valor en la punta (en tinta, nunca del color de
// la serie). El color sigue a la entidad cuando se pasa (apps); si no, el slot 1.
import { useState } from "react";

export type ItemBarra = { id: string; etiqueta: string; valor: number; texto: string; color?: string; detalle?: string };

export function Barras({ items, ariaLabel }: { items: ItemBarra[]; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  if (items.length === 0) return <p className="text-sm text-muted">Sin datos en este rango.</p>;
  const max = Math.max(...items.map((i) => i.valor), 1);
  return (
    <div role="img" aria-label={ariaLabel} className="space-y-2">
      {items.map((it) => {
        const pct = Math.max(0.5, (it.valor / max) * 100);
        const activo = hover === it.id;
        return (
          <div key={it.id} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-sm"
            onPointerEnter={() => setHover(it.id)} onPointerLeave={() => setHover(null)} title={it.detalle}>
            <span className="truncate text-secondary">{it.etiqueta}</span>
            <div className="relative h-6 py-1">
              <div className="h-4 rounded-r" style={{ width: `${pct}%`, background: it.color ?? "var(--color-s1)", opacity: activo ? 0.85 : 1, transition: "opacity 120ms" }} />
            </div>
            <span className="tabular text-ink">{it.texto}</span>
          </div>
        );
      })}
    </div>
  );
}
