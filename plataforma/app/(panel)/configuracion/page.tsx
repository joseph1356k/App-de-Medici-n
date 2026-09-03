import { Seccion } from "@/components/ui";
import { ajustesDelPanel, consultorios, fasesDelEstudio, roster } from "@/lib/consultas";
import { ETIQUETA_FASE, FASES, fmtFecha, fmtNum } from "@/lib/formato";
import { borrarFase, fijarFase, guardarConfig, guardarConsultorio, guardarHospital, guardarRoster } from "./actions";

/**
 * CONFIGURACIÓN: lo que cambia sin tocar ningún PC. Primero los consultorios (la unidad
 * del estudio), el nombre del hospital, el calendario de fases, los nombres para los
 * usuarios SAP (una anotación opcional) y la config que obedece el .exe (qué proceso es qué
 * app, cómo se extrae el identificador del paciente para hashearlo).
 */
export default async function ConfiguracionPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [a, lista, medicos, fases] = await Promise.all([ajustesDelPanel(), consultorios(), roster(), fasesDelEstudio()]);
  const textoRoster = medicos.filter((m) => m.active).map((m) => `${m.display_name}${m.sap_users.length ? " | " + m.sap_users.join(", ") : ""}`).join("\n");
  const inactivos = medicos.filter((m) => !m.active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Configuración</h1>
        <p className="text-sm text-muted">Todo lo de aquí llega a los PCs en su siguiente latido (un minuto). No hay que reinstalar nada.</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-good-soft px-4 py-2 text-sm text-good-text">{sp.ok}</p>}
      {sp.error && <p className="rounded-lg bg-critical-soft px-4 py-2 text-sm text-critical">{sp.error}</p>}

      <Seccion titulo="Consultorios" sub="La unidad del estudio: un consultorio, un PC compartido, una jornada por día. No se borran (las muestras ya estampadas apuntan a ellos): se desactivan. El PC de cada uno se asigna en Dispositivos.">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Nombre</th><th className="num">Orden</th><th>Activo</th><th className="num">PCs</th><th className="num">Jornadas</th><th></th></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td><form action={guardarConsultorio} id={`c-${c.id}`} className="contents"><input type="hidden" name="id" value={c.id} /><input name="nombre" defaultValue={c.nombre} required maxLength={60} className="campo w-48" /></form></td>
                  <td className="num"><input form={`c-${c.id}`} name="orden" type="number" defaultValue={c.orden} className="campo w-20 text-right" /></td>
                  <td>
                    <select form={`c-${c.id}`} name="activo" defaultValue={c.activo ? "1" : "0"} className="campo">
                      <option value="1">activo</option>
                      <option value="0">inactivo</option>
                    </select>
                  </td>
                  <td className="num">{fmtNum(c.dispositivos)}</td>
                  <td className="num">{fmtNum(c.jornadas)}</td>
                  <td><button form={`c-${c.id}`} className="boton">Guardar</button></td>
                </tr>
              ))}
              <tr>
                <td><form action={guardarConsultorio} id="c-nuevo" className="contents"><input name="nombre" placeholder="Nuevo consultorio…" maxLength={60} className="campo w-48" /></form></td>
                <td className="num"><input form="c-nuevo" name="orden" type="number" placeholder="auto" className="campo w-20 text-right" /></td>
                <td><input form="c-nuevo" type="hidden" name="activo" value="1" /><span className="text-xs text-muted">activo</span></td>
                <td className="num text-muted">—</td>
                <td className="num text-muted">—</td>
                <td><button form="c-nuevo" className="boton boton-primario">Crear</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Seccion>

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion titulo="Hospital">
          <form action={guardarHospital} className="flex gap-2">
            <input name="hospital" defaultValue={a.hospital} className="campo flex-1" />
            <button className="boton">Guardar</button>
          </form>
        </Seccion>

        <Seccion titulo="Fases del estudio" sub="La fase de cada jornada se deriva de este calendario por día operativo. Cambiarlo re-etiqueta el pasado sin tocar los datos.">
          <ul className="mb-3 space-y-1 text-sm">
            {fases.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5">
                <span><span className="font-medium text-ink">{ETIQUETA_FASE[f.phase] ?? f.phase}</span> <span className="text-muted">desde {fmtFecha(f.starts_on)}{f.ends_on ? ` hasta ${fmtFecha(f.ends_on)}` : ""}{f.notes ? ` · ${f.notes}` : ""}</span></span>
                <form action={borrarFase}><input type="hidden" name="id" value={f.id} /><button className="text-xs text-muted hover:text-critical">borrar</button></form>
              </li>
            ))}
            {fases.length === 0 && <li className="text-muted">Sin fases: todo cuenta como baseline.</li>}
          </ul>
          <form action={fijarFase} className="flex flex-wrap items-end gap-2">
            <select name="phase" className="campo">{FASES.map((f) => <option key={f} value={f}>{ETIQUETA_FASE[f]}</option>)}</select>
            <label className="text-xs text-muted">desde<br /><input name="starts" type="date" required className="campo" /></label>
            <label className="text-xs text-muted">hasta (opcional)<br /><input name="ends" type="date" className="campo" /></label>
            <input name="notes" placeholder="nota" className="campo w-32" />
            <button className="boton">Fijar fase</button>
          </form>
        </Seccion>
      </div>

      <Seccion titulo="Nombres para usuarios SAP (opcional)" sub="Una anotación: pone nombre al login de SAP que se ve en una jornada («Dra. Gómez» en vez de «AGOMEZ»). Una línea por persona; después de «|», sus usuarios de SAP separados por coma. No cambia nada de lo medido: la unidad del estudio es el consultorio.">
        <form action={guardarRoster} className="space-y-2">
          <textarea name="roster" rows={6} defaultValue={textoRoster} placeholder={"Dra. Ana Gómez | AGOMEZ\nDr. Luis Pérez | LPEREZ, LPEREZ2\n…"} className="campo w-full font-mono text-xs" />
          <div className="flex items-center gap-3">
            <button className="boton">Guardar lista ({medicos.filter((m) => m.active).length})</button>
            {inactivos.length > 0 && <span className="text-xs text-muted">Inactivos (con jornadas ya medidas): {inactivos.map((m) => m.display_name).join(", ")}</span>}
          </div>
        </form>
      </Seccion>

      <Seccion titulo={`Config del medidor (versión ${a.config_version})`} sub="Lo que obedece el .exe. «apps_por_proceso» dice qué proceso cuenta como qué app (el valor «sap» activa la lectura de pantallas). «reglas_identidad» dice de dónde sale el identificador del paciente que se hashea en el PC: el título de la ventana SAP (regex, se conserva solo el primer grupo) o un campo por selector. El crudo nunca sale del PC.">
        <form action={guardarConfig} className="space-y-2">
          <textarea name="config" rows={22} defaultValue={JSON.stringify(a.config, null, 2)} className="campo w-full font-mono text-xs" spellCheck={false} />
          <div className="flex items-center gap-3">
            <button className="boton boton-primario">Guardar config (sube a versión {a.config_version + 1})</button>
            <span className="text-xs text-muted">Secreto HMAC v{a.hmac_version} · última edición {fmtFecha(a.updated_at)}</span>
          </div>
        </form>
        <details className="mt-3 text-xs text-secondary">
          <summary className="cursor-pointer text-accent">Claves disponibles</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><code>apps_por_proceso</code>: {"{ \"saplogon.exe\": \"sap\", \"chrome.exe\": \"chrome\", … }"}. Lo que no está aquí cuenta como «otro».</li>
            <li><code>dominios_permitidos</code>: dominios web que se reportan como superficie (<code>web://dominio</code>). El resto de la web queda sin dominio.</li>
            <li><code>dominios_miracle</code>: dominios que cuentan como app «miracle_web».</li>
            <li><code>reglas_identidad</code>: lista de {"{ id, tcode (\"*\" o una transacción), fuente (\"titulo_sap\" | \"campo\"), selector (para campo), patron (regex .NET), normalizar (\"digitos_sin_ceros\" | \"tal_cual\") }"}.</li>
            <li><code>foreground_ms</code>, <code>sap_identity_ms</code>: cadencias de sondeo (ms). <code>solo_foreground</code>: true apaga las visitas SAP (solo tiempo por app).</li>
          </ul>
        </details>
      </Seccion>
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
