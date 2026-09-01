"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, passwordValida, tokenEsperado } from "@/lib/acceso";

export async function entrar(formData: FormData): Promise<void> {
  if (!process.env.PANEL_PASSWORD) redirect("/instalacion");
  const password = `${formData.get("password") ?? ""}`;
  const a = `${formData.get("a") ?? ""}`;
  if (!passwordValida(password)) redirect(`/entrar?error=1${a ? `&a=${encodeURIComponent(a)}` : ""}`);

  const jar = await cookies();
  jar.set(COOKIE, await tokenEsperado(), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  redirect(a.startsWith("/") ? a : "/");
}

export async function salir(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  redirect("/entrar");
}
