"use client";

/**
 * Cuando la consulta falla, se DICE qué pasó y se puede reintentar sin recargar.
 *
 * Antes, un fallo de base se veía como una página en blanco o un giro infinito: el error
 * se lo quedaba el servidor y quien miraba el panel no tenía forma de distinguir «la base
 * no contesta» de «no hay datos todavía». Un mensaje que no distingue sus causas manda la
 * investigación al sitio equivocado.
 */
export default function ErrorDelPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const esTiempo = /no contestó en|timeout|ETIMEDOUT|ECONNRESET/i.test(error.message);
  return (
    <div className="tarjeta mx-auto max-w-2xl p-8">
      <p className="text-base font-medium text-critical">
        {esTiempo ? "La base de datos tardó demasiado en contestar." : "No se pudo cargar esta página."}
      </p>
      <p className="mt-2 text-sm text-secondary">
        {esTiempo
          ? "La consulta se canceló para no dejar el panel colgado. Suele ser pasajero: vuelve a intentarlo."
          : "El panel sigue en pie; lo que falló fue esta consulta."}
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-plane p-3 font-mono text-xs text-muted">{error.message}</pre>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">digest {error.digest}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={reset} className="boton boton-primario">Reintentar</button>
        <a href="/dispositivos" className="boton">Ver dispositivos</a>
      </div>
    </div>
  );
}
