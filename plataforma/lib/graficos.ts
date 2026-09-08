// LA LÓGICA DE LOS GRÁFICOS, sin React y sin base de datos: escalas, apilados, cubetas y el
// paso de series a tabla. Aquí vive todo lo que se puede equivocar en silencio, para que vitest
// lo pruebe con números a mano en vez de que se descubra mirando un dibujo torcido.
//
// EL CONTRATO CON EL ENVOLTORIO INTERACTIVO. Los componentes de gráfico son de SERVIDOR y no
// llevan una línea de JavaScript; el globo y la cruceta los pone UN solo componente cliente
// (components/graficos/Interactivo.tsx) leyendo atributos `data-*` de las marcas:
//
//   data-x        índice de la posición en el eje X (solo en gráficos con eje X)
//   data-cx       el centro de esa posición, en unidades del viewBox (solo en la zona de golpe)
//   data-etiqueta el nombre largo de esa X («jue, 03 de sept», «08:00–08:59»)
//   data-serie    el nombre de la serie
//   data-valor    el valor YA FORMATEADO — el cliente no formatea nada, no sabe de unidades
//   data-color    el color de la marca, para el punto del globo
//   data-extra    una segunda línea opcional
//
// Todo lo que el globo puede enseñar viaja ya escrito en el HTML servido. Por eso el gráfico se
// imprime entero, funciona sin JavaScript y la tabla gemela dice exactamente lo mismo.

/** Los slots de serie, en orden fijo. El color sigue a la ENTIDAD, nunca a su posición en el
 * ranking: si se filtra un consultorio, los que quedan conservan su color. */
export const COLOR_SERIE = [
  "var(--color-s1)", "var(--color-s2)", "var(--color-s3)",
  "var(--color-s4)", "var(--color-s7)", "var(--color-s6)",
];

/** El color de un consultorio por su `orden`, no por su índice en la lista que se esté
 * dibujando. Un consultorio sin orden (999 = «Sin consultorio») va en gris. */
export function colorConsultorio(orden: number): string {
  if (!Number.isFinite(orden) || orden <= 0 || orden >= 999) return "var(--color-otro)";
  return COLOR_SERIE[(Math.round(orden) - 1) % COLOR_SERIE.length];
}

export type SerieXY = {
  id: string; nombre: string; color: string;
  /** Alineado con `xs`. `null` = no medido: se dibuja como hueco, jamás como cero. */
  valores: (number | null)[];
};

export type Fmt = (v: number) => string;

/** Un tope «redondo» por encima del máximo: 1-1,5-2-… × 10ⁿ. Un eje que acaba en 6,37 h no se lee. */
export function topeBonito(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= max) return m * exp;
  return 10 * exp;
}

/**
 * LAS ZONAS DE GOLPE de un eje X: bandas contiguas, una por posición, que se tocan en los puntos
 * medios. Contiguas es la palabra clave — el puntero nunca cae en un hueco, así que apuntar a
 * una fecha basta y no hay que acertarle a una línea de 2 px. Con un solo punto, la banda es
 * todo el ancho.
 */
export function bandas(n: number, izq: number, der: number): { x0: number; x1: number; cx: number }[] {
  if (n <= 0) return [];
  const x = (i: number) => (n === 1 ? (izq + der) / 2 : izq + (i / (n - 1)) * (der - izq));
  return Array.from({ length: n }, (_, i) => {
    const cx = x(i);
    return {
      x0: i === 0 ? izq : (x(i - 1) + cx) / 2,
      x1: i === n - 1 ? der : (cx + x(i + 1)) / 2,
      cx,
    };
  });
}

/** Apila valores en tramos [y0, y1) sobre una base acumulada. Los negativos cuentan como cero:
 * una barra apilada con una parte negativa no significa nada. */
export function apilar(valores: number[]): { y0: number; y1: number }[] {
  let acumulado = 0;
  return valores.map((v) => {
    const y0 = acumulado;
    acumulado += Math.max(0, v);
    return { y0, y1: acumulado };
  });
}

/**
 * Los `n` mayores, y el resto plegado en UNO. Nunca se resuelve «demasiadas series» generando
 * más colores: a partir del octavo slot dos colores son indistinguibles con daltonismo, así que
 * la cola se junta y se dice que es una cola.
 */
