"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";

const BASE = "/configuracion";
function volver(kind: "ok" | "error", msg: string): never {
  redirect(`${BASE}?${kind}=${encodeURIComponent(msg)}`);
}

/**
 * SUBE LA VERSIÓN DE LA CONFIG. Hay que llamarlo desde CUALQUIER cambio que los PCs tengan que
 * obedecer, porque el medidor solo vuelve a pedir la config cuando ve un número mayor que el
 * suyo (Programa.cs: `if (cv > _config.Version)`). Sin esto, guardar la lista de médicos la
 * dejaba viva en la base y muerta en los PCs: el panel decía «los PCs la reciben en su próximo
 * latido» y era mentira — el latido llegaba con la misma versión y el cliente no pedía nada.
 *
 * Se descubrió antes de cargar el primer roster del HGM (2026-09-02), no después.
 */
async function avisarALosPcs(): Promise<void> {
  await sql`update settings set config_version = config_version + 1, updated_at = now() where id = 1`;
}

export async function guardarHospital(formData: FormData): Promise<void> {
  const hospital = `${formData.get("hospital") ?? ""}`.trim().slice(0, 120);
  if (!hospital) volver("error", "El nombre no puede quedar vacío.");
  await sql`update settings set hospital = ${hospital}, updated_at = now() where id = 1`;
  revalidatePath("/", "layout");
  volver("ok", "Nombre guardado.");
}

/** Los consultorios: la unidad del estudio. Crear (sin id) o cambiar nombre, orden y si sigue
 * activo (con id). Nunca se borran: las muestras ya estampadas apuntan a ellos. */
export async function guardarConsultorio(formData: FormData): Promise<void> {
  const id = `${formData.get("id") ?? ""}`.trim();
  const nombre = `${formData.get("nombre") ?? ""}`.trim().slice(0, 60);
  const orden = Number(formData.get("orden") ?? 0);
  const activo = `${formData.get("activo") ?? "1"}` !== "0";
  if (!nombre) volver("error", "El consultorio necesita un nombre.");
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) volver("error", "Petición inválida.");
  try {
    if (id) {
      await sql`update consultorios set nombre = ${nombre}, orden = ${Number.isFinite(orden) ? orden : 0}, activo = ${activo} where id = ${id}::uuid`;
    } else {
      await sql`insert into consultorios (nombre, orden, activo)
        values (${nombre}, coalesce(nullif(${Number.isFinite(orden) ? orden : 0}, 0), (select coalesce(max(orden), 0) + 1 from consultorios)), ${activo})`;
    }
  } catch (e) {
    if (`${(e as Error).message}`.includes("consultorios_nombre_key")) volver("error", `Ya hay un consultorio llamado «${nombre}».`);
    throw e;
  }
  revalidatePath("/", "layout");
  volver("ok", id ? `Consultorio «${nombre}» guardado.` : `Consultorio «${nombre}» creado. Asígnale su PC en Dispositivos.`);
}

/** Roster: una línea por persona, «Nombre | USUARIO_SAP1, USUARIO_SAP2». Es una anotación:
 * pone nombre al usuario SAP visto en una jornada; lo ya medido no cambia. No borra: los
 * que ya no estén quedan inactivos. */
export async function guardarRoster(formData: FormData): Promise<void> {
  const lineas = `${formData.get("roster") ?? ""}`.split("\n").map((l) => l.trim()).filter(Boolean);
  const medicos = lineas.map((l, i) => {
    const [nombre, usuarios = ""] = l.split("|");
    return {
      display_name: nombre.trim().slice(0, 120),
      sap_users: usuarios.split(/[,\s;]+/).map((u) => u.trim().toUpperCase()).filter(Boolean),
      sort_order: i + 1,
    };
  }).filter((m) => m.display_name);
  if (medicos.length === 0) volver("error", "Escribe al menos un médico.");

  await sql.begin(async (tx) => {
    for (const m of medicos) {
      await tx`insert into roster (display_name, sap_users, active, sort_order)
        values (${m.display_name}, ${m.sap_users}, true, ${m.sort_order})
        on conflict (display_name) do update set sap_users = excluded.sap_users, active = true, sort_order = excluded.sort_order`;
    }
    await tx`update roster set active = false where display_name <> all(${medicos.map((m) => m.display_name)})`;
  });
  await avisarALosPcs();
  revalidatePath(BASE);
  volver("ok", `Lista guardada: ${medicos.length} nombres. Es una anotación opcional: los datos ya medidos no cambian.`);
}

