import { AutoRefresco } from "@/components/AutoRefresco";
import { RejillaCalor } from "@/components/RejillaCalor";
import { TarjetaConsultorio } from "@/components/TarjetaConsultorio";
import { Seccion, Vacio } from "@/components/ui";
import { estadoConsultorios, lineaDeTiempoDia, serieDiaria } from "@/lib/consultas";
import { hoyOperativo, leerFiltros, sumarDias } from "@/lib/filtros";
import { fmtFecha } from "@/lib/formato";
import { ventanaAuto, type Ventana } from "@/lib/linea-tiempo";

/**
 * INICIO: los consultorios AHORA. Una tarjeta por consultorio con su estado en este
 * momento, la tira del día (las tres comparten la misma ventana de horas para que se
 * puedan leer una contra otra) y lo acumulado hoy; debajo, los últimos siete días como
 * rejilla. Se refresca solo cada minuto mientras la pestaña está a la vista.
 */
export default async function InicioPage() {
  const hoy = hoyOperativo();
  const ahora = new Date().toISOString();
  const [estados, serie] = await Promise.all([estadoConsultorios(), serieDiaria(leerFiltros({ rango: "7d" }))]);
  // Los tres días UNO DETRÁS DE OTRO, no a la vez: cada uno ya lanza cinco consultas en
  // paralelo, y quince de golpe sobre un pool de diez en un arranque en frío del servidor
  // dejaron la primera visita del panel en el reloj de 20 s (2026-09-03, logs de Vercel).
  const dias: Awaited<ReturnType<typeof lineaDeTiempoDia>>[] = [];
  for (const e of estados) dias.push(await lineaDeTiempoDia(e.consultorio.id, hoy));
  const ventanas = dias.flatMap((d) => (d ? [ventanaAuto(d, ahora)] : []));
  const ventana: Ventana | undefined = ventanas.length
    ? { desde: Math.min(...ventanas.map((v) => v.desde)), hasta: Math.max(...ventanas.map((v) => v.hasta)) }
    : undefined;
  const fechas = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i - 6));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="titulo-pagina">Consultorios, ahora</h1>
          <p className="sub-pagina">Qué pasa en cada PC en este momento y cómo va el día operativo del {fmtFecha(hoy)} (corte 06:00). Tiempo, escritura, clics, pantallas y esperas: nunca contenido clínico.</p>
        </div>
        <AutoRefresco ahora={ahora} />
      </div>

      {estados.length === 0 ? (
        <Vacio titulo="No hay consultorios activos" texto="Crea los consultorios en Configuración y asigna cada PC al suyo en Dispositivos. Las tarjetas aparecen aquí a un minuto del terreno." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {estados.map((e, i) => <TarjetaConsultorio key={e.consultorio.id} estado={e} datos={dias[i]} ventana={ventana} ahora={ahora} />)}
          </div>
          <Seccion titulo="Últimos 7 días" sub="Horas activas por consultorio y día operativo (todas las jornadas; ⚠ = calidad excluida). Clic en una celda para ver ese día.">
            <RejillaCalor puntos={serie} consultorios={estados.map((e) => e.consultorio)} dias={fechas} />
          </Seccion>
        </>
      )}
    </div>
  );
}

// Un fallo tiene que verse en 30 s, no a los 300 que da Vercel por defecto: un giro
// de cinco minutos no es información, es un cuelgue.
export const maxDuration = 30;
