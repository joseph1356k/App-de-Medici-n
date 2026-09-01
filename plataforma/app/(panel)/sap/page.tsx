import { Filtros } from "@/components/Filtros";
import { Barras } from "@/components/Barras";
import { Seccion, Vacio } from "@/components/ui";
import { medicosParaFiltro, pantallasSap, rutasSap, superficiesSap } from "@/lib/consultas";
import { leerFiltros, type Sp } from "@/lib/filtros";
import { fmtNum, fmtSeg } from "@/lib/formato";

/**
 * PANTALLAS SAP: dónde se concentra la fricción del HIS. Por transacción: cuántas
 * visitas, cuánto dura una estadía, cuánto tarda la pantalla en estar lista, cuánto
 * se espera al servidor. Y las rutas más frecuentes de una transacción a otra.
 */
export default async function SapPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const f = leerFiltros(await searchParams);
  const [pantallas, superficies, rutas, medicos] = await Promise.all([pantallasSap(f), superficiesSap(f), rutasSap(f), medicosParaFiltro()]);
  const totalVisitas = pantallas.reduce((s, p) => s + p.visitas, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Pantallas SAP</h1>
        <p className="text-sm text-muted">Las transacciones y pantallas por las que pasan los médicos, con sus tiempos. Identidad técnica de la pantalla (SID/transacción/programa/dynpro), nunca su contenido.</p>
      </div>
      <Filtros f={f} medicos={medicos} ruta="/sap" />

      {pantallas.length === 0 ? (
        <Vacio titulo="Sin visitas SAP en el rango" texto="Las visitas necesitan SAP GUI Scripting habilitado en el PC (sapgui/user_scripting = TRUE). Sin él, el medidor cuenta el tiempo en SAP pero no ve las pantallas." />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <Seccion titulo="Transacciones más visitadas" sub={`${fmtNum(totalVisitas)} visitas en el rango`}>
                <Barras ariaLabel="Visitas por transacción" items={pantallas.slice(0, 12).map((p) => ({ id: p.tcode, etiqueta: p.tcode, valor: p.visitas, texto: fmtNum(p.visitas) }))} />
              </Seccion>
            </div>
            <div className="lg:col-span-3">
              <Seccion titulo="Tiempos por transacción" sub="Medianas por visita. «Lista en» = time-to-ready (llegada → primer fin de round-trip sin ocupado). «Espera» = suma de round-trips en la visita.">
                <div className="overflow-x-auto">
                  <table className="tabla">
                    <thead><tr><th>Transacción</th><th className="num">Visitas</th><th className="num">Turnos</th><th className="num">Pacientes</th><th className="num">Estadía</th><th className="num">Lista en p50</th><th className="num">p95</th><th className="num">Espera</th><th className="num">Round-trips</th></tr></thead>
                    <tbody>
                      {pantallas.map((p) => (
                        <tr key={p.tcode}>
                          <td className="font-mono text-xs text-ink">{p.tcode}</td>
                          <td className="num">{fmtNum(p.visitas)}</td>
                          <td className="num">{fmtNum(p.turnos)}</td>
                          <td className="num">{fmtNum(p.encounters)}</td>
                          <td className="num">{fmtSeg(p.dwell_med)}</td>
                          <td className="num">{fmtSeg(p.ready_p50)}</td>
                          <td className="num">{fmtSeg(p.ready_p95)}</td>
                          <td className="num">{fmtSeg(p.espera_med)}</td>
                          <td className="num">{fmtNum(p.roundtrips_med)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Seccion>
            </div>
          </div>

          <Seccion titulo="Rutas más frecuentes" sub="De una transacción a la siguiente. Una ruta muy repetida es un candidato a automatizar.">
            <div className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {rutas.map((r) => (
                <div key={r.de + r.a} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5">
                  <span className="font-mono text-xs text-ink">{r.de} <span className="text-muted">→</span> {r.a}</span>
                  <span className="tabular text-secondary">{fmtNum(r.veces)}×</span>
                </div>
              ))}
              {rutas.length === 0 && <p className="text-muted">Sin rutas todavía.</p>}
            </div>
          </Seccion>

          <Seccion titulo="Pantallas exactas" sub="Transacción + programa + dynpro (+ subpantalla). Es la identidad con la que el asistente aprende a navegar.">
            <details>
              <summary className="cursor-pointer text-sm text-accent">Ver las {superficies.length} pantallas</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="tabla">
                  <thead><tr><th>Pantalla</th><th className="num">Visitas</th><th className="num">Estadía</th><th className="num">Lista en</th><th className="num">Espera</th></tr></thead>
                  <tbody>
                    {superficies.map((s) => (
                      <tr key={s.surface}>
                        <td className="font-mono text-xs text-secondary">{s.surface}</td>
                        <td className="num">{fmtNum(s.visitas)}</td>
                        <td className="num">{fmtSeg(s.dwell_med)}</td>
                        <td className="num">{fmtSeg(s.ready_p50)}</td>
                        <td className="num">{fmtSeg(s.espera_med)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Seccion>
        </>
      )}
    </div>
  );
}
