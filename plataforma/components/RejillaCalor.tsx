// Consultorio × día: una celda por jornada, con el fondo tanto más intenso cuanto mayor es la
// métrica elegida, y el número escrito encima. Cada celda lleva al día de ese consultorio.
//
// El color es una AYUDA para encontrar el día raro de un vistazo; el dato es el número, que
// siempre está escrito. Por eso la escala es de un solo tono (más = más oscuro) y no un arcoíris:
// aquí se compara magnitud, no identidad.
import Link from "next/link";
import type { PuntoDiario } from "@/lib/consultas";
import { fmtFecha, fmtHoras, fmtMin, fmtNum } from "@/lib/formato";

type Campo = "activo_ms" | "his_ms" | "sap_wait_ms";

export function RejillaCalor({ puntos, fechas, campo = "activo_ms", fmt = fmtHoras, tono = "var(--color-estado-activo)", tope: topeDado }: {
  puntos: PuntoDiario[];
  fechas: string[];
  campo?: Campo;
  fmt?: (v: number) => string;
  tono?: string;
  /** Sin tope explícito se usa el mayor valor del rango: la escala se adapta a lo que hay. */
  tope?: number;
}) {
  const por = new Map(puntos.map((p) => [`${p.consultorio_id ?? "sin"}|${p.fecha}`, p]));
  const consultorios = [...new Map(puntos.map((p) => [p.consultorio_id ?? "sin", p])).values()]
    .sort((a, b) => a.orden - b.orden);
  const valor = (p: PuntoDiario) => Number(p[campo] ?? 0);
  const tope = topeDado ?? Math.max(1, ...puntos.map(valor));
  if (consultorios.length === 0 || fechas.length === 0) return null;

  return (
    <div className="caja-tabla">
      <table className="tabla">
        <thead>
          <tr><th>Consultorio</th>{fechas.map((d) => <th key={d} className="num">{fmtFecha(d)}</th>)}</tr>
        </thead>
        <tbody>
          {consultorios.map((c) => (
            <tr key={c.consultorio_id ?? "sin"}>
              <td className="whitespace-nowrap text-ink">{c.nombre}</td>
              {fechas.map((d) => {
                const p = por.get(`${c.consultorio_id ?? "sin"}|${d}`);
                const v = p ? valor(p) : 0;
                const pct = Math.min(100, Math.round((v / tope) * 100));
                return (
                  <td key={d} className="num !p-0">
                    <Link href={`/consultorios/${c.consultorio_id}?fecha=${d}`} className="block px-3 py-2 tabular hover:underline"
                      style={p ? { background: `color-mix(in oklab, ${tono} ${pct}%, var(--color-surface))`, color: pct > 55 ? "#fff" : "var(--color-ink)" } : undefined}
                      title={p
                        ? `${fmtMin(p.activo_ms)} activo · ${fmtMin(p.his_ms)} en SAP · espera ${fmtMin(p.sap_wait_ms)} · ${fmtNum(p.pacientes)} pacientes${p.calidad_ok ? "" : " · calidad excluida"}`
                        : `Sin datos el ${fmtFecha(d)}`}>
                      {p ? fmt(v) : <span className="text-muted">—</span>}
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
