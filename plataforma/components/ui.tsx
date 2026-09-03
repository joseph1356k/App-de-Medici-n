import Link from "next/link";
import type { Estado } from "@/lib/segmentos";
import { COLOR_ESTADO, ETIQUETA_ESTADO, ETIQUETA_FASE } from "@/lib/formato";

export function Tile({ label, value, sub, hero, tono }: { label: string; value: string; sub?: string; hero?: boolean; tono?: "critico" }) {
  return (
    <div className={`tarjeta p-4 ${tono === "critico" ? "border-critical bg-critical-soft" : ""}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-semibold ${tono === "critico" ? "text-critical" : "text-ink"} ${hero ? "text-4xl" : "text-2xl"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-secondary">{sub}</p>}
    </div>
  );
}

export function Calidad({ ok, cobertura }: { ok: boolean; cobertura: number | null }) {
  return ok
    ? <span className="chip bg-good-soft text-good-text">✓ buena calidad</span>
    : <span className="chip bg-critical-soft text-critical" title="Cobertura < 80 %, reloj inestable o datos descartados: la jornada no entra a las comparaciones">⚠ excluida {cobertura != null ? `(${Number(cobertura).toFixed(0)} %)` : ""}</span>;
}

export function ChipFase({ fase }: { fase: string }) {
  const color = fase === "baseline" ? "bg-plane text-secondary border border-line" : fase === "notes" ? "bg-accent-soft text-ink" : "bg-good-soft text-good-text";
  return <span className={`chip ${color}`}>{ETIQUETA_FASE[fase] ?? fase}</span>;
}

/** Un chip con tono semántico: ok (verde), aviso (ámbar), critico (rojo), neutro (gris). */
export function Insignia({ tono, children, title }: { tono: "ok" | "aviso" | "critico" | "neutro"; children: React.ReactNode; title?: string }) {
  const clase = tono === "ok" ? "bg-good-soft text-good-text" : tono === "aviso" ? "bg-warning-soft text-ink" : tono === "critico" ? "bg-critical-soft text-critical" : "border border-line bg-plane text-secondary";
  return <span className={`chip ${clase}`} title={title}>{children}</span>;
}

/** El punto de color de un estado (activo · inactivo · bloqueado · sin datos · sin PC). */
export function PuntoEstado({ estado, grande }: { estado: Estado | "sin_pc"; grande?: boolean }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full border border-black/10 ${grande ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} ${estado === "sin_datos" || estado === "sin_pc" ? "punto-rayado" : ""}`}
      style={{ background: COLOR_ESTADO[estado] }} role="img" aria-label={ETIQUETA_ESTADO[estado]} title={ETIQUETA_ESTADO[estado]}
    />
  );
}

export function Vacio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="tarjeta p-8 text-center">
      <p className="text-base font-medium text-ink">{titulo}</p>
      <p className="mt-1 text-sm text-muted">{texto}</p>
    </div>
  );
}

export function Seccion({ titulo, sub, children, accion }: { titulo: string; sub?: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <section className="tarjeta p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{titulo}</h2>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

export function Paginador({ page, total, tamano, href, noun = "filas" }: { page: number; total: number; tamano: number; href: (p: number) => string; noun?: string }) {
  const paginas = Math.max(1, Math.ceil(total / tamano));
  if (paginas <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted">
      <span>{total} {noun} · página {page} de {paginas}</span>
      <span className="flex gap-2">
        {page > 1 && <Link className="boton" href={href(page - 1)}>← Anterior</Link>}
        {page < paginas && <Link className="boton" href={href(page + 1)}>Siguiente →</Link>}
      </span>
    </div>
  );
}
