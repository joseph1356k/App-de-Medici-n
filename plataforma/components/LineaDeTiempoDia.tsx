// LA LÍNEA DE TIEMPO DE UN DÍA, como componente de servidor sin JavaScript. Un SVG con
// SOLO rectángulos, líneas y un patrón (viewBox de 1000 × H, `preserveAspectRatio="none"`:
// se estira a lo ancho sin deformar nada que importe) y una capa HTML absoluta para todo lo
// que lleva texto (horas, P#, transacción, glifos de eventos) colocada en % del ancho. Así
// es responsive, se imprime, y los tooltips son los nativos (<title> y title=).
//
// Dos modos: `completo` (Estado · App · SAP · Pacientes · Eventos, con nombres de carril,
// zoom y leyenda) para /consultorios/[id], y `mini` (Estado + App, 48 px, sin enlaces
// propios: la tarjeta que lo contiene ES el enlace) para las tarjetas de Inicio.
//
// El TAMAÑO viaja en la URL (`?detalle=`): el mismo dibujo se puede pedir ajustado al ancho
// del contenedor, al doble (con su propia barra de desplazamiento) o al cuádruple con las
// etiquetas de los eventos escritas. Ancho y alto crecen juntos, y la capa HTML sigue
// colocándose en % del mismo lienzo, así que nunca se desalinea.
import type { LineaDeTiempoDia as Datos, VisitaSap } from "@/lib/consultas";
import type { Estado, Marca } from "@/lib/segmentos";
import {
  ANCHO, DETALLES, DETALLE_POR_DEFECTO, ETIQUETA_DETALLE, MEDIDAS, agruparMarcas, carriles, desplazarVentana,
  escalaX, espaciarGrupos, horaDeTick, horaLocal, limitesDelDia, topApps, tramosApp, tramosEstado, tramosPacientes,
  tramosSap, ventanaAuto,
  type Carril, type Detalle, type Escala, type GrupoDibujado, type Tramo, type TramoSap, type Ventana,
} from "@/lib/linea-tiempo";
import { COLOR_ESTADO, ETIQUETA_ESTADO, ETIQUETA_EVENTO, colorApp, etiquetaApp, fmtHora, fmtMin, fmtNum, fmtSeg, glifoEvento } from "@/lib/formato";

export type Zoom = { desde: string | null; hasta: string | null };
export type Enlace = (desde: string | null, hasta: string | null, detalle?: Detalle) => string;
type Props = { datos: Datos; modo?: "completo" | "mini"; ventana?: Ventana; ahora?: string; zoom?: Zoom; detalle?: Detalle };

const NOMBRE_CARRIL: Record<string, string> = { estado: "Estado", app: "App", sap: "SAP", pacientes: "Pacientes", eventos: "Eventos" };

// Los eventos que ya tienen su carril (pacientes) o no dicen nada en un dibujo.
const SIN_GLIFO = new Set(["encounter_enter", "encounter_exit", "calidad", "sap_user_seen"]);
const MIN_PILL_P = 25, MIN_PILL_TCODE = 40; // unidades del viewBox a ancho 1×

