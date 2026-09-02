// PRUEBA DE TERRENO: el cliente de base contra un Postgres DE VERDAD.
//
// Los otros tests juzgan la lógica del reloj con una consulta de mentira. Esto juzga lo
// que de verdad falló el 2026-09-02 en producción: que una consulta colgada suelte su
// conexión, y que envolver el cliente en un Proxy no haya roto nada de lo que el panel
// usa (transacciones, sql.json, cursores de la exportación).
//
// Necesita un Postgres con el esquema aplicado, así que NO corre en `npm test`: corre en
// CI, en el job «esquema», que ya levanta uno. Con PRUEBA_TERRENO=1 y un PGURL.
import { describe, expect, it } from "vitest";

const URL_PRUEBA = process.env.PRUEBA_TERRENO_URL ?? "postgres://postgres@localhost:5432/postgres";
const corre = process.env.PRUEBA_TERRENO === "1";
process.env.DATABASE_URL = URL_PRUEBA;
process.env.DB_LIMITE_MS = "1500";
const { sql, sqlLargo } = corre
  ? await import("../lib/db")
  : ({ sql: null, sqlLargo: null } as unknown as typeof import("../lib/db"));

describe.skipIf(!corre)("el cliente con reloj contra Postgres de verdad", () => {
  it("consulta normal", async () => { expect((await sql`select 1 as n`)[0].n).toBe(1); });

  it("9 consultas a la vez, como el resumen", async () => {
    const t0 = Date.now();
    const r = await Promise.all(Array.from({ length: 9 }, (_, i) => sql`select ${i}::int as n, pg_sleep(0.05)`));
    expect(r.length).toBe(9);
    console.log(`   9 en paralelo: ${Date.now() - t0} ms`);
  });

  it("transacción (sql.begin)", async () => {
    await sql.begin(async (tx) => { await tx`select 1`; });
  });

  it("sql.json pasa intacto por el Proxy", async () => {
    const [d] = await sql<{ id: string }[]>`insert into devices (machine_name) values ('prueba-reloj') returning id`;
    await sql`insert into events (event_uid, device_id, shift_id, kind, occurred_at, detail)
      values ('prueba-reloj', ${d.id}::uuid, null, 'calidad', now(), ${sql.json({ a: 1 } as never)})
      on conflict (event_uid) do update set detail = excluded.detail`;
    const [ev] = await sql<{ detail: { a: number } }[]>`select detail from events where event_uid = 'prueba-reloj'`;
    expect(ev.detail.a).toBe(1);
    await sql`delete from events where event_uid = 'prueba-reloj'`;
    await sql`delete from devices where machine_name = 'prueba-reloj'`;
  });

  it("cursor de 500: la exportación en streaming sigue entera", async () => {
    let filas = 0;
    for await (const lote of sql`select generate_series(1, 1200) as n`.cursor(500)) filas += lote.length;
    expect(filas).toBe(1200);
  });

  it("PROMESA: una consulta colgada muere al vencer, y su conexión vuelve al pool", async () => {
    const t1 = Date.now();
    await expect(sql`select pg_sleep(30)`).rejects.toThrow(/no contestó en/);
    const tardo = Date.now() - t1;
    console.log(`   la colgada murió en ${tardo} ms (sin reloj: nunca)`);
    expect(tardo).toBeLessThan(4000);
    // Lo que de verdad estaba roto: que después de eso el panel siga vivo.
    const t2 = Date.now();
    expect((await sql`select 2 as n`)[0].n).toBe(2);
    console.log(`   y la siguiente consulta contestó en ${Date.now() - t2} ms`);
  });

  it("sqlLargo (el cron, sin reloj) funciona", async () => {
    expect((await sqlLargo`select 3 as n`)[0].n).toBe(3);
    await sqlLargo.end({ timeout: 5 });
  });
});
