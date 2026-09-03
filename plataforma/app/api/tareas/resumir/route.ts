// GET /api/tareas/resumir — recomputa los resúmenes de jornada pendientes (y, con ?todo=1,
// TODOS: para cuando cambia la definición de una métrica). Lo llama el cron de Vercel una
// vez al día a las 06:30 de Bogotá, justo después del corte del día operativo
// (Authorization: Bearer CRON_SECRET; el plan Hobby solo permite crons diarios) y se puede
// llamar a mano con X-API-Key. El lote ya resume al instante: esto es la red de seguridad.
import { sqlLargo as sql } from "@/lib/db";
import { claveValida, json } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const ok = (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) || claveValida(req.headers.get("x-api-key")) || claveValida(bearer);
  if (!ok) return json({ error: "No autorizado" }, 401);

  const todo = new URL(req.url).searchParams.get("todo") === "1";
  if (todo) {
    const filas = await sql<{ device_id: string; dia: string }[]>`
      select x.device_id, x.dia_operativo::text as dia from (
        select device_id, dia_operativo from jornadas
        union
        select device_id, dia_operativo from jornada_summary
        union
        select distinct device_id, dia_operativo from samples) x
      order by x.dia_operativo, x.device_id`;
    for (const f of filas) await sql`select recompute_jornada(${f.device_id}::uuid, ${f.dia}::date)`;
    return json({ ok: true, resumidos: filas.length, modo: "todo" });
  }
  const [r] = await sql<{ n: number }[]>`select recompute_pending(500) as n`;
  return json({ ok: true, resumidos: r?.n ?? 0 });
}