const rango = (t: Tramo) => `${horaLocal(t.t0)}–${horaLocal(t.t1)}`;
function textoMezcla(t: Tramo, etiqueta: (k: string) => string): string {
  if (!t.mezcla) return "";
  const total = Object.values(t.mezcla).reduce((s, v) => s + v, 0) || 1;
  const partes = Object.entries(t.mezcla).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${etiqueta(k)} ${Math.round((v / total) * 100)} %`);
  return ` · mezcla: ${partes.join(", ")}`;
}
const tituloEstado = (t: Tramo<Estado>) => `${ETIQUETA_ESTADO[t.clave]} · ${rango(t)} · ${fmtMin(t.ms)}${textoMezcla(t, (k) => ETIQUETA_ESTADO[k as Estado] ?? k)}`;
const tituloApp = (t: Tramo, activo: boolean) => `${etiquetaApp(t.clave)} ${activo ? "activo" : "sin input"} · ${rango(t)} · ${fmtMin(t.ms)}${textoMezcla(t, etiquetaApp)}`;
function tituloVisita(v: VisitaSap): string {
  const partes = [v.tcode || "(sin transacción)", fmtHora(v.entered_at), `estadía ${fmtSeg(v.dwell_ms)}`, `lista en ${fmtSeg(v.ready_ms)}`, `espera ${fmtSeg(v.sap_wait_ms)}`, `${fmtNum(v.roundtrips)} round-trips`];
  return partes.join(" · ") + (v.exit_to ? ` → ${v.exit_to}` : v.left_at ? " → salió de SAP" : " · abierta");
}
function tituloGrupo(g: { marcas: Marca[] }): string {
  return g.marcas.map((m: Marca) => {
    const det = Object.entries(m.detail ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");
    return `${fmtHora(m.t)} ${ETIQUETA_EVENTO[m.kind] ?? m.kind}${det ? ` (${det})` : ""}`;
  }).join("\n");
}
const colorPaciente = (n: number) => (n % 2 === 1 ? "var(--color-pac-a)" : "var(--color-pac-b)");

export function LineaDeTiempoDia({ datos, modo = "completo", ventana, ahora, zoom, detalle }: Props) {
  const completo = modo === "completo";
  // El detalle es cosa del modo completo: la tira de las tarjetas de Inicio mide 48 px y
  // punto (su tamaño lo manda la tarjeta, no la URL).
  const det: Detalle = completo ? (detalle ?? DETALLE_POR_DEFECTO) : "ajustado";
  const med = MEDIDAS[det];
  const v = ventana ?? ventanaAuto(datos, ahora);
  const esc: Escala = escalaX(v);
  const ahoraMs = ahora ? Date.parse(ahora) : Date.now();
  const dia = limitesDelDia(datos.fecha);
  const esHoy = ahoraMs >= dia.desde && ahoraMs < dia.hasta;
  const pid = `sin-datos-${datos.consultorio.id.slice(0, 8)}-${modo}`;

  const visibles = topApps(datos.segmentos, 7);
  const estado = tramosEstado(datos.segmentos, esc);
  const appActiva = tramosApp(datos.segmentos, esc, visibles, ["activo"]);
  const appInactiva = tramosApp(datos.segmentos, esc, visibles, ["inactivo"]);
  const conPacientes = completo ? tramosPacientes(datos.segmentos, datos.pacientes, esc) : null;
  // Un carril vacío no es información: si el día no tuvo pacientes (o SAP no dejó ver
  // ninguna pantalla) el carril no se dibuja y su nombre no ocupa el gutter.
  const pac = conPacientes && conPacientes.tramos.length > 0 ? conPacientes : null;
  const sap: TramoSap[] = completo ? tramosSap(datos.visitas, esc, Math.min(ahoraMs, dia.hasta)) : [];
  const grupos: GrupoDibujado[] = completo
    ? espaciarGrupos(agruparMarcas(datos.marcas.filter((m) => !SIN_GLIFO.has(m.kind)), esc), med.minGlifo)
    : [];
  const { c, alto, ids } = carriles(modo, det, { sap: sap.length > 0, pacientes: !!pac });
  const porHuella = new Map(datos.pacientes.map((p) => [p.encounter_key, p]));
  const xAhora = esHoy && ahoraMs >= v.desde && ahoraMs <= v.hasta ? esc.x(ahoraMs) : null;
  const hayHueco = estado.some((t) => t.clave === "sin_datos");
  const ticks = !completo && esc.ticks.length > 8 ? esc.ticks.filter((_, i) => i % 2 === 0) : esc.ticks;
  const minPillP = MIN_PILL_P / med.ancho, minPillTcode = MIN_PILL_TCODE / med.ancho;

  /** Todos los enlaces de esta línea de tiempo salen de aquí: la fecha y lo que no cambia
   * (el zoom cuando se cambia el detalle, el detalle cuando se cambia el zoom) se conservan. */
  const enlace: Enlace = (desde, hasta, d = det) => {
    const q = new URLSearchParams({ fecha: datos.fecha });
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    if (d !== DETALLE_POR_DEFECTO) q.set("detalle", d);
    return `/consultorios/${datos.consultorio.id}?${q.toString()}`;
  };

  const tituloPaciente = (t: Tramo) => {
    const p = porHuella.get(t.clave), n = pac?.indice[t.clave];
    const base = `P${n ?? "?"} · ${rango(t)} · ${fmtMin(t.ms)}`;
    return p ? `${base} · consulta ${fmtMin(p.consulta_ms)} · activo ${fmtMin(p.activo_ms)} · ${p.visitas} visitas SAP · ${p.tramos} tramo${p.tramos === 1 ? "" : "s"}${textoMezcla(t, (k) => `P${pac?.indice[k] ?? "?"}`)}` : base;
  };

  const rect = (t: Tramo, carril: Carril, fill: string, titulo: string, extra: Record<string, unknown> = {}) => (
    <rect key={`${t.t0}-${t.clave}`} x={t.x0} y={carril.y} width={Math.max(0, t.x1 - t.x0)} height={carril.alto} fill={fill} {...extra}>
      <title>{titulo}</title>
    </rect>
  );
  const claseHora = (x: number) => `linea-dia__hora${x < 15 ? " linea-dia__hora--inicio" : x > ANCHO - 15 ? " linea-dia__hora--fin" : ""}`;

  return (
    <div className={`linea-dia linea-dia--${modo} linea-dia--${det}`}>
      {completo && <Controles datos={datos} zoom={zoom} v={v} esHoy={esHoy} ahoraMs={ahoraMs} detalle={det} enlace={enlace} />}
      {/* el lienzo es el marco de referencia del gutter: los nombres se alinean con los carriles, no con los chips */}
      <div className="linea-dia__lienzo">
      {completo && (
        <div className="linea-dia__gutter" aria-hidden>
          {ids.map((id) => (
            <span key={id} style={{ top: c[id].y, height: c[id].alto, lineHeight: `${c[id].alto}px` }}>{NOMBRE_CARRIL[id]}</span>
          ))}
        </div>
      )}
      <div className="linea-dia__marco">
        {/* el ancho intrínseco: 1×, 2× o 4× el del contenedor. La capa HTML se coloca en % de
            esta misma caja, así que sigue cuadrando con el SVG a cualquier tamaño. */}
        <div className="linea-dia__cuerpo" style={{ height: alto, minWidth: completo ? `max(640px, ${med.ancho * 100}%)` : undefined }}>
          <svg className="linea-dia__svg" viewBox={`0 0 ${ANCHO} ${alto}`} preserveAspectRatio="none" height={alto} role="img"
            aria-label={`Línea de tiempo de ${datos.consultorio.nombre}, ${horaLocal(v.desde)} a ${horaLocal(v.hasta)}`}>
            <defs>
              <pattern id={pid} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={6} height={6} fill="var(--color-estado-sin-datos)" />
                <line x1={0} y1={0} x2={0} y2={6} stroke="var(--color-surface)" strokeWidth={2} />
              </pattern>
            </defs>
            {ids.map((id) => (
              <rect key={id} x={0} y={c[id].y} width={ANCHO} height={c[id].alto} fill="var(--color-plane)" />
            ))}
            {esc.ticks.map((t) => (
              <line key={t.t} x1={t.x} x2={t.x} y1={c.eje.alto - 4} y2={alto} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
            ))}
            {estado.map((t) => rect(t, c.estado, t.clave === "sin_datos" ? `url(#${pid})` : COLOR_ESTADO[t.clave], tituloEstado(t)))}
            {appInactiva.map((t) => rect(t, c.app, colorApp(t.clave), tituloApp(t, false), { opacity: 0.4 }))}
            {appActiva.map((t) => rect(t, c.app, colorApp(t.clave), tituloApp(t, true)))}
            {c.sap && sap.map((t) => (
              <g key={t.visita.visit_uid}>
                <rect x={t.x0} y={c.sap.y} width={t.x1 - t.x0} height={c.sap.alto} fill="var(--color-accent-soft)" />
                {t.esperaFrac > 0 && (
                  <rect x={t.x0} y={c.sap.y + c.sap.alto * (1 - t.esperaFrac)} width={t.x1 - t.x0} height={c.sap.alto * t.esperaFrac} fill="var(--color-accent)" opacity={0.55} />
                )}
                <line x1={t.x0} x2={t.x0} y1={c.sap.y} y2={c.sap.y + c.sap.alto} stroke="var(--color-surface)" vectorEffect="non-scaling-stroke" />
                <title>{tituloVisita(t.visita)}</title>
              </g>
            ))}
            {c.pacientes && pac && pac.tramos.map((t) => (
              <g key={`${t.t0}-${t.clave}`}>
                <rect x={t.x0} y={c.pacientes.y} width={t.x1 - t.x0} height={c.pacientes.alto} fill={colorPaciente(pac.indice[t.clave] ?? 0)} />
                <line x1={t.x0} x2={t.x0} y1={c.pacientes.y} y2={c.pacientes.y + c.pacientes.alto} stroke="var(--color-surface)" vectorEffect="non-scaling-stroke" />
                <title>{tituloPaciente(t)}</title>
              </g>
            ))}
            {/* Cada grupo deja SIEMPRE su marca en el carril y su tooltip (el rectángulo
                invisible es lo que se puede apuntar con el ratón); la guía punteada hasta
                arriba solo la traza el que además escribe su glifo. */}
            {c.eventos && grupos.map((g) => {
              const hit = Math.max(2, Math.min(g.hueco, 12 / med.ancho));
              return (
                <g key={g.t}>
                  {g.glifo && <line x1={g.x} x2={g.x} y1={c.eje.alto} y2={c.eventos.y} stroke="var(--color-secondary)" strokeOpacity={0.3} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
                  <rect x={Math.max(0, g.x - hit / 2)} y={c.eventos.y} width={hit} height={c.eventos.alto} fill="transparent" />
                  <line x1={g.x} x2={g.x} y1={c.eventos.y} y2={c.eventos.y + c.eventos.alto} stroke="var(--color-secondary)" strokeOpacity={0.75} vectorEffect="non-scaling-stroke" />
                  <title>{tituloGrupo(g)}</title>
                </g>
              );
            })}
            {xAhora != null && (
              <line x1={xAhora} x2={xAhora} y1={completo ? 6 : 0} y2={alto} stroke="var(--color-ahora)" strokeWidth={1.5} vectorEffect="non-scaling-stroke">
                {/* un solo string: React 19 descarta un <title> cuyos hijos son una lista */}
                <title>{`ahora · ${fmtHora(new Date(ahoraMs))}`}</title>
              </line>
            )}
          </svg>

          <div className="linea-dia__capa">
            {ticks.map((t) => {
              const estilo = { left: `${t.x / 10}%`, top: completo ? 3 : 1 };
              if (!completo) return <span key={t.t} className={claseHora(t.x)} style={estilo}>{t.etiqueta}</span>;
              const h = horaDeTick(t.t);
              return (
                <a key={t.t} href={enlace(h.desde, h.hasta)} className={`${claseHora(t.x)} linea-dia__hora--enlace`} style={estilo}
                  title={`Ampliar ${h.desde}–${h.hasta}`}>{t.etiqueta}</a>
              );
            })}
            {c.pacientes && pac && pac.tramos.filter((t) => t.x1 - t.x0 >= minPillP).map((t) => (
              <span key={`${t.t0}-${t.clave}`} className="linea-dia__pill" style={{ left: `${t.x0 / 10}%`, width: `${(t.x1 - t.x0) / 10}%`, top: c.pacientes.y, lineHeight: `${c.pacientes.alto}px` }}>P{pac.indice[t.clave] ?? "?"}</span>
            ))}
            {c.sap && sap.filter((t) => t.x1 - t.x0 >= minPillTcode && t.clave).map((t) => (
              <span key={t.visita.visit_uid} className="linea-dia__pill linea-dia__pill--tinta" style={{ left: `${t.x0 / 10}%`, width: `${(t.x1 - t.x0) / 10}%`, top: c.sap.y, lineHeight: `${c.sap.alto}px` }}>{t.clave}</span>
            ))}
            {c.eventos && grupos.filter((g) => g.glifo).map((g) => (
              <span key={g.t} className={`linea-dia__glifo${med.etiquetas ? " linea-dia__glifo--ancho" : ""}`}
                style={{ left: `${g.x / 10}%`, top: c.eventos.y + 1, maxWidth: med.etiquetas ? `${g.ancho / 10}%` : undefined }}
                title={tituloGrupo(g)}>
                <b>{glifoEvento(g.marcas[0].kind, g.marcas[0].detail)}</b>
                {med.etiquetas && g.marcas.length > 1 && <sup>×{g.marcas.length}</sup>}
                {med.etiquetas && <i>{ETIQUETA_EVENTO[g.marcas[0].kind] ?? g.marcas[0].kind}</i>}
              </span>
            ))}
            {completo && xAhora != null && <span className="linea-dia__ahora" style={{ left: `${xAhora / 10}%`, top: 0 }}>ahora</span>}
          </div>
        </div>
      </div>
      </div>

      {completo && <Leyenda visibles={visibles} hayHueco={hayHueco} grupos={grupos} pacientes={!!pac} visitas={sap.length > 0} />}
    </div>
  );
}

/** Los mandos: tamaño del dibujo, ventanas fijas y navegación por horas. Enlaces normales
 * (cambian la URL, sin JavaScript). */
function Controles({ datos, zoom, v, esHoy, ahoraMs, detalle, enlace }: {
  datos: Datos; zoom?: Zoom; v: Ventana; esHoy: boolean; ahoraMs: number; detalle: Detalle; enlace: Enlace;
}) {
  const aRedondo = (t: number, min: number) => Math.floor(t / (min * 60_000)) * (min * 60_000);
  const chips: { texto: string; desde: string | null; hasta: string | null }[] = [
    { texto: "Todo el día", desde: null, hasta: null },
    { texto: "Mañana 06–12", desde: "06:00", hasta: "12:00" },
    { texto: "Tarde 12–18", desde: "12:00", hasta: "18:00" },
  ];
  if (esHoy) chips.push({ texto: "Última hora", desde: horaLocal(aRedondo(ahoraMs - 3_600_000, 10)), hasta: horaLocal(aRedondo(ahoraMs, 10) + 600_000) });
  const activo = (ch: (typeof chips)[number]) => (zoom?.desde ?? null) === ch.desde && (zoom?.hasta ?? null) === ch.hasta;
  const hayZoom = !!(zoom?.desde || zoom?.hasta);
  const atras = desplazarVentana(v, datos.fecha, -1), delante = desplazarVentana(v, datos.fecha, 1);
  const clase = (on: boolean) => `rounded-lg px-2 py-1 ${on ? "bg-ink text-white" : "text-secondary hover:bg-plane"}`;

  return (
    <div className="linea-dia__zoom mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="flex flex-wrap items-center gap-1">
        {chips.map((ch) => (
          <a key={ch.texto} href={enlace(ch.desde, ch.hasta)} className={clase(activo(ch))} aria-current={activo(ch) ? "true" : undefined}>
            {ch.texto}
          </a>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1" title="Cuánto se abre el dibujo: ajustado al ancho, al doble o al cuádruple (con barra de desplazamiento)">
        <span className="text-muted">Tamaño</span>
        {DETALLES.map((d) => (
          <a key={d} href={enlace(zoom?.desde ?? null, zoom?.hasta ?? null, d)} className={clase(d === detalle)} aria-current={d === detalle ? "true" : undefined}>
            {ETIQUETA_DETALLE[d]}
          </a>
        ))}
      </span>
      {hayZoom && (
        <span className="flex flex-wrap items-center gap-1">
          {atras && <a href={enlace(horaLocal(atras.desde), horaLocal(atras.hasta))} className={clase(false)}>◀ hora anterior</a>}
          {delante && <a href={enlace(horaLocal(delante.desde), horaLocal(delante.hasta))} className={clase(false)}>hora siguiente ▶</a>}
          <a href={enlace(null, null)} className={clase(false)}>todo el día</a>
        </span>
      )}
      <span className="ml-auto tabular text-muted">{horaLocal(v.desde)} – {horaLocal(v.hasta)} · clic en una hora del eje para ampliarla</span>
    </div>
  );
}

function Leyenda({ visibles, hayHueco, grupos, pacientes, visitas }: { visibles: string[]; hayHueco: boolean; grupos: { marcas: Marca[] }[]; pacientes: boolean; visitas: boolean }) {
  const kinds = [...new Set(grupos.flatMap((g) => g.marcas.map((m) => m.kind)))];
  const Muestra = ({ color, rayado }: { color?: string; rayado?: boolean }) => <span className={`linea-dia__muestra ${rayado ? "rayado" : ""}`} style={{ background: color }} aria-hidden />;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
      {(["activo", "inactivo", "bloqueado"] as Estado[]).map((e) => <span key={e}><Muestra color={COLOR_ESTADO[e]} />{ETIQUETA_ESTADO[e]}</span>)}
      {hayHueco && <span><Muestra rayado />Sin datos (PC apagado, suspendido o medidor caído)</span>}
      <span className="text-muted">·</span>
      {visibles.map((a) => <span key={a}><Muestra color={colorApp(a)} />{etiquetaApp(a)}</span>)}
      <span title="Apps que no salen en la lista de arriba porque ocuparon poco tiempo. Cada una viaja con su nombre; se ven todas en Datos → Por app."><Muestra color="var(--color-otro)" />el resto de apps</span>
      {visitas && <><span className="text-muted">·</span><span><Muestra color="var(--color-accent-soft)" />pantalla SAP</span><span><Muestra color="var(--color-accent)" />espera al servidor</span></>}
      {pacientes && <><span className="text-muted">·</span><span><Muestra color="var(--color-pac-a)" /><Muestra color="var(--color-pac-b)" />pacientes P1, P2… (huellas, no nombres)</span></>}
      {kinds.length > 0 && (
        <>
          <span className="text-muted">·</span>
          {kinds.slice(0, 10).map((k) => <span key={k}><span className="mr-1 font-mono">{glifoEvento(k)}</span>{ETIQUETA_EVENTO[k] ?? k}</span>)}
        </>
      )}
    </div>
  );
}
