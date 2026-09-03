/**
 * La cabecera y el esqueleto salen AL INSTANTE mientras el servidor consulta la base.
 *
 * Sin esto, Next.js no manda ni un byte hasta que la página entera está lista: al pulsar
 * un enlace del menú no pasaba nada visible durante segundos y parecía colgado. Con este
 * archivo la navegación se siente inmediata aunque los datos tarden lo mismo. La forma es
 * la de Inicio (tres tarjetas y una rejilla), que es la página que más se abre.
 */
export default function Cargando() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div>
        <div className="h-7 w-64 animate-pulse rounded bg-plane" />
        <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-plane" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="tarjeta space-y-3 p-4">
            <div className="h-5 w-32 animate-pulse rounded bg-plane" />
            <div className="h-8 w-40 animate-pulse rounded bg-plane" />
            <div className="h-12 animate-pulse rounded bg-plane" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-10 animate-pulse rounded bg-plane" />
              <div className="h-10 animate-pulse rounded bg-plane" />
              <div className="h-10 animate-pulse rounded bg-plane" />
            </div>
          </div>
        ))}
      </div>
      <div className="tarjeta h-44 animate-pulse" />
      <p className="text-center text-sm text-muted">Consultando la base…</p>
    </div>
  );
}
