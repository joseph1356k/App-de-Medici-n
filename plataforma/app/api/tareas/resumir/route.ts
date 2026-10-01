// GET /api/tareas/resumir — recomputa los resúmenes de jornada pendientes (y, con ?todo=1,
// TODOS: para cuando cambia la definición de una métrica) y después ARCHIVA las jornadas
// cerradas. Lo llama el cron de Vercel una vez al día a las 06:30 de Bogotá, justo después del
// corte del día operativo (Authorization: Bearer CRON_SECRET; el plan Hobby solo permite crons
// diarios) y se puede llamar a mano con X-API-Key. El lote ya resume al instante: esto es la red
// de seguridad.
//
// EL ARCHIVO (schema.sql § El archivo). Las cubetas y los eventos de una jornada de más de
// DIAS_CALIENTES días operativos pasan de `samples` y `events` a una fila comprimida por PC y
// día. No se pierde nada, y el panel las sigue leyendo por `samples_todas` y `events_todas`.
// Va DESPUÉS de resumir, para que lo que se archiva ya esté resumido, y por tandas cortas: el
// rol de la app tiene un statement_timeout de 55 s y una tanda de 5 jornadas tarda ~6 s.
import { sqlLargo as sql } from "@/lib/db";
import { claveValida, json } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DIAS_CALIENTES = 7;
const JORNADAS_POR_TANDA = 5;
// Lo normal son las 3 o 4 jornadas que se cerraron ayer. El tope es para el día que haya atraso:
// lo que no quepa en esta corrida lo recoge la de mañana.
const TANDAS_MAXIMAS = 30;

type Archivadas = { jornadas: number; muestras: number; eventos: number; error?: string };

async function archivarCerradas(): Promise<Archivadas> {
  const total: Archivadas = { jornadas: 0, muestras: 0, eventos: 0 };
  try {
    for (let i = 0; i < TANDAS_MAXIMAS; i++) {
      const [t] = await sql<{ jornadas: number; n_muestras: number; n_eventos: number }[]>`
        select jornadas, n_muestras, n_eventos from archivar_cerradas(${DIAS_CALIENTES}, ${JORNADAS_POR_TANDA})`;
      if (!t || t.jornadas === 0) break;
      total.jornadas += t.jornadas; total.muestras += t.n_muestras; total.eventos += t.n_eventos;
    }
  } catch (err) {
    // Archivar es ahorro de espacio, no una promesa del panel: si falla, lo resumido se queda
    // resumido y las filas siguen donde estaban. Pero se dice, no se calla.
    total.error = `${(err as Error)?.message ?? err}`.slice(0, 200);
    console.error("archivar", total.error);
  }
  return total;
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const ok = (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) || claveValida(req.headers.get("x-api-key")) || claveValida(bearer);
  if (!ok) return json({ error: "No autorizado" }, 401);

  const todo = new URL(req.url).searchParams.get("todo") === "1";
  if (todo) {
    // Las jornadas archivadas ya no tienen filas en `samples`, pero todas tienen resumen: salen
    // por `jornada_summary`, y `recompute_jornada` las lee del archivo.
    const filas = await sql<{ device_id: string; dia: string }[]>`
      select x.device_id, x.dia_operativo::text as dia from (
        select device_id, dia_operativo from jornadas
        union
        select device_id, dia_operativo from jornada_summary
        union
        select distinct device_id, dia_operativo from samples) x
      order by x.dia_operativo, x.device_id`;
    for (const f of filas) await sql`select recompute_jornada(${f.device_id}::uuid, ${f.dia}::date)`;
    return json({ ok: true, resumidos: filas.length, modo: "todo", archivadas: await archivarCerradas() });
  }
  return json({ ok: true, resumidos: await resumirPendientes(), archivadas: await archivarCerradas() });
}

// POR TANDAS, y no `recompute_pending(500)` de una vez. Una jornada tarda de 1 a 2,5 s en
// resumirse y el rol de la app corta cualquier sentencia a los 55 s: con más de ~25 pendientes,
// la sentencia única moría entera y no resumía NINGUNA. El 2026-10-01 había 45 jornadas ya
// cerradas marcadas sucias, 43 de ellas sin recalcular desde hacía más de dos días y la más vieja
// desde el 8 de septiembre: resúmenes a los que les faltaban los últimos minutos de su día.
const POR_TANDA = 5;
const PRESUPUESTO_MS = 200_000;

async function resumirPendientes(): Promise<number> {
  const inicio = Date.now();
  let total = 0;
  while (Date.now() - inicio < PRESUPUESTO_MS) {
    const [r] = await sql<{ n: number }[]>`select recompute_pending(${POR_TANDA}) as n`;
    const n = r?.n ?? 0;
    total += n;
    if (n < POR_TANDA) break;
  }
  return total;
}
