import { Filtros } from "@/components/Filtros";
import { Seccion } from "@/components/ui";
import { medicosParaFiltro } from "@/lib/consultas";
import { conFiltro, leerFiltros, type Sp } from "@/lib/filtros";
import { DICCIONARIO } from "@/lib/diccionario";

/**
 * EXPORTAR: todos los datos, en formatos que una persona abre en Excel y una IA lee
 * sin explicaciones. El dataset JSON es AUTODESCRIPTIVO: lleva un bloque «_leeme» con
 * qué es cada campo, sus unidades y cómo interpretarlo.
 */
export default async function ExportarPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const f = leerFiltros(await searchParams);
  const medicos = await medicosParaFiltro();
  const q = conFiltro(f, {});
  const enlaces = [
    { href: `/api/export/dataset.json${q}`, titulo: "Dataset completo (JSON, para IA)", texto: "Un solo archivo con _leeme, fases, médicos, dispositivos, turnos resumidos, visitas SAP y eventos del rango. Añade &muestras=1 para incluir la serie de 15 s." },
    { href: `/api/export/turnos.csv${q}`, titulo: "Turnos (CSV)", texto: "Una fila por turno con todas las métricas agregadas. Se abre en Excel." },
    { href: `/api/export/turnos.json${q}`, titulo: "Turnos (JSON)", texto: "Lo mismo, en JSON." },
    { href: `/api/export/visitas.csv${q}`, titulo: "Visitas SAP (CSV)", texto: "Una fila por pantalla visitada: transacción, estadía, time-to-ready, espera, siguiente pantalla." },
    { href: `/api/export/eventos.csv${q}`, titulo: "Eventos (CSV)", texto: "Turnos abiertos/cerrados, pacientes abiertos, bloqueos, pausas, calidad." },
    { href: `/api/export/muestras.ndjson${q}`, titulo: "Muestras de 15 s (NDJSON)", texto: "La serie temporal cruda: una línea JSON por cubeta de 15 s y contexto. Puede ser grande; se transmite en streaming." },
    { href: `/api/export/muestras.csv${q}`, titulo: "Muestras de 15 s (CSV)", texto: "La misma serie, en CSV." },
    { href: `/api/export/esquema.json`, titulo: "Diccionario de datos (JSON)", texto: "Cada colección y cada campo explicados, con unidades. Para pegarlo en un prompt junto a los datos." },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Exportar</h1>
        <p className="text-sm text-muted">Todos los datos del rango elegido. Sin contenido clínico: los pacientes son huellas, las pantallas son identidades técnicas, del tecleo solo hay cantidades.</p>
      </div>
      <Filtros f={f} medicos={medicos} ruta="/exportar" />

      <div className="grid gap-3 md:grid-cols-2">
        {enlaces.map((e) => (
          <a key={e.href} href={e.href} className="tarjeta block p-4 hover:border-accent">
            <p className="font-medium text-ink">{e.titulo}</p>
            <p className="mt-1 text-sm text-muted">{e.texto}</p>
            <p className="mt-2 font-mono text-xs text-accent">{e.href}</p>
          </a>
        ))}
      </div>

      <Seccion titulo="Para usar los datos con una IA" sub="Una URL de exportación admite ?clave=CONTRASEÑA_DEL_PANEL en vez de la cookie, para pegarla en una herramienta (ChatGPT, Claude, un notebook) sin iniciar sesión. Trátala como una contraseña.">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
          <li>Descarga <code>dataset.json</code> del rango que te interese (o pásale la URL con <code>&clave=…</code> a la herramienta).</li>
          <li>El bloque <code>_leeme</code> del archivo explica cada campo; no hace falta más contexto. Si la herramienta prefiere tablas, usa los CSV.</li>
          <li>Pregunta, por ejemplo: «Compara el tiempo activo por paciente y el trabajo post-atención entre baseline y notes, solo turnos con calidad_ok, por médico».</li>
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
