// La conexión a Postgres. Un solo cliente por proceso (Vercel reutiliza el módulo entre
// invocaciones calientes). `prepare: false` porque el pooler de Supabase en modo
// transacción no soporta sentencias preparadas.
//
// DATABASE_URL admite VARIAS URLs separadas por coma: se prueba cada una en orden y se
// queda con la primera que contesta. Y si la URL apunta a un pooler de Supabase
// (aws-0-… o aws-1-…), se añade sola la hermana: Supabase asigna cada proyecto a uno
// de los dos y no se sabe cuál sin entrar al panel, así que pegando cualquiera funciona.
//
// Sin DATABASE_URL, postgres.js lee PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD — así se
// corre en local contra un Postgres de desarrollo sin tocar el código.
import postgres from "postgres";
import { candidatos, sinClave } from "./urls";

export { candidatos } from "./urls";

type Cliente = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __medidorSql: Cliente | undefined;
}

function opciones(url: string | undefined) {
  const local = !url || /localhost|127\.0\.0\.1|host=\//.test(url) || !!process.env.PGHOST;
  return {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 12,
    ssl: local ? false : ("require" as const),
    transform: { undefined: null },
    // bigint y numeric llegan como número JS (no como texto): las sumas de milisegundos
    // caben de sobra en 2^53 y así la exportación y el panel no tienen que convertir.
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number | string) => `${x}`, parse: (x: string) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x: number | string) => `${x}`, parse: (x: string) => Number(x) },
    },
  };
}

async function elegir(): Promise<Cliente> {
  const urls = candidatos(process.env.DATABASE_URL);
  if (urls.length === 0) return postgres(opciones(undefined));
  let ultimo: unknown = null;
  for (const url of urls) {
    // El constructor DENTRO del try: una URL mal escrita lanza al construir, no al
    // consultar, y fuera del try se llevaba por delante a la siguiente candidata.
    let c: Cliente | null = null;
    try {
      c = postgres(url, opciones(url));
      await c`select 1`;
      if (urls.length > 1) console.log(`db: conectado a ${sinClave(url)}`);
      return c;
    } catch (e) {
      ultimo = e;
      console.warn(`db: ${sinClave(url)} no contestó: ${(e as Error).message}`);
      if (c) try { await c.end({ timeout: 1 }); } catch { /* nada */ }
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error("Ninguna DATABASE_URL contestó.");
}

export const sql: Cliente = globalThis.__medidorSql ?? (globalThis.__medidorSql = await elegir());
