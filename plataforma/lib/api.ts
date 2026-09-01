// Barrera de la API del medidor: X-API-Key === MEDIDOR_API_KEY. Comparación en tiempo
// constante para no filtrar la clave por timing.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function claveValida(header: string | null | undefined, esperada = process.env.MEDIDOR_API_KEY): boolean {
  if (!header || !esperada) return false;
  const a = Buffer.from(header), b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function exigirClave(req: Request): NextResponse | null {
  if (!process.env.MEDIDOR_API_KEY) return NextResponse.json({ error: "El servidor no tiene MEDIDOR_API_KEY configurada." }, { status: 500 });
  if (!claveValida(req.headers.get("x-api-key"))) return NextResponse.json({ error: "Clave inválida." }, { status: 401 });
  return null;
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
