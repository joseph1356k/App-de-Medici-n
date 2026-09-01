// Quién entra a qué:
//   /api/medidor/*, /api/tareas/*  → X-API-Key (lo comprueba cada route handler)
//   /entrar                        → libre
//   todo lo demás (panel y exportaciones) → cookie del panel, o ?clave=PANEL_PASSWORD
//   (para pegar una URL de exportación en una herramienta de IA sin pasar por el login).
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, cookieValida, passwordValida } from "@/lib/acceso";

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (!process.env.PANEL_PASSWORD) {
    return new NextResponse("Falta PANEL_PASSWORD en las variables de entorno del servidor.", { status: 500 });
  }
  if (await cookieValida(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (passwordValida(searchParams.get("clave"))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/entrar";
  url.search = pathname !== "/" ? `?a=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/medidor|api/tareas|entrar|_next/static|_next/image|favicon.ico|icono.svg).*)"],
};
