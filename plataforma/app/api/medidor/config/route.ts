// GET /api/medidor/config?device_id&config_version&hmac_version — refresco. Devuelve
// {unchanged:true} si el .exe ya tiene lo último; si no, config + roster + fases (y el
// secreto nuevo solo si rotó). Refresca last_seen_at.
import { sql } from "@/lib/db";
import { exigirClave, json } from "@/lib/api";
import { paqueteParaElMedidor } from "@/lib/ajustes";
import { num, uuidOrNull } from "@/lib/ingesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rechazo = exigirClave(req);
  if (rechazo) return rechazo;

  const sp = new URL(req.url).searchParams;
  const deviceId = uuidOrNull(sp.get("device_id"));
  if (!deviceId) return json({ error: "device_id inválido" }, 400);
  const cv = num(sp.get("config_version"), -1);
  const hv = num(sp.get("hmac_version"), -1);

  const [dev] = await sql<{ status: string }[]>`update devices set last_seen_at = now() where id = ${deviceId} returning status`;
  if (!dev) return json({ error: "Dispositivo no encontrado." }, 403);
  if (dev.status !== "active") return json({ error: "Dispositivo pausado o retirado.", status: dev.status }, 403);

  const [a] = await sql<{ config_version: number; hmac_version: number }[]>`select config_version, hmac_version from settings where id = 1`;
  if (a.config_version === cv && a.hmac_version === hv) return json({ unchanged: true });

  const paquete = await paqueteParaElMedidor(a.hmac_version !== hv);
  await sql`update devices set config_version = ${a.config_version}, hmac_version = ${a.hmac_version} where id = ${deviceId}`;
  return json({ ok: true, device_id: deviceId, ...paquete });
}