export async function fijarFase(formData: FormData): Promise<void> {
  const phase = `${formData.get("phase") ?? ""}`;
  const starts = `${formData.get("starts") ?? ""}`;
  const ends = `${formData.get("ends") ?? ""}` || null;
  const notes = `${formData.get("notes") ?? ""}`.trim().slice(0, 200) || null;
  if (!["baseline", "notes", "notes_ops"].includes(phase) || !/^\d{4}-\d{2}-\d{2}$/.test(starts)) volver("error", "Faltan datos de la fase.");
  await sql`insert into study_phases (phase, starts_on, ends_on, notes) values (${phase}, ${starts}::date, ${ends}::date, ${notes})`;
  await sql`select relabel_phases()`;
  await avisarALosPcs();
  revalidatePath("/", "layout");
  volver("ok", `Fase «${phase}» fijada desde ${starts}. Las jornadas se re-etiquetaron según el calendario.`);
}

export async function borrarFase(formData: FormData): Promise<void> {
  const id = `${formData.get("id") ?? ""}`;
  if (!/^[0-9a-f-]{36}$/i.test(id)) volver("error", "Petición inválida.");
  await sql`delete from study_phases where id = ${id}::uuid`;
  await sql`select relabel_phases()`;
  await avisarALosPcs();
  revalidatePath("/", "layout");
  volver("ok", "Fase borrada y jornadas re-etiquetadas.");
}

/** La config que obedece el .exe. Se valida la forma y se sube la versión: cada PC la
 * pide al ver que su versión quedó vieja (en el siguiente latido). */
export async function guardarConfig(formData: FormData): Promise<void> {
  let cfg: Record<string, unknown>;
  try { cfg = JSON.parse(`${formData.get("config") ?? ""}`); }
  catch (e) { volver("error", `JSON inválido: ${(e as Error).message}`); }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) volver("error", "La config tiene que ser un objeto JSON.");
  const apps = cfg.apps_por_proceso;
  if (!apps || typeof apps !== "object" || Array.isArray(apps)) volver("error", "Falta «apps_por_proceso» (objeto proceso → app).");
  for (const [k, v] of Object.entries(apps as Record<string, unknown>))
    if (typeof v !== "string" || !/^[a-z0-9_]{1,32}$/.test(v)) volver("error", `apps_por_proceso.${k}: la app debe ser un nombre corto en minúscula (p. ej. "sap").`);
  const reglas = cfg.reglas_identidad ?? [];
  if (!Array.isArray(reglas)) volver("error", "«reglas_identidad» debe ser una lista.");
  for (const r of reglas as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || typeof r.patron !== "string") volver("error", "Cada regla necesita «id» y «patron».");
    try { new RegExp(r.patron); } catch { volver("error", `La regla «${r.id}» tiene una expresión regular inválida.`); }
    if (!["titulo_sap", "campo"].includes(`${r.fuente ?? "titulo_sap"}`)) volver("error", `La regla «${r.id}»: fuente debe ser titulo_sap o campo.`);
  }
  for (const k of ["dominios_permitidos", "dominios_miracle"]) if (cfg[k] != null && !Array.isArray(cfg[k])) volver("error", `«${k}» debe ser una lista.`);
  delete cfg.config_version;
  await sql`update settings set config = ${sql.json(cfg as never)}, config_version = config_version + 1, updated_at = now() where id = 1`;
  revalidatePath(BASE);
  volver("ok", "Config guardada con versión nueva. Los PCs la aplican en su próximo latido.");
}
