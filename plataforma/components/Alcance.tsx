import Link from "next/link";
import { conFiltro, type Filtros } from "@/lib/filtros";

/**
 * EL ALCANCE: todos los consultorios juntos, o uno. Es el mando que cambia la página entera, así
 * que va arriba y se ve — no escondido en un desplegable entre otros cuatro filtros. Son enlaces
 * de verdad (sin JavaScript): se pueden abrir en otra pestaña y se pueden compartir.
 */
export function Alcance({ f, ruta, consultorios, extra }: {
  f: Filtros; ruta: string; consultorios: { id: string; nombre: string }[];
  /** Parámetros de la URL que hay que conservar al cambiar de alcance (la métrica de un gráfico). */
  extra?: Partial<Record<"metrica" | "perfil" | "calor", string | null>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <span className="eyebrow">Ver</span>
      <nav className="segmentos" aria-label="Alcance">
        <Link href={ruta + conFiltro(f, { ...extra, consultorio: null })} aria-current={!f.consultorio}>Todos</Link>
        {consultorios.map((c) => (
          <Link key={c.id} href={ruta + conFiltro(f, { ...extra, consultorio: c.id })} aria-current={f.consultorio === c.id}>{c.nombre}</Link>
        ))}
      </nav>
    </div>
  );
}

/** Un selector de los que van dentro de una sección (la métrica de un gráfico, la hora, el calor). */
export function Conmutador({ f, ruta, parametro, opciones, actual, extra }: {
  f: Filtros; ruta: string; parametro: "metrica" | "perfil" | "calor";
  opciones: { id: string; etiqueta: string }[]; actual: string;
  extra?: Partial<Record<"metrica" | "perfil" | "calor", string | null>>;
}) {
  return (
    <nav className="segmentos" aria-label="Métrica">
      {opciones.map((o, i) => (
        <Link key={o.id} href={ruta + conFiltro(f, { ...extra, [parametro]: i === 0 ? null : o.id })} aria-current={o.id === actual}>
          {o.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
