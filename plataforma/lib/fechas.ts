// LAS FECHAS DEL HOSPITAL, en un archivo puro (sin base de datos) para que la ingesta, los
// filtros y las pruebas compartan la misma aritmética. Todo gira alrededor del DÍA OPERATIVO:
// el día del hospital corta a las 06:00 de Bogotá, no a medianoche, así una guardia nocturna
// que cruza las 00:00 pertenece al día en que empezó. Colombia no tiene horario de verano,
// así que el desfase es siempre -05:00 y se puede escribir a mano sin miedo.
export const TZ = "America/Bogota";
export const CORTE_HORAS = 6;
export const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** La fecha civil de Bogotá (YYYY-MM-DD) de un instante. */
export function fechaBogota(t: Date | string | number): string {
  return fmt.format(new Date(t));
}

export function hoyBogota(): string {
  return fechaBogota(new Date());
}

/** El día operativo de un instante: la fecha de Bogotá de (instante − 6 h). */
export function diaOperativoDe(t: Date | string | number): string {
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) throw new Error("instante inválido");
  return fechaBogota(new Date(d.getTime() - CORTE_HORAS * 3600_000));
}

export function hoyOperativo(): string {
  return diaOperativoDe(new Date());
}

/** 06:00 Bogotá del día operativo, en ISO UTC. */
export function inicioDiaOperativo(fecha: string): string {
  return new Date(`${fecha}T06:00:00-05:00`).toISOString();
}

/** 06:00 Bogotá del día siguiente, en ISO UTC (exclusivo). */
export function finDiaOperativo(fecha: string): string {
  return new Date(new Date(`${fecha}T06:00:00-05:00`).getTime() + 24 * 3600_000).toISOString();
}

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
