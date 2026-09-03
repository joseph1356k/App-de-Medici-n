// LA LÍNEA DE TIEMPO DE UN DÍA, como componente de servidor sin JavaScript. Un SVG con
// SOLO rectángulos, líneas y un patrón (viewBox de 1000 × H, `preserveAspectRatio="none"`:
// se estira a lo ancho sin deformar nada que importe) y una capa HTML absoluta para todo lo
// que lleva texto (horas, P#, transacción, glifos de eventos) colocada en % del ancho. Así
// es responsive, se imprime, y los tooltips son los nativos (<title> y title=).
//
// Dos modos: `completo` (Estado · App · SAP · Pacientes · Eventos, con nombres de carril,
// zoom y leyenda) para /consultorios/[id], y `mini` (Estado + App, 48 px, sin enlaces
// propios: la tarjeta que lo contiene ES el enlace) para las tarjetas de Inicio.
import type { LineaDeTiempoDia as Datos, VisitaSap } from "@/lib/consultas";
import type { Estado, Marca } from "@/lib/segmentos";
import {
  ANCHO, agruparMarcas, escalaX, horaLocal, limitesDelDia, topApps, tramosApp, tramosEstado, tramosPacientes, tramosSap, ventanaAuto,
  type Escala, type GrupoMarcas, type Tramo, type TramoSap, type Ventana,
} from "@/lib/linea-tiempo";
import { COLOR_ESTADO, ETIQUETA_ESTADO, ETIQUETA_EVENTO, colorApp, etiquetaApp, fmtHora, fmtMin, fmtNum, fmtSeg, glifoEvento } from "@/lib/formato";

export type Zoom = { desde: string | null; hasta: string | null };
type Props = { datos: Datos; modo?: "completo" | "mini"; ventana?: Ventana; ahora?: string; zoom?: Zoom };

type Carril = { y: number; alto: number };
const NOMBRE_CARRIL: Record<string, string> = { estado: "Estado", app: "App", sap: "SAP", pacientes: "Pacientes", eventos: "Eventos" };

/** Los carriles en píxeles de alto (el eje Y del viewBox son píxeles: solo se estira X). */
function carriles(modo: "completo" | "mini"): { c: Record<string, Carril>; alto: number } {
  const orden: [string, number][] = modo === "completo"
    ? [["eje", 18], ["estado", 22], ["app", 22], ["sap", 18], ["pacientes", 18], ["eventos", 16]]
    : [["eje", 12], ["estado", 18], ["app", 18]];
  const hueco = modo === "completo" ? 2 : 0;
  const c: Record<string, Carril> = {};
  let y = 0;
  orden.forEach(([id, alto], i) => { if (i > 1) y += hueco; c[id] = { y, alto }; y += alto; });
  return { c, alto: y };
}

