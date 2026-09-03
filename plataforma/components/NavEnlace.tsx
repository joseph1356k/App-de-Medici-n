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
    <Link href={href} aria-current={activo ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 ${activo ? "bg-plane font-medium text-ink" : "text-secondary hover:bg-plane hover:text-ink"}`}>
      {children}
    </Link>
  );
}
