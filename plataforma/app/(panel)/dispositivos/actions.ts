"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";

function volver(kind: "ok" | "error", msg: string): never {
  redirect(`/dispositivos?${kind}=${encodeURIComponent(msg)}`);
}

export async function cambiarEstado(formData: FormData): Promise<void> {
  const id = `${formData.get("id") ?? ""}`;
  const estado = `${formData.get("estado") ?? ""}`;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["active", "paused", "retired"].includes(estado)) volver("error", "Petición inválida.");
  await sql`update devices set status = ${estado} where id = ${id}::uuid`;
  revalidatePath("/dispositivos");
  volver("ok", estado === "active" ? "Dispositivo reactivado." : estado === "paused" ? "Dispositivo pausado: el medidor dejará de enviar en su próximo latido." : "Dispositivo retirado.");
}

export async function etiquetar(formData: FormData): Promise<void> {
  const id = `${formData.get("id") ?? ""}`;
  const label = `${formData.get("label") ?? ""}`.trim().slice(0, 60);
  if (!/^[0-9a-f-]{36}$/i.test(id)) volver("error", "Petición inválida.");
  await sql`update devices set label = ${label} where id = ${id}::uuid`;
  revalidatePath("/dispositivos");
  volver("ok", "Etiqueta guardada.");
}
