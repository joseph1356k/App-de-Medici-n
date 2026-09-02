import { describe, expect, it, vi } from "vitest";
import { conLimite, conReloj } from "../lib/reloj";

/** Una consulta de mentira con la forma de la de postgres.js: es un `thenable` que además
 * se puede cancelar. Se resuelve cuando se le dice, o nunca. */
function consultaFalsa(resuelveEnMs: number | null) {
  let cancelada = false;
  const p = new Promise<string>((ok) => {
    if (resuelveEnMs != null) setTimeout(() => ok("filas"), resuelveEnMs);
  });
  return {
    then: (a?: never, b?: never) => p.then(a, b),
    cancel: () => { cancelada = true; },
    fueCancelada: () => cancelada,
  };
}

describe("el reloj de las consultas", () => {
  it("deja pasar una consulta que contesta a tiempo", async () => {
    await expect(conReloj(consultaFalsa(5), 200)).resolves.toBe("filas");
  });

  it("PROMESA: una consulta que no vuelve se rechaza al vencer el plazo, no espera para siempre", async () => {
    const inicio = Date.now();
    await expect(conReloj(consultaFalsa(null), 60)).rejects.toThrow(/no contestó en/);
    // Lo que importa: que TERMINE. Sin reloj esta espera no acababa nunca y era lo que
    // dejaba las conexiones colgadas en producción.
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it("PROMESA: al vencer, CANCELA la consulta — que es lo que devuelve la conexión al pool", async () => {
    const q = consultaFalsa(null);
    await expect(conReloj(q, 40)).rejects.toThrow();
    expect(q.fueCancelada()).toBe(true);
  });

  it("no toca lo que no es una consulta (sql.json y compañía pasan intactos)", () => {
    const parametro = { tipo: 3802, valor: { a: 1 } };
    expect(conReloj(parametro, 50)).toBe(parametro);
    expect(conReloj(null, 50)).toBe(null);
  });

  it("el cliente envuelto le pone reloj a la consulta y conserva sus métodos", async () => {
    const base = Object.assign(() => consultaFalsa(null), {
      json: (x: unknown) => ({ envuelto: x }),
      begin: () => consultaFalsa(null),
      cursor: () => "sin tocar",
    });
    const sql = conLimite(base, 40);
    await expect(sql()).rejects.toThrow(/no contestó en/);   // consulta normal
    await expect(sql.begin()).rejects.toThrow(/no contestó en/); // transacción: mismo reloj
    expect(sql.json({ a: 1 })).toEqual({ envuelto: { a: 1 } }); // no es consulta: intacto
  });

  it("un cursor no se toca: la exportación en streaming sigue funcionando", async () => {
    const q = Object.assign(consultaFalsa(5), { cursor: () => "iterador" });
    expect((conReloj(q, 40) as typeof q).cursor()).toBe("iterador");
  });

  it("una consulta lenta que sí acaba no deja un rechazo sin dueño", async () => {
    const espia = vi.fn();
    process.on("unhandledRejection", espia);
    await expect(conReloj(consultaFalsa(500), 30)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 600));
    process.off("unhandledRejection", espia);
    expect(espia).not.toHaveBeenCalled();
  });
});
