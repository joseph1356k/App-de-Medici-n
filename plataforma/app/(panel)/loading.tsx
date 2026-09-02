/**
 * La cabecera y el esqueleto salen AL INSTANTE mientras el servidor consulta la base.
 *
 * Sin esto, Next.js no manda ni un byte hasta que la página entera está lista: al pulsar
 * un enlace del menú no pasaba nada visible durante segundos y parecía colgado. Con este
 * archivo la navegación se siente inmediata aunque los datos tarden lo mismo.
 */
export default function Cargando() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div>
        <div className="h-6 w-64 animate-pulse rounded bg-plane" />
        <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-plane" />
      </div>
      <div className="tarjeta h-14 animate-pulse" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="tarjeta h-24 animate-pulse" />
        ))}
      </div>
      <div className="tarjeta h-64 animate-pulse" />
      <p className="text-center text-sm text-muted">Consultando la base…</p>
    </div>
  );
}
