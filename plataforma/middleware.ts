// Quién entra a qué:
//   /api/medidor/*, /api/tareas/*  → X-API-Key (lo comprueba cada route handler)
//   /entrar                        → libre
//   todo lo demás (panel y exportaciones) → cookie del panel, o ?clave=PANEL_PASSWORD
//   (para pegar una URL de exportación en una herramienta de IA sin pasar por el login).
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, cookieValida, passwordValida, tokenEsperado } from "@/lib/acceso";

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  // Sin variables de entorno el panel no puede funcionar. Antes esto devolvía un 500 con una
  // línea de texto: un mensaje que no dice cuál falta ni dónde se arregla manda a quien lo lee
  // al sitio equivocado. Ahora lleva a la página de puesta en marcha, que lo dice todo.
  if (!process.env.PANEL_PASSWORD || !process.env.DATABASE_URL) {
    const url = req.nextUrl.clone();
    url.pathname = "/instalacion";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (await cookieValida(req.cookies.get(COOKIE)?.value)) return NextResponse.next();

  // Un enlace con ?clave= no solo abre lo que pide: deja la cookie puesta. Así entrar es un
  // clic en vez de teclear una contraseña de catorce caracteres con mayúsculas y minúsculas
  // mezcladas — que es donde se atasca todo el mundo la primera vez. En una página se
  // redirige a la URL limpia (la clave deja de estar en la barra de direcciones); en una
  // exportación no, porque un redirect rompería la descarga.
  if (passwordValida(searchParams.get("clave"))) {
    const limpia = req.nextUrl.clone();
    limpia.searchParams.delete("clave");
    const res = pathname.startsWith("/api/") ? NextResponse.next() : NextResponse.redirect(limpia);
    res.cookies.set(COOKIE, await tokenEsperado(), {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
    return res;
  }

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/entrar";
  url.search = pathname !== "/" ? `?a=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/medidor|api/tareas|entrar|instalacion|_next/static|_next/image|favicon.ico|icono.svg).*)"],
};
