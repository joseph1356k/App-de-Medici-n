// GET /api/tareas/resumir — recomputa los resúmenes pendientes (y, con ?todo=1, TODOS:
// para cuando cambia la definición de una métrica). Lo llama el cron de Vercel cada
// hora (Authorization: Bearer CRON_SECRET) y se puede llamar a mano con X-API-Key.
import { sql } from "@/lib/db";
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
    const filas = await sql<{ shift_id: string }[]>`select shift_id from shifts order by started_at`;
    for (const f of filas) await sql`select recompute_shift_summary(${f.shift_id}::uuid)`;
    return json({ ok: true, resumidos: filas.length, modo: "todo" });
  }
  const [r] = await sql<{ n: number }[]>`select recompute_pending(500) as n`;
  return json({ ok: true, resumidos: r?.n ?? 0 });
}
