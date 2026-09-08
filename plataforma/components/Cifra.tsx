// LA TARJETA DE UNA CIFRA, y solo una. Antes había dos casi iguales —`Tile` en ui.tsx y
// `Titular` dentro de la página de Datos— y por eso el mismo número se veía distinto según
// dónde cayera. Aquí están las cuatro tallas y los tres adornos que puede llevar, y nada más.
//
// Las cuatro tallas dicen JERARQUÍA, no capricho: `hero` es la cifra que resume la página (una
// por vista), `normal` lo importante, `menor` el detalle que se hojea, y `apagada` lo que
// todavía no se puede medir — con el motivo escrito, porque una casilla vacía sin explicación
// es peor que no ponerla.
import Link from "next/link";
import { Tendencia } from "@/components/graficos/Lineas";
import { Delta } from "@/components/graficos/Delta";

export type Parte = { nombre: string; valor: number; color: string };

export type CifraProps = {
  etiqueta: string;
  /** Ya formateado por quien llama (fmtMin, fmtPct…). «—» cuando no se sabe: nunca un cero inventado. */
  valor: string;
  sub?: string;
  variante?: "hero" | "normal" | "menor" | "apagada";
  /** Solo en `apagada`: por qué está vacía y qué la llenaría. */
  motivo?: string;
  delta?: { antes: number | null; ahora: number | null; mejor?: "mas" | "menos" | "neutro" };
  tendencia?: { valores: (number | null)[]; color?: string };
  /** La barra de reparto de 4 px: de qué está hecho ese tiempo. */
  reparto?: Parte[];
  tono?: "critico";
  href?: string;
  /** Para que el titular de la página pueda ocupar dos columnas de la rejilla. */
  clase?: string;
};

export function Cifra({ etiqueta, valor, sub, variante = "normal", motivo, delta, tendencia, reparto, tono, href, clase }: CifraProps) {
  const total = reparto?.reduce((s, p) => s + Math.max(0, p.valor), 0) ?? 0;
  const cuerpo = (
    <>
      <p className="text-xs text-muted">{etiqueta}</p>
      <p className={`cifra__valor mt-1 ${tono === "critico" ? "!text-critical" : ""}`}>{valor}</p>

      {variante === "apagada" && motivo && <p className="mt-1.5 text-xs leading-snug text-muted">{motivo}</p>}

      {delta && variante !== "apagada" && (
        <p className="mt-1 text-xs"><Delta antes={delta.antes} ahora={delta.ahora} mejor={delta.mejor ?? "neutro"} /></p>
      )}

      {reparto && total > 0 && (
        <div className="reparto mt-2" role="img" aria-label={reparto.map((p) => `${p.nombre} ${Math.round((p.valor / total) * 100)} %`).join(", ")}>
          {reparto.filter((p) => p.valor > 0).map((p) => (
            <span key={p.nombre} style={{ width: `${(p.valor / total) * 100}%`, background: p.color }}
              title={`${p.nombre} · ${Math.round((p.valor / total) * 100)} %`} />
          ))}
        </div>
      )}

      {tendencia && variante !== "apagada" && (
        <div className="mt-2"><Tendencia valores={tendencia.valores} color={tendencia.color} /></div>
      )}

      {sub && <p className="mt-1.5 text-xs leading-snug text-secondary">{sub}</p>}
    </>
  );

  const css = `tarjeta cifra cifra--${variante} p-4 ${tono === "critico" ? "border-critical bg-critical-soft" : ""} ${clase ?? ""}`;
  if (href) return <Link href={href} className={`${css} block transition-colors hover:border-accent`}>{cuerpo}</Link>;
  return <div className={css} aria-disabled={variante === "apagada" || undefined}>{cuerpo}</div>;
}
