import Link from "next/link";
import { NavEnlace } from "@/components/NavEnlace";
import { ajustesDelPanel, faseHoy } from "@/lib/consultas";
import { ETIQUETA_FASE } from "@/lib/formato";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", texto: "Inicio", tambien: ["/consultorios"] },
  { href: "/jornadas", texto: "Jornadas" },
  { href: "/comparacion", texto: "Comparación" },
  { href: "/sap", texto: "Pantallas SAP" },
  { href: "/dispositivos", texto: "Dispositivos" },
  { href: "/configuracion", texto: "Configuración" },
  { href: "/exportar", texto: "Exportar" },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  let hospital = "Medidor", fase = "baseline", error: string | null = null;
  try {
    const [a, f] = await Promise.all([ajustesDelPanel(), faseHoy()]);
    hospital = a.hospital; fase = f;
  } catch (e) {
    error = `${(e as Error).message}`;
  }
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
            <span className="inline-block h-3 w-3 rounded-full bg-good" aria-hidden />
            Medidor · {hospital}
          </Link>
          <span className="chip border border-line bg-plane text-secondary" title="Fase del estudio vigente hoy, según el calendario de Configuración">
            Hoy: {ETIQUETA_FASE[fase] ?? fase}
          </span>
          <nav className="flex flex-wrap gap-1 text-sm print:hidden" aria-label="Secciones del panel">
            {NAV.map((n) => <NavEnlace key={n.href} href={n.href} tambien={n.tambien}>{n.texto}</NavEnlace>)}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {error && (
          <div className="rounded-xl border border-critical bg-critical-soft p-4 text-sm text-critical">
            <p className="font-semibold">No se pudo leer la base de datos.</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-ink">Revisa DATABASE_URL y que supabase/schema.sql esté aplicado (<code>npm run db:aplicar</code>).</p>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
