// Aplica supabase/schema.sql a la base de DATABASE_URL (o PG*). `npm run db:aplicar`.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const local = !url || /localhost|127\.0\.0\.1|host=\//.test(url) || !!process.env.PGHOST;
const sql = url ? postgres(url, { ssl: local ? false : "require", max: 1 }) : postgres({ max: 1 });
const esquema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
try {
  await sql.unsafe(esquema);
  const [{ n }] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
  console.log(`Esquema aplicado. Tablas en public: ${n}.`);
} finally {
  await sql.end();
}