export function topN<T>(items: T[], n: number, valor: (t: T) => number, resto: (suma: number, cuantos: number) => T): T[] {
  if (items.length <= n) return [...items];
  const orden = [...items].sort((a, b) => valor(b) - valor(a));
  const cabeza = orden.slice(0, n);
  const cola = orden.slice(n);
  const suma = cola.reduce((s, t) => s + valor(t), 0);
  return suma > 0 ? [...cabeza, resto(suma, cola.length)] : cabeza;
}

/** Series → tabla, para la vista «ver tabla». Es la copia accesible del gráfico: mismos números,
 * mismo orden, sin ratón. `null` sale como «—», nunca como 0. */
export function seriesATabla(
  xs: string[], series: SerieXY[], fmt: Fmt, cabeceraX = "",
): { columnas: string[]; filas: string[][] } {
  return {
    columnas: [cabeceraX, ...series.map((s) => s.nombre)],
    filas: xs.map((x, i) => [x, ...series.map((s) => {
      const v = s.valores[i];
      return v == null ? "—" : fmt(v);
    })]),
  };
}

/** La mediana de una lista, ignorando lo no medido. Devuelve null si no queda nada. */
export function mediana(valores: (number | null | undefined)[]): number | null {
  const v = valores.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Agrupa puntos por día y devuelve la mediana de cada día del eje, alineada con `fechas`. */
export function medianaPorDia(
  puntos: { fecha: string; valor: number | null }[], fechas: string[],
): (number | null)[] {
  const porDia = new Map<string, (number | null)[]>();
  for (const p of puntos) {
    const lista = porDia.get(p.fecha);
    if (lista) lista.push(p.valor);
    else porDia.set(p.fecha, [p.valor]);
  }
  return fechas.map((f) => mediana(porDia.get(f) ?? []));
}

// ── La espera de SAP ─────────────────────────────────────────────────────────
// Los cortes NO son bonitos por casualidad: en el HGM la mediana de «pantalla lista» son 2,4 s y
// el p95 son 46 s, así que una escala lineal lo aplastaría todo contra la izquierda. Los tramos
// crecen como se percibe la espera: hasta 1 s no se nota, a los 5 s se mira el reloj, a los 30 s
// se abandona la tarea.
export const LIMITES_ESPERA = [1000, 2000, 5000, 10000, 30000, 60000] as const;
export const ETIQUETA_CUBETA = ["< 1 s", "1–2 s", "2–5 s", "5–10 s", "10–30 s", "30–60 s", "> 60 s"];

/** Índice del tramo al que pertenece una espera (0…6). */
export function cubetaDeEspera(ms: number): number {
  for (let i = 0; i < LIMITES_ESPERA.length; i++) if (ms < LIMITES_ESPERA[i]) return i;
  return LIMITES_ESPERA.length;
}

/**
 * Dónde cae un valor DENTRO de la fila de tramos, con decimales, para poder pintar el p50 y el
 * p95 en su sitio y no en el centro de su columna. Dentro del tramo se interpola en logaritmo,
 * que es como están construidos los cortes.
 */
export function posicionEnCubetas(ms: number): number {
  const i = cubetaDeEspera(ms);
  const bajo = i === 0 ? 0 : LIMITES_ESPERA[i - 1];
  const alto = i === LIMITES_ESPERA.length ? LIMITES_ESPERA[i - 1] * 4 : LIMITES_ESPERA[i];
  if (!(alto > bajo)) return i;
  const l = (x: number) => Math.log(Math.max(1, x));
  const frac = (l(ms) - l(bajo || 1)) / (l(alto) - l(bajo || 1));
  return i + Math.min(1, Math.max(0, frac));
}

/** Los siete tramos con su porcentaje. Con cero visitas devuelve siete ceros, no NaN. */
export function cubetasEspera(conteos: number[]): { etiqueta: string; n: number; pct: number }[] {
  const total = conteos.reduce((s, n) => s + (n || 0), 0);
  return ETIQUETA_CUBETA.map((etiqueta, i) => {
    const n = conteos[i] ?? 0;
    return { etiqueta, n, pct: total > 0 ? (n / total) * 100 : 0 };
  });
}

/**
 * El camino de un rectángulo con las dos esquinas de ARRIBA redondeadas: el extremo del dato se
 * redondea, la base se queda cuadrada sobre la línea de cero. Si la barra es más baja que el
 * radio, sale un rectángulo normal — una barra de 2 px con 4 px de radio se ve como una pastilla
 * y deja de leerse como un valor.
 */
export function rectRedondeadoArriba(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0 || w <= 0) return "";
  if (h < r || rr <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
}
