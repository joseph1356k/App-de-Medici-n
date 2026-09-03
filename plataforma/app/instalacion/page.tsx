import { candidatos } from "@/lib/urls";

/**
 * LA PÁGINA DE PUESTA EN MARCHA. Aparece cuando el servidor todavía no tiene sus variables
 * de entorno — antes esto era un 500 con una línea de texto sobre fondo negro, que es
 * exactamente el mensaje que no distingue sus causas: no decía cuál faltaba, ni dónde se
 * arregla, ni si la base de datos respondía.
 *
 * Muestra QUÉ falta y CÓMO se arregla, y comprueba la conexión a la base si hay URL. Nunca
 * muestra el valor de una variable: solo si el servidor la ve. Es pública a propósito (sin
 * ella no hay forma de entrar), y por eso no revela ningún secreto.
 */
export const dynamic = "force-dynamic";

type Estado = { nombre: string; ok: boolean; para: string };

async function probarBase(): Promise<{ ok: boolean; detalle: string }> {
  if (!process.env.DATABASE_URL) return { ok: false, detalle: "sin URL" };
  try {
    // Import dinámico: lib/db se conecta al cargarse, y si la URL es mala lanzaría al
    // renderizar esta página — que es justo la que tiene que seguir viéndose.
    const { sql } = await import("@/lib/db");
    const [r] = await sql<{ hospital: string; tablas: number }[]>`
      select (select hospital from settings where id = 1) as hospital,
             (select count(*)::int from information_schema.tables
               where table_name in ('settings','roster','devices','consultorios','jornadas','samples','events','sap_visits','jornada_summary','study_phases')) as tablas`;
    if (!r?.tablas) return { ok: false, detalle: "conecta, pero faltan las tablas: aplica supabase/schema.sql" };
    return { ok: true, detalle: `conecta · ${r.tablas} tablas · ${r.hospital ?? "sin nombre"}` };
  } catch (e) {
    return { ok: false, detalle: `${(e as Error).message}`.slice(0, 200) };
  }
}

export default async function InstalacionPage() {
  const base = await probarBase();
  const urls = candidatos(process.env.DATABASE_URL).length;

  const vars: Estado[] = [
    { nombre: "DATABASE_URL", ok: !!process.env.DATABASE_URL, para: "dónde se guardan los datos (Postgres/Supabase)" },
    { nombre: "MEDIDOR_API_KEY", ok: !!process.env.MEDIDOR_API_KEY, para: "la clave con la que los PCs envían sus datos" },
  ];
  const faltan = vars.filter((v) => !v.ok);
  const listo = faltan.length === 0 && base.ok;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="tarjeta p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className={`inline-block h-3 w-3 rounded-full ${listo ? "bg-good" : "bg-warning"}`} aria-hidden />
          <h1 className="text-lg font-semibold text-ink">
            {listo ? "Servidor listo" : "Falta configurar el servidor"}
          </h1>
        </div>

        {listo ? (
          <div className="text-sm text-secondary">
            <p>Todo en su sitio. <a href="/" className="text-accent underline">Ir al panel →</a></p>
            <p className="mt-4 font-medium text-ink">Después</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Instala <span className="font-mono">Medidor.exe</span> en el PC de cada consultorio (doble clic; se registra solo y se vigila a sí mismo).</li>
              <li>En <a href="/dispositivos" className="text-accent underline">Dispositivos</a>, asigna cada PC a su consultorio: el icono del PC pasa de ámbar a verde en ≤ 2 min y la tarjeta aparece en Inicio.</li>
              <li>Revisa el calendario de fases en <a href="/configuracion" className="text-accent underline">Configuración</a> (sin fases, todo cuenta como baseline).</li>
            </ol>
          </div>
        ) : (
          <p className="mb-5 text-sm text-secondary">
            La plataforma está desplegada, pero todavía no sabe dónde guardar los datos ni con qué
            clave le hablan los PCs. Eso se arregla en un sitio y no se vuelve a tocar.
          </p>
        )}

        <ul className="mb-5 space-y-2">
          {vars.map((v) => (
            <li key={v.nombre} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2">
              <span className={`mt-0.5 text-sm ${v.ok ? "text-good-text" : "text-critical"}`}>{v.ok ? "✓" : "✗"}</span>
              <span className="text-sm">
                <span className="font-mono text-ink">{v.nombre}</span>
                <span className="text-muted"> — {v.para}</span>
                {!v.ok && <span className="ml-1 font-medium text-critical">falta</span>}
              </span>
            </li>
          ))}
          <li className="flex items-start gap-3 rounded-lg border border-line px-3 py-2">
            <span className={`mt-0.5 text-sm ${base.ok ? "text-good-text" : "text-muted"}`}>{base.ok ? "✓" : "·"}</span>
            <span className="text-sm">
              <span className="text-ink">Base de datos</span>
              <span className="text-muted"> — {base.detalle}</span>
              {urls > 1 && <span className="text-muted"> ({urls} URLs a probar)</span>}
            </span>
          </li>
        </ul>

        {!listo && (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-secondary">
            <li>
              Abre <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="text-accent underline">vercel.com/dashboard</a>,
              entra a este proyecto y ve a <span className="text-ink">Settings → Environment Variables</span>.
            </li>
            <li>Añade {faltan.length === 1 ? "la variable que falta" : `las ${faltan.length} variables que faltan`}, marcando los tres entornos (Production, Preview, Development).</li>
            <li>Vuelve a <span className="text-ink">Deployments</span>, abre el último y pulsa <span className="text-ink">Redeploy</span>: las variables solo entran en un despliegue nuevo.</li>
            <li>Recarga esta página. Cuando el círculo de arriba esté verde, el panel funciona.</li>
          </ol>
        )}

        <p className="mt-5 border-t border-line pt-4 text-xs text-muted">
          Esta página no muestra el valor de ninguna variable, solo si el servidor la ve. Los pasos
          completos están en <span className="font-mono">docs/INSTALAR.md</span> del repositorio.
        </p>
      </div>
    </main>
  );
}
