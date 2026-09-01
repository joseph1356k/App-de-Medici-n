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

export function candidatos(valor: string | undefined): string[] {
  if (!valor) return [];
  const lista = valor.split(",").map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const u of lista) {
    out.push(u);
    const m = u.match(/aws-([01])-([a-z0-9-]+)\.pooler\.supabase\.com/);
    if (m) {
      const hermana = u.replace(`aws-${m[1]}-${m[2]}.pooler`, `aws-${m[1] === "0" ? "1" : "0"}-${m[2]}.pooler`);
      if (!lista.includes(hermana)) out.push(hermana);
    }
  }
  return out;
}

async function elegir(): Promise<Cliente> {
  const urls = candidatos(process.env.DATABASE_URL);
  if (urls.length === 0) return postgres(opciones(undefined));
  let ultimo: unknown = null;
  for (const url of urls) {
    const c = postgres(url, opciones(url));
    try {
      await c`select 1`;
      if (urls.length > 1) console.log(`db: conectado a ${url.replace(/\/\/.*@/, "//…@")}`);
      return c;
    } catch (e) {
      ultimo = e;
      console.warn(`db: ${url.replace(/\/\/.*@/, "//…@")} no contestó: ${(e as Error).message}`);
      try { await c.end({ timeout: 1 }); } catch { /* nada */ }
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error("Ninguna DATABASE_URL contestó.");
}

export const sql: Cliente = globalThis.__medidorSql ?? (globalThis.__medidorSql = await elegir());
