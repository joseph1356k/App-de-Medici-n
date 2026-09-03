// El vocabulario vive en tres sitios (lib/vocabulario.ts, el CHECK de events.kind en
// schema.sql y el .exe). Si el CHECK y KINDS se separan, la base rechaza un evento legítimo
// y el .exe lo envenena: dato perdido en silencio. Esta prueba lo impide en CI.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { KINDS } from "../lib/vocabulario";
import { diaOperativoDe, finDiaOperativo, inicioDiaOperativo, sumarDias } from "../lib/fechas";

describe("KINDS == CHECK de events.kind", () => {
  it("la lista del esquema y la del servidor son la misma", () => {
    const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
    const m = sql.match(/kind text not null check \(kind in \(([\s\S]*?)\)\)/);
    expect(m).not.toBeNull();
    const delEsquema = new Set([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    expect([...delEsquema].sort()).toEqual([...KINDS].sort());
  });

  it("los kinds de la v1 (turnos, pausa) ya no existen", () => {
    for (const viejo of ["shift_start", "shift_end", "doctor_prompted", "pausa_usuario", "reanudar_usuario"]) expect(KINDS.has(viejo)).toBe(false);
    for (const nuevo of ["jornada_inicio", "jornada_fin", "hooks_rearmados", "spool_reset", "consultorio_asignado", "sap_scripting_no_disponible"]) expect(KINDS.has(nuevo)).toBe(true);
  });
});

describe("el día operativo (corte 06:00 Bogotá, sin horario de verano)", () => {
  it("05:59 es el día anterior y 06:01 el mismo día", () => {
    expect(diaOperativoDe("2026-09-02T10:59:00Z")).toBe("2026-09-01");
    expect(diaOperativoDe("2026-09-02T11:01:00Z")).toBe("2026-09-02");
    expect(diaOperativoDe(new Date("2026-09-02T04:00:00Z"))).toBe("2026-09-01"); // 23:00 del 1 en Bogotá
  });
  it("el día operativo va de 06:00 a 06:00 del siguiente, en UTC", () => {
    expect(inicioDiaOperativo("2026-09-01")).toBe("2026-09-01T11:00:00.000Z");
    expect(finDiaOperativo("2026-09-01")).toBe("2026-09-02T11:00:00.000Z");
    expect(sumarDias("2026-09-01", -1)).toBe("2026-08-31");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});
