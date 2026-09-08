// EL HISTOGRAMA DE LA ESPERA DE SAP. No es un gráfico genérico: son los siete tramos de
// lib/graficos.ts con las marcas del p50 y el p95 encima, que es la forma de contar que en el
// HGM la mitad de las pantallas tardan 2,4 s y una de cada veinte pasa de 46 s. Una media sola
// escondería justo esa cola.
import { Columnas } from "./Columnas";
import { SinDatos } from "./Piezas";
import { cubetasEspera, posicionEnCubetas } from "@/lib/graficos";
import { fmtNum, fmtSeg } from "@/lib/formato";

export function Histograma({ conteos, p50, p95, ariaLabel, alto = 220, ancho }: {
  /** Siete tramos, en el orden de `ETIQUETA_CUBETA`. */
  conteos: number[];
  p50: number | null; p95: number | null;
  ariaLabel: string; alto?: number; ancho?: number;
}) {
  const cubetas = cubetasEspera(conteos);
  const n = cubetas.reduce((s, c) => s + c.n, 0);
  if (n === 0) return <SinDatos texto="Sin pantallas SAP medidas en este rango." />;

  const marcas: { x: number; etiqueta: string }[] = [];
  if (p50 != null) marcas.push({ x: posicionEnCubetas(p50), etiqueta: `p50 ${fmtSeg(p50)}` });
  if (p95 != null) marcas.push({ x: posicionEnCubetas(p95), etiqueta: `p95 ${fmtSeg(p95)}` });

  return (
    <Columnas
      ancho={ancho}
      xs={cubetas.map((c) => c.etiqueta)}
      etiquetaX={(x) => x}
      etiquetaLarga={(x, i) => `Pantallas que tardaron ${x} · ${fmtNum(cubetas[i].n)} de ${fmtNum(n)}`}
      series={[{
        id: "espera", nombre: "Pantallas", color: "var(--color-s1)",
        valores: cubetas.map((c) => c.pct),
      }]}
      modo="apilado"
      marcas={marcas}
      fmt={(v) => `${v.toFixed(0)} %`}
      ariaLabel={ariaLabel}
      alto={alto}
      cabeceraTabla="Tardó"
      notaTabla={`${fmtNum(n)} pantallas SAP con medida de «lista en».`}
    />
  );
}
