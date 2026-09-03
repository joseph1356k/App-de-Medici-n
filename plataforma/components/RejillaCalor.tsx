// Consultorio × día: una celda por jornada, con el fondo tanto más verde cuanto más tiempo
// activo (8 h = tope) y las horas escritas encima. Cada celda lleva al día de ese
// consultorio. El color es una ayuda; el número es el dato.
import Link from "next/link";
import type { PuntoDiario } from "@/lib/consultas";
import { fmtFecha, fmtHoras, fmtMin, fmtNum } from "@/lib/formato";

const TOPE_MS = 8 * 3_600_000;

export function RejillaCalor({ puntos, consultorios, dias }: { puntos: PuntoDiario[]; consultorios: { id: string; nombre: string }[]; dias: string[] }) {
  const por = new Map(puntos.map((p) => [`${p.consultorio_id}|${p.fecha}`, p]));
  return (
    <div className="caja-tabla">
      <table className="tabla">
        <thead>
          <tr><th>Consultorio</th>{dias.map((d) => <th key={d} className="num">{fmtFecha(d)}</th>)}</tr>
        </thead>
        <tbody>
          {consultorios.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap text-ink">{c.nombre}</td>
              {dias.map((d) => {
                const p = por.get(`${c.id}|${d}`);
                const activo = p ? Number(p.activo_ms) : 0;
                const pct = Math.min(100, Math.round((activo / TOPE_MS) * 100));
                return (
                  <td key={d} className="num !p-0">
                    <Link href={`/consultorios/${c.id}?fecha=${d}`} className="block px-3 py-2 tabular hover:underline"
                      style={p ? { background: `color-mix(in oklab, var(--color-estado-activo) ${pct}%, var(--color-surface))`, color: pct > 55 ? "#fff" : "var(--color-ink)" } : undefined}
                      title={p ? `${fmtMin(activo)} activo · ${fmtMin(p.his_ms)} en SAP · ${fmtNum(p.pacientes)} pacientes${p.calidad_ok ? "" : " · calidad excluida"}` : `Sin datos el ${fmtFecha(d)}`}>
                      {p ? fmtHoras(activo) : <span className="text-muted">—</span>}
                      {p && !p.calidad_ok && <span className="ml-1 text-xs" aria-label="calidad excluida">⚠</span>}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
