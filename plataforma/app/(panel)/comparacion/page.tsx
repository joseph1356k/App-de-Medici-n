import { Filtros } from "@/components/Filtros";
import { Seccion, Vacio } from "@/components/ui";
import { consultoriosParaFiltro, porConsultorioYFase, porFase, type FilaFase, type Medianas } from "@/lib/consultas";
import { leerFiltros, type Sp } from "@/lib/filtros";
import { ETIQUETA_FASE, FASES, fmtMin, fmtNum, fmtPct, fmtSeg, reduccion } from "@/lib/formato";

/**
 * COMPARACIÓN DE FASES: baseline vs Notes vs Notes+Operations, lado a lado. Es la
 * pregunta que el estudio existe para responder — «¿cuánto trabajo elimina Miracle?» —
 * con medianas por jornada y solo jornadas de buena calidad. Una fase sin datos se muestra
 * como «—», nunca como cero. Debajo, la misma comparación consultorio por consultorio
 * (pareada: el mismo sitio antes y después).
 */
export default async function ComparacionPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const f = leerFiltros({ rango: "todo", ...sp });
  const [fases, matriz, consultorios] = await Promise.all([porFase(f), porConsultorioYFase(f), consultoriosParaFiltro()]);
  const por = Object.fromEntries(fases.map((x) => [x.phase, x])) as Record<string, FilaFase>;

  type Clave = keyof Medianas;
  const filas: { clave: Clave; label: string; fmt: (v: number | null) => string; menosEsMejor: boolean; neutro?: boolean }[] = [
    { clave: "activo_med", label: "Tiempo activo en el PC por jornada", fmt: fmtMin, menosEsMejor: true },
    { clave: "his_med", label: "Tiempo en SAP (HIS)", fmt: fmtMin, menosEsMejor: true },
    { clave: "miracle_med", label: "Tiempo en Miracle", fmt: fmtMin, menosEsMejor: false },
    { clave: "escritura_med", label: "Tiempo escribiendo", fmt: fmtMin, menosEsMejor: true },
    { clave: "clics_med", label: "Clics", fmt: fmtNum, menosEsMejor: true },
    { clave: "cambios_med", label: "Cambios de contexto", fmt: fmtNum, menosEsMejor: true },
    { clave: "pacientes_med", label: "Pacientes por jornada", fmt: fmtNum, menosEsMejor: false },
    { clave: "por_paciente_med", label: "Tiempo activo por paciente", fmt: fmtMin, menosEsMejor: true },
    { clave: "post_med", label: "Trabajo post-atención", fmt: fmtMin, menosEsMejor: true },
    { clave: "espera_sap_med", label: "Espera de SAP", fmt: fmtSeg, menosEsMejor: true },
    { clave: "ready_p95_med", label: "Pantalla lista (p95)", fmt: fmtSeg, menosEsMejor: true },
    { clave: "pantallas_med", label: "Pantallas SAP distintas", fmt: fmtNum, menosEsMejor: true },
    { clave: "consulta_med", label: "Duración de una consulta", fmt: fmtMin, menosEsMejor: true },
    { clave: "entre_consultas_med", label: "Hasta el siguiente paciente", fmt: fmtMin, menosEsMejor: true },
    { clave: "pacientes_por_hora_med", label: "Pacientes por hora", fmt: (v) => fmtNum(v, 1), menosEsMejor: false },
    { clave: "interrupciones_med", label: "Interrupciones (vueltas a un paciente)", fmt: fmtNum, menosEsMejor: true },
    { clave: "revisitas_med", label: "Revisitas de pantalla en SAP", fmt: fmtNum, menosEsMejor: true },
    { clave: "carga_admin_med", label: "Carga en SAP (% del activo)", fmt: fmtPct, menosEsMejor: true },
    { clave: "tramos_ms_med", label: "Tiempo en tramos de actividad", fmt: fmtMin, menosEsMejor: true, neutro: true },
    { clave: "copias_med", label: "Copiar", fmt: fmtNum, menosEsMejor: true },
    { clave: "pegados_med", label: "Pegar", fmt: fmtNum, menosEsMejor: true },
    { clave: "correcciones_med", label: "Correcciones (Backspace/Supr)", fmt: fmtNum, menosEsMejor: true },
    { clave: "tabs_med", label: "Tab", fmt: fmtNum, menosEsMejor: true },
    { clave: "enters_med", label: "Enter", fmt: fmtNum, menosEsMejor: true },
    { clave: "guardados_med", label: "Guardados (Ctrl+S)", fmt: fmtNum, menosEsMejor: true },
    { clave: "bloqueado_med", label: "Tiempo bloqueado", fmt: fmtMin, menosEsMejor: true, neutro: true },
    { clave: "inactivo_med", label: "Tiempo inactivo (encendido sin input)", fmt: fmtMin, menosEsMejor: true, neutro: true },
    { clave: "sin_datos_med", label: "Sin datos (instrumento)", fmt: fmtMin, menosEsMejor: true, neutro: true },
    { clave: "cobertura_med", label: "Cobertura (instrumento)", fmt: fmtPct, menosEsMejor: false, neutro: true },
  ];
  const val = (fase: string, clave: Clave): number | null => { const v = por[fase]?.[clave]; return v == null ? null : Number(v); };
  const ultimaConDatos = [...FASES].reverse().find((x) => x !== "baseline" && por[x]?.n > 0) ?? null;

  // Las filas de la matriz: «Todos los consultorios» (consultorio_id null, orden 0) primero.
  const filasMatriz = [...new Map(matriz.map((m) => [m.consultorio_id ?? "todos", { id: m.consultorio_id, nombre: m.nombre, orden: m.orden }])).values()]
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const celda = (id: string | null, fase: string) => matriz.find((m) => (m.consultorio_id ?? null) === id && m.phase === fase);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Comparación de fases</h1>
        <p className="sub-pagina">Antes de Miracle, con Miracle Notes, y con Notes + Operations — la misma vara para las tres. Medianas por jornada, solo jornadas de buena calidad.</p>
      </div>
      <Filtros f={f} consultorios={consultorios} ruta="/comparacion" />

      {fases.length === 0 ? (
        <Vacio titulo="Sin datos de comparación" texto="Todavía no hay jornadas de buena calidad en el rango." />
      ) : (
        <Seccion titulo="Por fase" sub={ultimaConDatos ? `«Reducción» compara el baseline con ${ETIQUETA_FASE[ultimaConDatos]}. Negativo = bajó. Las filas del instrumento no se colorean.` : "La reducción aparece cuando haya jornadas en una fase con Miracle."}>
          <div className="caja-tabla">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Métrica</th>
                  {FASES.map((x) => <th key={x} className="num">{ETIQUETA_FASE[x]}<br /><span className="font-normal normal-case text-muted">n = {fmtNum(por[x]?.n ?? 0)} jornadas · {fmtNum(por[x]?.consultorios ?? 0)} consultorios</span></th>)}
                  <th className="num">Reducción</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const base = val("baseline", fila.clave);
                  const despues = ultimaConDatos ? val(ultimaConDatos, fila.clave) : null;
                  const r = reduccion(base, despues);
                  const bueno = fila.neutro || r.signo === 0 ? "text-ink" : (r.signo === 1) === fila.menosEsMejor ? "text-good-text" : "text-critical";
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

      {matriz.length > 0 && (
        <Seccion titulo="Por consultorio y fase" sub="Comparación pareada: el mismo consultorio antes y después. Activo · en SAP · pacientes · consulta mediana · post-atención · espera SAP (medianas por jornada, n = jornadas).">
          <div className="caja-tabla">
            <table className="tabla">
              <thead><tr><th>Consultorio</th>{FASES.map((x) => <th key={x}>{ETIQUETA_FASE[x]}</th>)}</tr></thead>
              <tbody>
                {filasMatriz.map((c) => (
                  <tr key={c.id ?? "todos"} className={c.id == null ? "font-semibold" : ""}>
                    <td className="whitespace-nowrap text-ink">{c.nombre}</td>
                    {FASES.map((x) => {
                      const m = celda(c.id, x);
                      return (
                        <td key={x} className="tabular text-secondary">
                          {m ? <>{fmtMin(m.activo_med)} · {fmtMin(m.his_med)} · {fmtNum(m.pacientes_med)} pac. · {fmtMin(m.consulta_med)} · {fmtMin(m.post_med)} · {fmtSeg(m.espera_sap_med)} <span className="font-normal text-muted">(n={m.n})</span></> : "—"}
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

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
