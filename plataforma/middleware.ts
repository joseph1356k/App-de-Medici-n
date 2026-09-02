// EL PANEL ES PÚBLICO: no hay login. Lo pidió el dueño (2026-09-02) y se sostiene en que aquí
// no hay ni un dato de paciente — pero conviene saber lo que implica: quien tenga la dirección
// también puede ESCRIBIR (cambiar la lista de médicos, las fases, la config que obedecen los
// PCs, o pausar un equipo). Volver a cerrarlo es devolver lib/acceso.ts, que sigue en el
// historial de git.
//
// Lo que NO se abrió, y no debería abrirse, es lo que escriben los PCs: /api/medidor/* y
// /api/tareas/* siguen exigiendo X-API-Key. Sin esa barrera cualquiera podría inyectar turnos
// falsos, y un baseline contaminado no se puede volver a medir.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  // Sin base de datos configurada todas las páginas fallarían igual; mejor la de puesta en
  // marcha, que dice qué falta.
  if (!process.env.DATABASE_URL) {
    const url = req.nextUrl.clone();
    url.pathname = "/instalacion";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|instalacion|_next/static|_next/image|favicon.ico|icono.svg).*)"],
};
