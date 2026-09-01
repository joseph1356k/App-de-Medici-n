import Link from "next/link";
import { ETIQUETA_FASE } from "@/lib/formato";

export function Tile({ label, value, sub, hero }: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-semibold text-ink ${hero ? "text-4xl" : "text-2xl"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-secondary">{sub}</p>}
    </div>
  );
}

export function Calidad({ ok, cobertura }: { ok: boolean; cobertura: number | null }) {
  return ok
    ? <span className="chip bg-good-soft text-good-text">✓ buena calidad</span>
    : <span className="chip bg-critical-soft text-critical" title="Cobertura < 85 %, salto de reloj o datos descartados: el turno no entra a las comparaciones">⚠ excluido {cobertura != null ? `(${Number(cobertura).toFixed(0)} %)` : ""}</span>;
}

export function ChipFase({ fase }: { fase: string }) {
  const color = fase === "baseline" ? "bg-plane text-secondary border border-line" : fase === "notes" ? "bg-accent-soft text-ink" : "bg-good-soft text-good-text";
  return <span className={`chip ${color}`}>{ETIQUETA_FASE[fase] ?? fase}</span>;
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

export function Paginador({ page, total, tamano, href }: { page: number; total: number; tamano: number; href: (p: number) => string }) {
  const paginas = Math.max(1, Math.ceil(total / tamano));
  if (paginas <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted">
      <span>{total} turnos · página {page} de {paginas}</span>
      <span className="flex gap-2">
        {page > 1 && <Link className="boton" href={href(page - 1)}>← Anterior</Link>}
        {page < paginas && <Link className="boton" href={href(page + 1)}>Siguiente →</Link>}
      </span>
    </div>
  );
}
