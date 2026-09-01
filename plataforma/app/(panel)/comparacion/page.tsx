import { Filtros } from "@/components/Filtros";
import { Seccion, Vacio } from "@/components/ui";
import { medicosParaFiltro, porFase, porMedicoYFase, type FilaFase } from "@/lib/consultas";
import { leerFiltros, type Sp } from "@/lib/filtros";
import { ETIQUETA_FASE, FASES, fmtMin, fmtNum, fmtPct, fmtSeg, reduccion } from "@/lib/formato";

/**
 * COMPARACIÓN DE FASES: baseline vs Notes vs Notes+Operations, lado a lado. Es la
 * pregunta que el estudio existe para responder — «¿cuánto trabajo elimina Miracle?» —
 * con medianas por turno y solo turnos de buena calidad. Una fase sin datos se muestra
 * como «—», nunca como cero.
 */
export default async function ComparacionPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const f = leerFiltros({ rango: "todo", ...sp });
  const [fases, medicos, listaMedicos] = await Promise.all([porFase(f), porMedicoYFase(f), medicosParaFiltro()]);
  const por = Object.fromEntries(fases.map((x) => [x.phase, x])) as Record<string, FilaFase>;

  type Clave = keyof Omit<FilaFase, "phase" | "n" | "medicos">;
  const filas: { clave: Clave; label: string; fmt: (v: number | null) => string; menosEsMejor: boolean }[] = [
    { clave: "activo_med", label: "Tiempo activo en el PC por turno", fmt: fmtMin, menosEsMejor: true },
    { clave: "his_med", label: "Tiempo en SAP (HIS)", fmt: fmtMin, menosEsMejor: true },
    { clave: "miracle_med", label: "Tiempo en Miracle", fmt: fmtMin, menosEsMejor: false },
    { clave: "escritura_med", label: "Tiempo escribiendo", fmt: fmtMin, menosEsMejor: true },
    { clave: "clics_med", label: "Clics", fmt: fmtNum, menosEsMejor: true },
    { clave: "cambios_med", label: "Cambios de contexto", fmt: fmtNum, menosEsMejor: true },
    { clave: "encounters_med", label: "Pacientes por turno", fmt: fmtNum, menosEsMejor: false },
    { clave: "por_encounter_med", label: "Tiempo activo por paciente", fmt: fmtMin, menosEsMejor: true },
    { clave: "post_med", label: "Trabajo post-atención", fmt: fmtMin, menosEsMejor: true },
    { clave: "cola_med", label: "Cola al final del turno", fmt: fmtMin, menosEsMejor: true },
    { clave: "espera_sap_med", label: "Espera de SAP", fmt: fmtSeg, menosEsMejor: true },
    { clave: "ready_p95_med", label: "Pantalla lista (p95)", fmt: fmtSeg, menosEsMejor: true },
    { clave: "pantallas_med", label: "Pantallas SAP distintas", fmt: fmtNum, menosEsMejor: true },
    { clave: "consulta_med", label: "Duración de una consulta", fmt: fmtMin, menosEsMejor: true },
    { clave: "entre_consultas_med", label: "Hasta el siguiente paciente", fmt: fmtMin, menosEsMejor: true },
    { clave: "consultas_por_hora_med", label: "Pacientes por hora", fmt: (v) => fmtNum(v, 1), menosEsMejor: false },
    { clave: "interrupciones_med", label: "Interrupciones (vueltas a un paciente)", fmt: fmtNum, menosEsMejor: true },
    { clave: "revisitas_med", label: "Revisitas de pantalla en SAP", fmt: fmtNum, menosEsMejor: true },
    { clave: "carga_admin_med", label: "Carga en SAP (% del activo)", fmt: fmtPct, menosEsMejor: true },
    { clave: "copias_med", label: "Copiar", fmt: fmtNum, menosEsMejor: true },
    { clave: "pegados_med", label: "Pegar", fmt: fmtNum, menosEsMejor: true },
    { clave: "correcciones_med", label: "Correcciones (Backspace/Supr)", fmt: fmtNum, menosEsMejor: true },
    { clave: "tabs_med", label: "Tab", fmt: fmtNum, menosEsMejor: true },
    { clave: "enters_med", label: "Enter", fmt: fmtNum, menosEsMejor: true },
    { clave: "guardados_med", label: "Guardados (Ctrl+S)", fmt: fmtNum, menosEsMejor: true },
  ];
  const val = (fase: string, clave: Clave): number | null => { const v = por[fase]?.[clave]; return v == null ? null : Number(v); };
  const ultimaConDatos = [...FASES].reverse().find((x) => x !== "baseline" && por[x]?.n > 0) ?? null;

  const medicosIds = [...new Map(medicos.map((m) => [m.doctor_id ?? "anon", m.nombre])).entries()];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Comparación de fases</h1>
        <p className="text-sm text-muted">Antes de Miracle, con Miracle Notes, y con Notes + Operations — la misma vara para las tres. Medianas por turno, solo turnos de buena calidad.</p>
      </div>
      <Filtros f={f} medicos={listaMedicos} ruta="/comparacion" />

      {fases.length === 0 ? (
        <Vacio titulo="Sin datos de comparación" texto="Todavía no hay turnos de buena calidad en el rango." />
      ) : (
        <Seccion titulo="Por fase" sub={ultimaConDatos ? `«Reducción» compara el baseline con ${ETIQUETA_FASE[ultimaConDatos]}. Negativo = bajó.` : "La reducción aparece cuando haya turnos en una fase con Miracle."}>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Métrica</th>
                  {FASES.map((x) => <th key={x} className="num">{ETIQUETA_FASE[x]}<br /><span className="font-normal normal-case text-muted">n = {fmtNum(por[x]?.n ?? 0)} turnos · {fmtNum(por[x]?.medicos ?? 0)} médicos</span></th>)}
                  <th className="num">Reducción</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const base = val("baseline", fila.clave);
                  const despues = ultimaConDatos ? val(ultimaConDatos, fila.clave) : null;
                  const r = reduccion(base, despues);
                  const bueno = r.signo === 0 ? "text-ink" : (r.signo === 1) === fila.menosEsMejor ? "text-good-text" : "text-critical";
                  return (
                    <tr key={fila.clave}>
                      <td className="text-ink">{fila.label}</td>
                      {FASES.map((x) => <td key={x} className="num">{fila.fmt(val(x, fila.clave))}</td>)}
                      <td className={`num font-semibold ${bueno}`}>{r.texto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Seccion>
      )}

      {medicos.length > 0 && (
        <Seccion titulo="Por médico y fase" sub="Comparación pareada: el mismo médico antes y después. Activo · en SAP · post-atención · por paciente (medianas por turno).">
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Médico</th>{FASES.map((x) => <th key={x}>{ETIQUETA_FASE[x]}</th>)}</tr></thead>
              <tbody>
                {medicosIds.map(([id, nombre]) => (
                  <tr key={id}>
                    <td className="text-ink">{nombre}</td>
                    {FASES.map((x) => {
                      const m = medicos.find((y) => (y.doctor_id ?? "anon") === id && y.phase === x);
                      return (
                        <td key={x} className="tabular text-secondary">
                          {m ? <>{fmtMin(m.activo_med)} · {fmtMin(m.his_med)} · {fmtMin(m.post_med)} · {fmtMin(m.por_encounter_med)} <span className="text-muted">(n={m.n})</span></> : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Seccion>
      )}
    </div>
  );
}
