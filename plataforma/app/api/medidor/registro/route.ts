// POST /api/medidor/registro — el .exe se presenta al arrancar. Devuelve su identidad
// (device_id), el secreto HMAC, la config, el consultorio asignado, el roster y las fases. Sin códigos de
// enrolamiento: la clave de la API ya autentica la instalación; el device se reconoce
// por el device_id que guardó, o si no, por el nombre de la máquina (reinstalar en el
// mismo PC no crea un dispositivo nuevo).
import { sql } from "@/lib/db";
import { exigirClave, json } from "@/lib/api";
import { paqueteParaElMedidor } from "@/lib/ajustes";
import { str, uuidOrNull } from "@/lib/ingesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rechazo = exigirClave(req);
  if (rechazo) return rechazo;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const pedido = uuidOrNull(body.device_id);
  const machine = str(body.machine_name).slice(0, 80);
  const os = str(body.os_version).slice(0, 80);
  const appv = str(body.app_version).slice(0, 40);

  const [ajustes] = await sql<{ config_version: number; hmac_version: number }[]>`select config_version, hmac_version from settings where id = 1`;
  if (!ajustes) return json({ error: "Aplica supabase/schema.sql primero." }, 500);

  let device: { id: string; status: string } | undefined;
  if (pedido) {
    [device] = await sql<{ id: string; status: string }[]>`
      update devices set machine_name = coalesce(nullif(${machine}, ''), machine_name), os_version = ${os}, app_version = ${appv},
        last_seen_at = now(), hmac_version = ${ajustes.hmac_version}, config_version = ${ajustes.config_version}
      where id = ${pedido} returning id, status`;
  }
  if (!device && machine) {
    [device] = await sql<{ id: string; status: string }[]>`
      update devices set os_version = ${os}, app_version = ${appv}, last_seen_at = now(),
        hmac_version = ${ajustes.hmac_version}, config_version = ${ajustes.config_version}
      where machine_name = ${machine} and status <> 'retired' returning id, status`;
  }
  if (!device) {
    [device] = await sql<{ id: string; status: string }[]>`
      insert into devices (machine_name, os_version, app_version, hmac_version, config_version)
      values (${machine}, ${os}, ${appv}, ${ajustes.hmac_version}, ${ajustes.config_version}) returning id, status`;
  }
  if (device.status !== "active") return json({ error: "Dispositivo pausado o retirado.", status: device.status }, 403);

  const paquete = await paqueteParaElMedidor(true, device.id);
  return json({ ok: true, device_id: device.id, ...paquete });
}
