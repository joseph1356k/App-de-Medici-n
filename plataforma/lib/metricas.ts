// LAS MÉTRICAS DERIVADAS: divisiones y restas sobre lo que ya trae `jornada_summary`. Viven aquí
// y no en cada página para que la vista de un día, el tablero y la exportación digan exactamente
// lo mismo — dos sitios calculando «tiempo fuera de SAP» a mano acaban discrepando, y cuando
// discrepan nadie sabe cuál creer.
//
// Todas devuelven `null` cuando no se pueden calcular. Nunca un cero: en este panel un cero
// significa «medí y salió cero», y eso no es lo mismo que «no hay con qué dividir».

/** Lo que hace falta de una jornada para derivar el resto. Es un subconjunto a propósito: así
 * sirve igual para una fila de `jornada_summary` que para un total sumado a mano. */
export type Base = {
  foreground_ms: number; activo_ms: number; his_ms: number; miracle_ms: number;
  typing_ms: number; keystrokes: number; correcciones: number;
  sap_wait_ms: number; visitas: number; tramos_ms: number;
};

const n = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));
const div = (a: number, b: number) => (b > 0 ? a / b : null);

/** El tiempo con la ventana delante pero SIN que nadie toque nada: leer y esperar. Son 8-10 h por
 * jornada en el HGM y hasta ahora no aparecían en ninguna cifra. */
export const delanteSinTocar = (j: Partial<Base>) => Math.max(0, n(j.foreground_ms) - n(j.activo_ms));

/** El trabajo que ocurre FUERA del HIS y fuera de Miracle: hoy, sobre todo, el Bloc de notas. */
export const fueraDelHis = (j: Partial<Base>) => Math.max(0, n(j.activo_ms) - n(j.his_ms) - n(j.miracle_ms));

/** Teclas por minuto ESCRIBIENDO (dentro de las ráfagas, no sobre la jornada entera). */
export const ritmoDeTecleo = (j: Partial<Base>) => div(n(j.keystrokes), n(j.typing_ms) / 60000);

/** Qué proporción del tecleo fue borrar: fricción al escribir. */
export const corregido = (j: Partial<Base>) => {
  const p = div(n(j.correcciones), n(j.keystrokes));
  return p == null ? null : p * 100;
};

/** Lo que cuesta cada pantalla de SAP, en ms de espera al servidor. */
export const esperaPorPantalla = (j: Partial<Base>) => div(n(j.sap_wait_ms), n(j.visitas));

/** El ritmo de navegación por el HIS: pantallas por hora DE ACTIVIDAD (no de reloj, para que una
 * tarde vacía no lo diluya). */
export const pantallasPorHora = (j: Partial<Base>) => div(n(j.visitas), n(j.tramos_ms) / 3600000);

/** Qué porcentaje del tiempo activo se fue en SAP. */
export const cargaDeSap = (j: Partial<Base>) => {
  const p = div(n(j.his_ms), n(j.activo_ms));
  return p == null ? null : p * 100;
};
