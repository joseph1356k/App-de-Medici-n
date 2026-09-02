// EL RELOJ DE LAS CONSULTAS. En su propio archivo y SIN efectos secundarios, a propósito:
// lib/db.ts se conecta a la base al cargarse, así que esto no se podría probar desde ahí
// (mismo motivo por el que urls.ts vive aparte).
//
// postgres.js no tiene límite de espera: una consulta que no vuelve espera para siempre, y
// con ella espera su conexión del pool. El 2026-09-02 eso tumbó el panel — las cuatro
// conexiones atascadas en `ClientRead` entre 163 y 253 s, y toda consulta nueva haciendo
// cola detrás de conexiones muertas hasta que Vercel mataba la petición a los 300 s.

/** Le pone reloj a una consulta ya lanzada: si no vuelve a tiempo se cancela y se rechaza
 * con un motivo legible, en vez de retener su conexión hasta que alguien mate la petición.
 * Lo que no es una consulta (`sql.json(...)`, por ejemplo) pasa intacto. */
export function conReloj<T>(q: T, limiteMs: number): T {
  const p = q as { then?: unknown; cancel?: () => void } | null;
  if (!p || typeof p.then !== "function") return q;
  const original = (p.then as (...a: unknown[]) => Promise<unknown>).bind(p);
  p.then = (ok?: unknown, mal?: unknown) => {
    let reloj: ReturnType<typeof setTimeout>;
    const lanzada = original();
    lanzada.catch(() => {}); // la perdedora de la carrera no puede quedar sin dueño
    const vencimiento = new Promise<never>((_, rechaza) => {
      reloj = setTimeout(() => {
        // Cancelar es lo que DEVUELVE la conexión al pool. Sin esto el reloj solo dejaría
        // de esperar, y la conexión seguiría secuestrada: el problema entero.
        try { p.cancel?.(); } catch { /* si no se puede, al menos no seguimos esperando */ }
        rechaza(new Error(`La base de datos no contestó en ${Math.round(limiteMs / 1000)} s. La consulta se canceló para no bloquear el panel.`));
      }, limiteMs);
    });
    return Promise.race([lanzada, vencimiento])
      .finally(() => clearTimeout(reloj))
      .then(ok as never, mal as never);
  };
  return q;
}

/** El cliente de postgres.js con el reloj puesto por DEFECTO. Va en el cliente que todos
 * importan y no en cada llamada, para que una consulta nueva no pueda olvidarse de él.
 *
 * Los cursores (`.cursor()`, que usa la exportación en streaming) pasan intactos: no se
 * resuelven por `then`. A esos los cubre el servidor, con el `statement_timeout` y el
 * `idle_in_transaction_session_timeout` del rol `medicion_app`. */
export function conLimite<C extends object>(cliente: C, limiteMs: number): C {
  return new Proxy(cliente, {
    apply(destino, esto, args) {
      return conReloj(Reflect.apply(destino as never, esto, args), limiteMs);
    },
    get(destino, prop, receptor) {
      const v = Reflect.get(destino, prop, receptor);
      if (typeof v !== "function") return v;
      const f = v.bind(destino);
      // `begin` (transacciones) y `unsafe` también devuelven promesas: mismo reloj. Una
      // transacción colgada es justo lo que envenena el pool.
      return prop === "begin" || prop === "unsafe" ? (...a: unknown[]) => conReloj(f(...a), limiteMs) : f;
    },
  }) as C;
}
