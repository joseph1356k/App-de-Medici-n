import { Seccion } from "@/components/ui";
import { ajustesDelPanel, fasesDelEstudio, roster } from "@/lib/consultas";
import { ETIQUETA_FASE, FASES, fmtFecha } from "@/lib/formato";
import { borrarFase, fijarFase, guardarConfig, guardarHospital, guardarRoster } from "./actions";

/**
 * CONFIGURACIÓN: lo que cambia sin tocar ningún PC. Los nombres del selector (roster) y
 * sus usuarios SAP, el calendario de fases, y la config que obedece el .exe (qué
 * proceso es qué app, cómo se extrae el identificador del paciente para hashearlo).
 */
export default async function ConfiguracionPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [a, medicos, fases] = await Promise.all([ajustesDelPanel(), roster(), fasesDelEstudio()]);
  const textoRoster = medicos.filter((m) => m.active).map((m) => `${m.display_name}${m.sap_users.length ? " | " + m.sap_users.join(", ") : ""}`).join("\n");
  const inactivos = medicos.filter((m) => !m.active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Configuración</h1>
        <p className="text-sm text-muted">Todo lo de aquí llega a los PCs en su siguiente latido (un minuto). No hay que reinstalar nada.</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-good-soft px-4 py-2 text-sm text-good-text">{sp.ok}</p>}
      {sp.error && <p className="rounded-lg bg-critical-soft px-4 py-2 text-sm text-critical">{sp.error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion titulo="Médicos del turno" sub="Los nombres que el médico elige en el icono. Una línea por médico; después de «|», sus usuarios de SAP (separados por coma) para que el turno se asigne solo al verlos en SAP.">
          <form action={guardarRoster} className="space-y-2">
            <textarea name="roster" rows={10} defaultValue={textoRoster} placeholder={"Dra. Ana Gómez | AGOMEZ\nDr. Luis Pérez | LPEREZ, LPEREZ2\n…"} className="campo w-full font-mono text-xs" />
            <div className="flex items-center gap-3">
              <button className="boton boton-primario">Guardar lista ({medicos.filter((m) => m.active).length})</button>
              {inactivos.length > 0 && <span className="text-xs text-muted">Inactivos (con turnos ya medidos): {inactivos.map((m) => m.display_name).join(", ")}</span>}
            </div>
          </form>
        </Seccion>

        <div className="space-y-6">
          <Seccion titulo="Hospital">
            <form action={guardarHospital} className="flex gap-2">
              <input name="hospital" defaultValue={a.hospital} className="campo flex-1" />
              <button className="boton">Guardar</button>
            </form>
          </Seccion>

          <Seccion titulo="Fases del estudio" sub="La fase de cada turno se deriva de este calendario por fecha operativa. Cambiarlo re-etiqueta el pasado sin tocar los datos.">
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
      </div>

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
