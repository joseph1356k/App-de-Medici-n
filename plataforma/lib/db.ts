// La conexión a Postgres. Un solo cliente por proceso (Vercel reutiliza el módulo entre
// invocaciones calientes). `prepare: false` porque el pooler de Supabase en modo
// transacción no soporta sentencias preparadas.
//
// Sin DATABASE_URL, postgres.js lee PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD — así se
// corre en local contra un Postgres de desarrollo sin tocar el código.
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __medidorSql: ReturnType<typeof postgres> | undefined;
}

function crear() {
  const url = process.env.DATABASE_URL;
  const local = !url || /localhost|127\.0\.0\.1|host=\//.test(url) || !!process.env.PGHOST;
  const opciones = {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : ("require" as const),
    transform: { undefined: null },
    // bigint y numeric llegan como número JS (no como texto): las sumas de milisegundos
    // caben de sobra en 2^53 y así la exportación y el panel no tienen que convertir.
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number | string) => `${x}`, parse: (x: string) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x: number | string) => `${x}`, parse: (x: string) => Number(x) },
    },
  };
  return url ? postgres(url, opciones) : postgres(opciones);
}

export const sql = globalThis.__medidorSql ?? (globalThis.__medidorSql = crear());
