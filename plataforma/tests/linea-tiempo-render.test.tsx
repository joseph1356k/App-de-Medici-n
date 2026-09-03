// El componente de servidor renderizado a HTML estático, sin Next: que no salga ningún
// NaN ni undefined al SVG, que estén los carriles, que el hueco vaya rayado y que el modo
// mini no lleve carril SAP ni enlaces (la tarjeta que lo contiene es el enlace).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LineaDeTiempoDia } from "../components/LineaDeTiempoDia";
import { A, B, diaCargado, diaSintetico, hora, marca, visita } from "./fixtures/dia-sintetico";

const dia = () => diaSintetico([
  { desde: "08:00", hasta: "09:00", encounter: A, sap_user: "MED01" },
  { desde: "09:00", hasta: "09:30", encounter: B, sap_user: "MED01" },
  { desde: "09:30", hasta: "10:00", app: "chrome", surface: null, activo: false },
  { desde: "10:30", hasta: "11:00", bloqueado: true },
], {
  // 40 min = 83 unidades en 8 h: por encima del umbral de 40 para escribir la transacción encima
  visitas: [visita("NV2000", "08:05", 2400, { encounter_key: A }), visita("NWP1", "08:50", 30)],
  marcas: [marca("medidor_start", "07:59", { reason: "arranque", version: "2.0.0" }), marca("lock", "10:30"), marca("unlock", "11:00"), marca("encounter_enter", "08:00")],
});
const iso = (t: number) => new Date(t).toISOString();

describe("LineaDeTiempoDia", () => {
  it("completo: cinco carriles, rayado sobre el hueco, P# y transacción, glifos, sin NaN", () => {
    const html = renderToStaticMarkup(<LineaDeTiempoDia datos={dia()} modo="completo" ahora={iso(hora("12:00"))} zoom={{ desde: null, hasta: null }} />);
    expect(html).not.toMatch(/NaN|undefined/);
    for (const carril of ["Estado", "App", "SAP", "Pacientes", "Eventos"]) expect(html).toContain(`>${carril}<`);
    expect(html).toMatch(/fill="url\(#sin-datos-/);
    expect(html).toContain(">P1<");
    expect(html).toContain(">P2<");
    expect(html).toContain(">NV2000<");
    expect(html).toContain("linea-dia__glifo");
    expect(html).toContain("▮"); // lock
    expect(html).toContain('stroke="var(--color-ahora)"'); // hoy: la marca «ahora»
    expect(html).toContain("Todo el día");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("var(--color-estado-bloqueado)");
  });

  it("mini: solo Estado y App, 48 px, sin enlaces ni carril SAP ni marca de ayer", () => {
    const html = renderToStaticMarkup(<LineaDeTiempoDia datos={dia()} modo="mini" ahora={iso(hora("12:00") + 3 * 24 * 3_600_000)} />);
    expect(html).not.toMatch(/NaN|undefined/);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain(">SAP<");
    expect(html).not.toContain(">P1<");
    expect(html).toContain('viewBox="0 0 1000 48"');
    expect(html).not.toContain('stroke="var(--color-ahora)"');
  });

  it("un día vacío se dibuja igual (eje y carriles) sin romperse", () => {
    const html = renderToStaticMarkup(<LineaDeTiempoDia datos={diaSintetico([])} modo="completo" ahora={iso(hora("12:00"))} />);
    expect(html).not.toMatch(/NaN|undefined/);
    expect(html).toContain("07:00");
    expect(html).toContain(">Estado<");
  });
  it("«detalle» abre el dibujo: mismo día, más alto y más ancho, y con etiquetas en amplio", () => {
    const ajustado = renderToStaticMarkup(<LineaDeTiempoDia datos={dia()} detalle="ajustado" ahora={iso(hora("12:00"))} />);
    const comodo = renderToStaticMarkup(<LineaDeTiempoDia datos={dia()} ahora={iso(hora("12:00"))} />);
    const amplio = renderToStaticMarkup(<LineaDeTiempoDia datos={dia()} detalle="amplio" ahora={iso(hora("12:00"))} />);
    for (const html of [ajustado, comodo, amplio]) expect(html).not.toMatch(/NaN|undefined/);
    expect(ajustado).toContain('viewBox="0 0 1000 139"');
    expect(comodo).toContain('viewBox="0 0 1000 183"');   // el defecto, sin pasar detalle
    expect(amplio).toContain('viewBox="0 0 1000 244"');
    // el ancho intrínseco: 1×, 2× y 4× el del contenedor (con su propia barra)
    expect(ajustado).toContain("max(640px, 100%)");
    expect(comodo).toContain("max(640px, 200%)");
    expect(amplio).toContain("max(640px, 400%)");
    // las etiquetas de los eventos SOLO en amplio
    expect(amplio).toContain("linea-dia__glifo--ancho");
    expect(amplio).toContain("PC bloqueado");
    expect(comodo).not.toContain("linea-dia__glifo--ancho");
    // los tres chips de tamaño, con el activo marcado
    for (const html of [ajustado, comodo, amplio]) for (const t of ["Ajustado", "Cómodo", "Amplio"]) expect(html).toContain(t);
  });

  it("las horas del eje son enlaces que amplían esa hora, y hay navegación cuando hay zoom", () => {
    const sinZoom = renderToStaticMarkup(<LineaDeTiempoDia datos={dia()} ahora={iso(hora("12:00"))} zoom={{ desde: null, hasta: null }} />);
    expect(sinZoom).toContain("desde=09%3A00&amp;hasta=10%3A00");
    expect(sinZoom).not.toContain("hora anterior");
    const conZoom = renderToStaticMarkup(
      <LineaDeTiempoDia datos={dia()} ahora={iso(hora("12:00"))} zoom={{ desde: "09:00", hasta: "10:00" }}
        ventana={{ desde: hora("09:00"), hasta: hora("10:00") }} detalle="amplio" />);
    expect(conZoom).toContain("◀ hora anterior");
    expect(conZoom).toContain("hora siguiente ▶");
    expect(conZoom).toContain("todo el día");
    // el detalle se conserva al moverse de hora, y el zoom al cambiar de tamaño
    expect(conZoom).toContain("desde=08%3A00&amp;hasta=09%3A00&amp;detalle=amplio");
    expect(conZoom).toContain("desde=09%3A00&amp;hasta=10%3A00&amp;detalle=ajustado");
  });

  it("un día sin pacientes ni SAP no dibuja esos carriles, y 40 eventos no se pisan", () => {
    const ajustado = renderToStaticMarkup(<LineaDeTiempoDia datos={diaCargado(40)} detalle="ajustado" ahora={iso(hora("12:00"))} />);
    expect(ajustado).not.toMatch(/NaN|undefined/);
    expect(ajustado).not.toContain(">Pacientes<");
    expect(ajustado).not.toContain(">SAP<");
    expect(ajustado).toContain(">Eventos<");
    // apretados: cada grupo deja su marca y su tooltip, pero ninguno escribe encima de otro
    expect(ajustado).not.toContain("linea-dia__glifo");
    expect(ajustado).toContain("PC bloqueado"); // el <title> del grupo sigue ahí
    // con el lienzo a 4× sí caben, con su cuenta y su etiqueta
    const amplio = renderToStaticMarkup(<LineaDeTiempoDia datos={diaCargado(40)} detalle="amplio" ahora={iso(hora("12:00"))} />);
    expect(amplio).toContain("linea-dia__glifo--ancho");
    expect(amplio).toContain("×4");
  });
});
