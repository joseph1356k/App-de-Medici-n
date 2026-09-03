"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql, sqlLargo } from "@/lib/db";

function volver(kind: "ok" | "error", msg: string): never {
  redirect(`/dispositivos?${kind}=${encodeURIComponent(msg)}`);
}

const esUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export async function cambiarEstado(formData: FormData): Promise<void> {
  const id = `${formData.get("id") ?? ""}`;
  const estado = `${formData.get("estado") ?? ""}`;
  if (!esUuid(id) || !["active", "paused", "retired"].includes(estado)) volver("error", "Petición inválida.");
  await sql`update devices set status = ${estado} where id = ${id}::uuid`;
  revalidatePath("/dispositivos");
  revalidatePath("/");
  volver("ok", estado === "active" ? "Dispositivo reactivado." : estado === "paused" ? "Dispositivo pausado: el medidor dejará de enviar en su próximo latido." : "Dispositivo retirado.");
}

/** Asigna (o quita, con el valor vacío) el consultorio de un PC. La función de la base
 * estampa lo que ese PC mandó sin consultorio; puede ser mucho la primera vez, por eso va
 * por el cliente sin reloj. */
export async function asignarConsultorio(formData: FormData): Promise<void> {
  const id = `${formData.get("id") ?? ""}`;
  const consultorio = `${formData.get("consultorio") ?? ""}`;
  if (!esUuid(id) || (consultorio && !esUuid(consultorio))) volver("error", "Petición inválida.");
  const [r] = await sqlLargo<{ n_muestras: number; n_eventos: number; n_visitas: number; n_jornadas: number }[]>`
    select * from asignar_consultorio(${id}::uuid, ${consultorio || null}::uuid)`;
  revalidatePath("/dispositivos");
  revalidatePath("/", "layout");
  if (!consultorio) volver("ok", "El dispositivo quedó sin consultorio.");
  const estampadas = r ? r.n_muestras + r.n_visitas + r.n_eventos : 0;
  volver("ok", estampadas > 0
    ? `Consultorio asignado. Se completaron ${r.n_muestras.toLocaleString("es-CO")} muestras, ${r.n_visitas} visitas y ${r.n_eventos} eventos que estaban sin consultorio.`
    : "Consultorio asignado. El icono del PC lo muestra en su próximo latido.");
}
