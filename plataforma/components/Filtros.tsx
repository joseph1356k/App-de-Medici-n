// La fila de filtros: una sola, arriba de todo lo que filtra. Rango primero (presets
// como enlaces), luego fase, médico y el interruptor de mala calidad en un form GET
// sin JavaScript.
import Link from "next/link";
import { RANGOS, conFiltro, type Filtros as F } from "@/lib/filtros";
import { ETIQUETA_FASE, FASES } from "@/lib/formato";

export function Filtros({ f, medicos, ruta = "" }: { f: F; medicos: { id: string; display_name: string }[]; ruta?: string }) {
  return (
    <div className="tarjeta flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="flex flex-wrap gap-1">
        {RANGOS.map((r) => (
          <Link key={r.id} href={ruta + conFiltro(f, { rango: r.id, desde: null, hasta: null, page: null })}
            className={`rounded-lg px-3 py-1.5 ${f.rango === r.id ? "bg-ink text-white" : "text-secondary hover:bg-plane"}`}>
            {r.etiqueta}
          </Link>
        ))}
      </div>
      <form method="get" action={ruta || "/"} className="flex flex-wrap items-center gap-2">
        {f.rango === "custom" ? (
          <>
            <input type="date" name="desde" defaultValue={f.desde} className="campo" />
            <span className="text-muted">a</span>
            <input type="date" name="hasta" defaultValue={f.hasta} className="campo" />
          </>
        ) : (
          <>
            <input type="hidden" name="rango" value={f.rango} />
            <Link href={ruta + conFiltro(f, { rango: null, desde: f.desde, hasta: f.hasta, page: null })} className="text-xs text-muted hover:text-ink">fechas exactas…</Link>
          </>
        )}
        <select name="fase" defaultValue={f.fase ?? "todas"} className="campo">
          <option value="todas">Todas las fases</option>
          {FASES.map((x) => <option key={x} value={x}>{ETIQUETA_FASE[x]}</option>)}
        </select>
        <select name="medico" defaultValue={f.medico ?? "todos"} className="campo">
          <option value="todos">Todos los médicos</option>
          {medicos.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        {f.dispositivo && <input type="hidden" name="dispositivo" value={f.dispositivo} />}
        <label className="inline-flex items-center gap-1.5 text-secondary">
          <input type="checkbox" name="incluir_mala" value="1" defaultChecked={f.incluirMala} /> incluir turnos de mala calidad
        </label>
        <button className="boton">Aplicar</button>
      </form>
      <span className="ml-auto text-xs text-muted">{f.desde} → {f.hasta}</span>
    </div>
  );
}
