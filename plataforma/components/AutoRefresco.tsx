"use client";

// El refresco de las vistas «en vivo» (Inicio y el día de hoy). El layout es force-dynamic,
// así que `revalidate` no sirve: esta isla pide al router que vuelva a renderizar el
// servidor cada minuto, y solo si la pestaña está a la vista (una pestaña olvidada no
// tiene por qué gastar consultas). La hora que muestra es la del render del servidor:
// cuando el refresco llega, el prop cambia solo.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { fmtHora } from "@/lib/formato";

export function AutoRefresco({ ahora, cada = 60 }: { ahora: string; cada?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refrescar = () => { if (!document.hidden) router.refresh(); };
    const id = setInterval(refrescar, cada * 1000);
    document.addEventListener("visibilitychange", refrescar);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", refrescar); };
  }, [router, cada]);
  return (
    <span className="tabular text-xs text-muted" title={`Se actualiza solo cada ${cada} s mientras la pestaña está visible`}>
      actualizado {fmtHora(ahora)}
    </span>
  );
}
