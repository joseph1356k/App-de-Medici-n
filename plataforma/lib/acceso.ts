// La barrera del panel: una contraseña (PANEL_PASSWORD) y una cookie HttpOnly con un
// HMAC derivado de ella. Cambiar la contraseña invalida todas las cookies. Web Crypto
// (no node:crypto) porque el middleware corre en el edge runtime.
export const COOKIE = "medidor_panel";

async function hmacHex(clave: string, mensaje: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(mensaje));
  return Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function tokenEsperado(password = process.env.PANEL_PASSWORD ?? ""): Promise<string> {
  return hmacHex(password, "panel-v1");
}

function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function cookieValida(valor: string | undefined | null): Promise<boolean> {
  if (!valor || !process.env.PANEL_PASSWORD) return false;
  return iguales(valor, await tokenEsperado());
}

export function passwordValida(intento: string | undefined | null): boolean {
  const esperada = process.env.PANEL_PASSWORD ?? "";
  return !!esperada && !!intento && iguales(intento, esperada);
}
