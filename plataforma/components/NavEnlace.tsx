"use client";

// Un enlace del menú que sabe si es la página actual (aria-current) sin que el layout deje
// de ser de servidor. `tambien` son rutas hijas que cuentan como esta entrada
// (/consultorios/… es parte de «Inicio»).
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavEnlace({ href, children, tambien = [] }: { href: string; children: React.ReactNode; tambien?: string[] }) {
  const ruta = usePathname() ?? "";
  const activo = ruta === href || (href !== "/" && ruta.startsWith(href + "/")) || tambien.some((t) => ruta === t || ruta.startsWith(t + "/"));
  return (
    // Un subrayado de 2 px marca la página actual mejor que una píldora: no mete otra caja en
    // una cabecera que ya tiene chips, y deja el menú leyéndose como una línea de texto.
    <Link href={href} aria-current={activo ? "page" : undefined}
      className={`-mb-px border-b-2 px-1 py-2 ${activo ? "border-ink font-medium text-ink" : "border-transparent text-secondary hover:border-line hover:text-ink"}`}>
      {children}
    </Link>
  );
}