// Los eventos que ya tienen su carril (pacientes) o no dicen nada en un dibujo.
const SIN_GLIFO = new Set(["encounter_enter", "encounter_exit", "calidad", "sap_user_seen"]);
const MIN_PILL_P = 25, MIN_PILL_TCODE = 40; // unidades del viewBox

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
function tituloGrupo(g: GrupoMarcas): string {
  return g.marcas.map((m: Marca) => {
    const det = Object.entries(m.detail ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");
    return `${fmtHora(m.t)} ${ETIQUETA_EVENTO[m.kind] ?? m.kind}${det ? ` (${det})` : ""}`;
  }).join("\n");
}
const colorPaciente = (n: number) => (n % 2 === 1 ? "var(--color-pac-a)" : "var(--color-pac-b)");

export function LineaDeTiempoDia({ datos, modo = "completo", ventana, ahora, zoom }: Props) {
  const completo = modo === "completo";
  const v = ventana ?? ventanaAuto(datos, ahora);
  const esc: Escala = escalaX(v);
  const ahoraMs = ahora ? Date.parse(ahora) : Date.now();
  const dia = limitesDelDia(datos.fecha);
  const esHoy = ahoraMs >= dia.desde && ahoraMs < dia.hasta;
  const { c, alto } = carriles(modo);
  const pid = `sin-datos-${datos.consultorio.id.slice(0, 8)}-${modo}`;

  const visibles = topApps(datos.segmentos, 7);
  const estado = tramosEstado(datos.segmentos, esc);
  const appActiva = tramosApp(datos.segmentos, esc, visibles, ["activo"]);
  const appInactiva = tramosApp(datos.segmentos, esc, visibles, ["inactivo"]);
  const pac = completo ? tramosPacientes(datos.segmentos, datos.pacientes, esc) : null;
  const sap: TramoSap[] = completo ? tramosSap(datos.visitas, esc, Math.min(ahoraMs, dia.hasta)) : [];
  const grupos = completo ? agruparMarcas(datos.marcas.filter((m) => !SIN_GLIFO.has(m.kind)), esc) : [];
  const porHuella = new Map(datos.pacientes.map((p) => [p.encounter_key, p]));
  const xAhora = esHoy && ahoraMs >= v.desde && ahoraMs <= v.hasta ? esc.x(ahoraMs) : null;
  const hayHueco = estado.some((t) => t.clave === "sin_datos");
  const ticks = !completo && esc.ticks.length > 8 ? esc.ticks.filter((_, i) => i % 2 === 0) : esc.ticks;

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
    <div className={`linea-dia linea-dia--${modo}`}>
      {completo && <Zooms datos={datos} zoom={zoom} v={v} esHoy={esHoy} ahoraMs={ahoraMs} />}
      {/* el lienzo es el marco de referencia del gutter: los nombres se alinean con los carriles, no con los chips */}
      <div className="linea-dia__lienzo">
      {completo && (
        <div className="linea-dia__gutter" aria-hidden>
          {Object.entries(c).filter(([id]) => id !== "eje").map(([id, k]) => (
            <span key={id} style={{ top: k.y, height: k.alto, lineHeight: `${k.alto}px` }}>{NOMBRE_CARRIL[id]}</span>
          ))}
        </div>
      )}
      <div className="linea-dia__marco">
        <div className="linea-dia__cuerpo" style={{ height: alto }}>
          <svg className="linea-dia__svg" viewBox={`0 0 ${ANCHO} ${alto}`} preserveAspectRatio="none" height={alto} role="img"
            aria-label={`Línea de tiempo de ${datos.consultorio.nombre}, ${horaLocal(v.desde)} a ${horaLocal(v.hasta)}`}>
            <defs>
              <pattern id={pid} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={6} height={6} fill="var(--color-estado-sin-datos)" />
                <line x1={0} y1={0} x2={0} y2={6} stroke="var(--color-surface)" strokeWidth={2} />
              </pattern>
            </defs>
            {Object.entries(c).filter(([id]) => id !== "eje").map(([id, k]) => (
              <rect key={id} x={0} y={k.y} width={ANCHO} height={k.alto} fill="var(--color-plane)" />
            ))}
            {esc.ticks.map((t) => (
              <line key={t.t} x1={t.x} x2={t.x} y1={c.eje.alto - 4} y2={alto} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
            ))}
            {estado.map((t) => rect(t, c.estado, t.clave === "sin_datos" ? `url(#${pid})` : COLOR_ESTADO[t.clave], tituloEstado(t)))}
            {appInactiva.map((t) => rect(t, c.app, colorApp(t.clave), tituloApp(t, false), { opacity: 0.4 }))}
            {appActiva.map((t) => rect(t, c.app, colorApp(t.clave), tituloApp(t, true)))}
            {completo && sap.map((t) => (
              <g key={t.visita.visit_uid}>
                <rect x={t.x0} y={c.sap.y} width={t.x1 - t.x0} height={c.sap.alto} fill="var(--color-accent-soft)" />
                {t.esperaFrac > 0 && (
                  <rect x={t.x0} y={c.sap.y + c.sap.alto * (1 - t.esperaFrac)} width={t.x1 - t.x0} height={c.sap.alto * t.esperaFrac} fill="var(--color-accent)" opacity={0.55} />
                )}
                <line x1={t.x0} x2={t.x0} y1={c.sap.y} y2={c.sap.y + c.sap.alto} stroke="var(--color-surface)" vectorEffect="non-scaling-stroke" />
                <title>{tituloVisita(t.visita)}</title>
              </g>
            ))}
            {completo && pac && pac.tramos.map((t) => (
              <g key={`${t.t0}-${t.clave}`}>
                <rect x={t.x0} y={c.pacientes.y} width={t.x1 - t.x0} height={c.pacientes.alto} fill={colorPaciente(pac.indice[t.clave] ?? 0)} />
                <line x1={t.x0} x2={t.x0} y1={c.pacientes.y} y2={c.pacientes.y + c.pacientes.alto} stroke="var(--color-surface)" vectorEffect="non-scaling-stroke" />
                <title>{tituloPaciente(t)}</title>
              </g>
            ))}
            {completo && grupos.map((g) => (
              <line key={g.t} x1={g.x} x2={g.x} y1={c.eje.alto} y2={alto} stroke="var(--color-secondary)" strokeOpacity={0.35} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            ))}
            {xAhora != null && (
              <line x1={xAhora} x2={xAhora} y1={completo ? 6 : 0} y2={alto} stroke="var(--color-ahora)" strokeWidth={1.5} vectorEffect="non-scaling-stroke">
                {/* un solo string: React 19 descarta un <title> cuyos hijos son una lista */}
                <title>{`ahora · ${fmtHora(new Date(ahoraMs))}`}</title>
              </line>
            )}
          </svg>

          <div className="linea-dia__capa">
            {ticks.map((t) => <span key={t.t} className={claseHora(t.x)} style={{ left: `${t.x / 10}%`, top: completo ? 3 : 1 }}>{t.etiqueta}</span>)}
            {completo && pac && pac.tramos.filter((t) => t.x1 - t.x0 >= MIN_PILL_P).map((t) => (
              <span key={`${t.t0}-${t.clave}`} className="linea-dia__pill" style={{ left: `${t.x0 / 10}%`, width: `${(t.x1 - t.x0) / 10}%`, top: c.pacientes.y, lineHeight: `${c.pacientes.alto}px` }}>P{pac.indice[t.clave] ?? "?"}</span>
            ))}
            {completo && sap.filter((t) => t.x1 - t.x0 >= MIN_PILL_TCODE && t.clave).map((t) => (
              <span key={t.visita.visit_uid} className="linea-dia__pill linea-dia__pill--tinta" style={{ left: `${t.x0 / 10}%`, width: `${(t.x1 - t.x0) / 10}%`, top: c.sap.y, lineHeight: `${c.sap.alto}px` }}>{t.clave}</span>
            ))}
            {completo && grupos.map((g) => (
              <span key={g.t} className="linea-dia__glifo" style={{ left: `${g.x / 10}%`, top: c.eventos.y + 2 }} title={tituloGrupo(g)}>
                {glifoEvento(g.marcas[0].kind, g.marcas[0].detail)}{g.marcas.length > 1 && <sup>×{g.marcas.length}</sup>}
              </span>
            ))}
            {completo && xAhora != null && <span className="linea-dia__ahora" style={{ left: `${xAhora / 10}%`, top: 0 }}>ahora</span>}
          </div>
        </div>
      </div>
      </div>

      {completo && <Leyenda visibles={visibles} hayHueco={hayHueco} grupos={grupos} pacientes={!!pac && pac.tramos.length > 0} visitas={sap.length > 0} />}
    </div>
  );
}

