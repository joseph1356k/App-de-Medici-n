import { describe, it, expect } from "vitest";
import { candidatos } from "../lib/db";

describe("DATABASE_URL", () => {
  it("una URL del pooler de Supabase trae sola a su hermana (aws-0 ↔ aws-1)", () => {
    const c = candidatos("postgres://postgres.abc:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres");
    expect(c).toHaveLength(2);
    expect(c[1]).toContain("aws-1-us-east-1.pooler.supabase.com");
    const d = candidatos("postgres://postgres.abc:p@aws-1-us-east-1.pooler.supabase.com:6543/postgres");
    expect(d[1]).toContain("aws-0-us-east-1.pooler.supabase.com");
  });
  it("varias URLs separadas por coma se prueban en orden, sin duplicar", () => {
    const c = candidatos("postgres://a@x/db, postgres://b@aws-0-eu-west-1.pooler.supabase.com/db,postgres://b@aws-1-eu-west-1.pooler.supabase.com/db");
    expect(c).toEqual(["postgres://a@x/db", "postgres://b@aws-0-eu-west-1.pooler.supabase.com/db", "postgres://b@aws-1-eu-west-1.pooler.supabase.com/db"]);
  });
  it("sin URL no hay candidatos (se usan las variables PG*)", () => { expect(candidatos(undefined)).toEqual([]); });
});
