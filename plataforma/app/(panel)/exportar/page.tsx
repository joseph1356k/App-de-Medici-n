import { Filtros } from "@/components/Filtros";
import { Seccion } from "@/components/ui";
import { consultoriosParaFiltro } from "@/lib/consultas";
import { DICCIONARIO } from "@/lib/diccionario";
import { COLUMNAS, type Coleccion } from "@/lib/exportar";
import { conFiltro, leerFiltros, type Sp } from "@/lib/filtros";

// Qué es cada colección, en palabras de aquí; las columnas salen de lib/exportar.ts para
// que esta página no se desfase de lo que de verdad se exporta.
const DESCRIPCION: Record<Coleccion, { titulo: string; texto: string; formatos: string[] }> = {
  jornadas: { titulo: "Jornadas", texto: "Una fila por consultorio y día operativo con todas las métricas agregadas. La tabla principal para analizar; se abre en Excel.", formatos: ["csv", "json"] },
  muestras: { titulo: "Muestras de 15 s", texto: "La serie temporal cruda: una fila por cubeta de 15 s y contexto (app · pantalla · paciente · usuario SAP). Puede ser grande; se transmite en streaming.", formatos: ["ndjson", "csv"] },
  visitas: { titulo: "Visitas SAP", texto: "Una fila por pantalla visitada: transacción, estadía, time-to-ready, espera al servidor, siguiente pantalla.", formatos: ["csv", "json"] },
  eventos: { titulo: "Eventos", texto: "Arranques y caídas del medidor, bloqueos, suspensiones, pacientes abiertos y cerrados, calidad, asignación de consultorio.", formatos: ["csv", "json"] },
};

/**
 * EXPORTAR: todos los datos, en formatos que una persona abre en Excel y una IA lee
 * sin explicaciones. El dataset JSON es AUTODESCRIPTIVO: lleva un bloque «_leeme» con
 * qué es cada campo, sus unidades y cómo interpretarlo.
 */
export default async function ExportarPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const f = leerFiltros(await searchParams);
  const consultorios = await consultoriosParaFiltro();
  const q = conFiltro(f, {});
  const colecciones = Object.keys(COLUMNAS) as Coleccion[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Exportar</h1>
        <p className="text-sm text-muted">Todos los datos del rango y consultorio elegidos. Sin contenido clínico: los pacientes son huellas, las pantallas son identidades técnicas, del tecleo solo hay cantidades.</p>
      </div>
      <Filtros f={f} consultorios={consultorios} ruta="/exportar" />

      <div className="grid gap-3 md:grid-cols-2">
        <a href={`/api/export/dataset.json${q}`} className="tarjeta block p-4 hover:border-accent md:col-span-2">
          <p className="font-medium text-ink">Dataset completo (JSON, para IA)</p>
          <p className="mt-1 text-sm text-muted">Un solo archivo con _leeme, consultorios, fases, médicos (anotación), dispositivos, jornadas, visitas SAP y eventos del rango. Añade <code>&amp;muestras=1</code> para incluir la serie de 15 s.</p>
          <p className="mt-2 font-mono text-xs text-accent">/api/export/dataset.json{q}</p>
        </a>
        {colecciones.map((col) => (
          <div key={col} className="tarjeta p-4">
            <p className="font-medium text-ink">{DESCRIPCION[col].titulo} <span className="font-normal text-muted">· {COLUMNAS[col].length} columnas</span></p>
            <p className="mt-1 text-sm text-muted">{DESCRIPCION[col].texto}</p>
            <p className="mt-2 flex flex-wrap gap-3 font-mono text-xs">
              {DESCRIPCION[col].formatos.map((ext) => <a key={ext} href={`/api/export/${col}.${ext}${q}`} className="text-accent hover:underline">{col}.{ext}</a>)}
            </p>
          </div>
        ))}
        <a href="/api/export/esquema.json" className="tarjeta block p-4 hover:border-accent">
          <p className="font-medium text-ink">Diccionario de datos (JSON)</p>
          <p className="mt-1 text-sm text-muted">Cada colección y cada campo explicados, con unidades. Para pegarlo en un prompt junto a los datos.</p>
          <p className="mt-2 font-mono text-xs text-accent">/api/export/esquema.json</p>
        </a>
      </div>

      <Seccion titulo="Para usar los datos con una IA" sub="Estas direcciones son públicas: se pegan tal cual en ChatGPT, Claude o un notebook, sin credenciales.">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
          <li>Descarga <code>dataset.json</code> del rango que te interese (o de un solo consultorio), o pégale la URL directamente a la herramienta.</li>
          <li>El bloque <code>_leeme</code> del archivo explica cada campo; no hace falta más contexto. Si la herramienta prefiere tablas, usa los CSV.</li>
          <li>Pregunta, por ejemplo: «Compara el tiempo activo por paciente y el trabajo post-atención entre baseline y notes, solo jornadas con calidad_ok, por consultorio».</li>
        </ol>
      </Seccion>

      <Seccion titulo="Diccionario de datos" sub="Lo mismo que va dentro de cada exportación.">
        <div className="space-y-4">
          {Object.entries(DICCIONARIO.colecciones).map(([nombre, col]) => (
            <details key={nombre} className="text-sm">
              <summary className="cursor-pointer font-medium text-ink">{nombre} <span className="font-normal text-muted">— {col.descripcion}</span></summary>
              <table className="tabla mt-2">
                <tbody>{Object.entries(col.campos).map(([campo, desc]) => <tr key={campo}><td className="w-64 font-mono text-xs text-secondary">{campo}</td><td className="text-secondary">{desc}</td></tr>)}</tbody>
              </table>
            </details>
          ))}
        </div>
      </Seccion>
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