/** Los chips de zoom: enlaces normales (cambian la URL, sin JavaScript). */
function Zooms({ datos, zoom, v, esHoy, ahoraMs }: { datos: Datos; zoom?: Zoom; v: Ventana; esHoy: boolean; ahoraMs: number }) {
  const base = `/consultorios/${datos.consultorio.id}?fecha=${datos.fecha}`;
  const aRedondo = (t: number, min: number) => Math.floor(t / (min * 60_000)) * (min * 60_000);
  const chips: { texto: string; desde: string | null; hasta: string | null }[] = [
    { texto: "Todo el día", desde: null, hasta: null },
    { texto: "Mañana 06–12", desde: "06:00", hasta: "12:00" },
    { texto: "Tarde 12–18", desde: "12:00", hasta: "18:00" },
  ];
  if (esHoy) chips.push({ texto: "Última hora", desde: horaLocal(aRedondo(ahoraMs - 3_600_000, 10)), hasta: horaLocal(aRedondo(ahoraMs, 10) + 600_000) });
  const activo = (ch: (typeof chips)[number]) => (zoom?.desde ?? null) === ch.desde && (zoom?.hasta ?? null) === ch.hasta;
  return (
    <div className="linea-dia__zoom mb-2 flex flex-wrap items-center gap-1 text-xs">
      {chips.map((ch) => (
        <a key={ch.texto} href={ch.desde ? `${base}&desde=${ch.desde}&hasta=${ch.hasta}` : base}
          className={`rounded-lg px-2 py-1 ${activo(ch) ? "bg-ink text-white" : "text-secondary hover:bg-plane"}`} aria-current={activo(ch) ? "true" : undefined}>
          {ch.texto}
        </a>
      ))}
      <span className="ml-auto tabular text-muted">{horaLocal(v.desde)} – {horaLocal(v.hasta)}</span>
    </div>
  );
}

function Leyenda({ visibles, hayHueco, grupos, pacientes, visitas }: { visibles: string[]; hayHueco: boolean; grupos: GrupoMarcas[]; pacientes: boolean; visitas: boolean }) {
  const kinds = [...new Set(grupos.flatMap((g) => g.marcas.map((m) => m.kind)))];
  const Muestra = ({ color, rayado }: { color?: string; rayado?: boolean }) => <span className={`linea-dia__muestra ${rayado ? "rayado" : ""}`} style={{ background: color }} aria-hidden />;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
      {(["activo", "inactivo", "bloqueado"] as Estado[]).map((e) => <span key={e}><Muestra color={COLOR_ESTADO[e]} />{ETIQUETA_ESTADO[e]}</span>)}
      {hayHueco && <span><Muestra rayado />Sin datos (PC apagado, suspendido o medidor caído)</span>}
      <span className="text-muted">·</span>
      {visibles.filter((a) => a !== "otro").map((a) => <span key={a}><Muestra color={colorApp(a)} />{etiquetaApp(a)}</span>)}
      <span><Muestra color="var(--color-otro)" />Otras apps</span>
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
