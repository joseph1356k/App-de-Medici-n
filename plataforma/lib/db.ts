// La conexión a Postgres. Un solo cliente por proceso (Vercel reutiliza el módulo entre
// invocaciones calientes). `prepare: false` porque el pooler de Supabase en modo
// transacción no soporta sentencias preparadas.
//
// DATABASE_URL admite VARIAS URLs separadas por coma: se prueban TODAS A LA VEZ y se queda
// con la primera que conteste. Y si la URL apunta a un pooler de Supabase (aws-0-… o
// aws-1-…), se añade sola la hermana: Supabase asigna cada proyecto a uno de los dos y no
// se sabe cuál sin entrar al panel, así que pegando cualquiera funciona.
//
// EN PARALELO, no en fila, y eso NO es un detalle de estilo: en producción la URL apuntaba
// al pooler equivocado, y probarlas en orden le regalaba a CADA arranque en frío un intento
// fallido antes de conectar. Con tráfico bajo casi toda visita es un arranque en frío, así
// que ese peaje se pagaba casi siempre. (2026-09-02, leído en los logs de Vercel.)
//
// Sin DATABASE_URL, postgres.js lee PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD — así se
// corre en local contra un Postgres de desarrollo sin tocar el código.
import postgres from "postgres";
import { candidatos, sinClave } from "./urls";
import { conLimite } from "./reloj";

export { candidatos } from "./urls";

type Cliente = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __medidorSql: Cliente | undefined;
}

/**
 * LO QUE MÁS TARDA UNA CONSULTA ANTES DE DARSE POR MUERTA.
 *
 * postgres.js NO tiene límite: una consulta que no vuelve espera para siempre, y con ella
 * espera su conexión del pool. El 2026-09-02 el panel llevaba días «cargando muchísimo» y
 * a ratos 504, y los logs de Vercel decían «Task timed out after 300 seconds» 13 veces
 * sobre `/` y `/configuracion`. La causa, vista en pg_stat_activity: las CUATRO conexiones
 * del pool atascadas entre 163 y 253 segundos en `ClientRead` — el Lambda que las abrió se
 * congeló y Postgres seguía esperándolo. A partir de ahí toda consulta nueva hacía cola
 * detrás de conexiones muertas, y era un círculo vicioso: cada timeout dejaba otra.
 *
 * El límite es el DEFECTO y no una disciplina, a propósito: va en el cliente que todos
 * importan, así que una consulta nueva no puede olvidarse de ponerlo.
 */
const LIMITE_MS = Number(process.env.DB_LIMITE_MS ?? 20000);

function opciones(url: string | undefined) {
  const local = !url || /localhost|127\.0\.0\.1|host=\//.test(url) || !!process.env.PGHOST;
  return {
    prepare: false,
    // El resumen dispara 9 consultas a la vez (7 de la página + 2 de la cabecera). Con un
    // pool de 4 se apilaban de tres en tres sobre la misma conexión; ahora cada una tiene
    // la suya y no hay apilado.
    max: 10,
    // Cortos los dos, porque en serverless el proceso se CONGELA sin avisar: cuanto antes
    // se suelte y se recicle un socket, menos posibilidades de heredar uno muerto.
    idle_timeout: 8,
    max_lifetime: 60 * 5,
    connect_timeout: 8,
    ssl: local ? false : ("require" as const),
    transform: { undefined: null },
    // bigint y numeric llegan como número JS (no como texto): las sumas de milisegundos
    // caben de sobra en 2^53 y así la exportación y el panel no tienen que convertir.
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number | string) => `${x}`, parse: (x: string) => Number(x) },
      numeric: { to: 1700, from: [1700], serialize: (x: number | string) => `${x}`, parse: (x: string) => Number(x) },
    },
  };
}

async function elegir(): Promise<Cliente> {
  const urls = candidatos(process.env.DATABASE_URL);
  if (urls.length === 0) return postgres(opciones(undefined));
  if (urls.length === 1) {
    const c = postgres(urls[0], opciones(urls[0]));
    await c`select 1`;
    return c;
  }
  // Todas a la vez; gana la primera que conteste y las demás se cierran. El constructor va
  // DENTRO del try: una URL mal escrita lanza al construir, no al consultar.
  const intentos = urls.map(async (url) => {
    const c = postgres(url, opciones(url));
    try {
      await c`select 1`;
      return { url, c };
    } catch (e) {
      try { await c.end({ timeout: 1 }); } catch { /* nada */ }
      console.warn(`db: ${sinClave(url)} no contestó: ${(e as Error).message}`);
      throw e;
    }
  });
  const ganador = await Promise.any(intentos).catch((e: AggregateError) => {
    throw e.errors?.[0] instanceof Error ? e.errors[0] : new Error("Ninguna DATABASE_URL contestó.");
  });
  console.log(`db: conectado a ${sinClave(ganador.url)}`);
  // Las perdedoras que todavía estuvieran conectando se cierran solas al resolverse.
  for (const p of intentos) p.then((r) => { if (r.c !== ganador.c) r.c.end({ timeout: 1 }).catch(() => {}); }).catch(() => {});
  return ganador.c;
}

const crudo: Cliente = globalThis.__medidorSql ?? (globalThis.__medidorSql = await elegir());

/** El cliente de todos los días: con reloj. */
export const sql: Cliente = conLimite(crudo as unknown as object, LIMITE_MS) as Cliente;

/** El mismo cliente SIN reloj, para el trabajo de fondo sin nadie esperando delante (el
 * cron que recomputa resúmenes en lote). Lo acota el `statement_timeout` del rol. */
export const sqlLargo: Cliente = crudo;
