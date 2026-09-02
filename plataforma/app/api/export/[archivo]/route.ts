// GET /api/export/<coleccion>.<csv|json|ndjson> · /api/export/dataset.json · /api/export/esquema.json
// Con los mismos filtros de la URL que el panel (rango, fase, medico, dispositivo,
// incluir_mala). Sin barrera: el panel es público (ver middleware.ts).
import { NextResponse } from "next/server";
import { leerFiltros, type Sp } from "@/lib/filtros";
import { DICCIONARIO } from "@/lib/diccionario";
import { COLUMNAS, aStream, csv, dataset, json, ndjson, type Coleccion } from "@/lib/exportar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ archivo: string }> }) {
  const { archivo } = await params;
  const m = archivo.match(/^([a-z_]+)\.(csv|json|ndjson)$/);
  if (!m) return NextResponse.json({ error: "Archivo desconocido. Usa turnos|muestras|visitas|eventos .csv|.json|.ndjson, dataset.json o esquema.json" }, { status: 404 });
  const [, nombre, ext] = m;
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries()) as Sp;
  const f = leerFiltros(sp);
  const fecha = new Date().toISOString().slice(0, 10);

  if (nombre === "esquema" && ext === "json") return NextResponse.json(DICCIONARIO, { headers: { "cache-control": "no-store" } });
  if (nombre === "dataset" && ext === "json") {
    return respuesta(aStream(dataset(f, sp.muestras === "1")), "application/json; charset=utf-8", `medicion-dataset-${f.desde}-a-${f.hasta}.json`);
  }
  if (!(nombre in COLUMNAS)) return NextResponse.json({ error: `Colección desconocida: ${nombre}` }, { status: 404 });
  const col = nombre as Coleccion;
  const archivoSalida = `medicion-${col}-${f.desde}-a-${f.hasta}-${fecha}.${ext}`;
  if (ext === "csv") return respuesta(aStream(csv(col, f)), "text/csv; charset=utf-8", archivoSalida);
  if (ext === "ndjson") return respuesta(aStream(ndjson(col, f)), "application/x-ndjson; charset=utf-8", archivoSalida);
  return respuesta(aStream(json(col, f)), "application/json; charset=utf-8", archivoSalida);
}

function respuesta(cuerpo: ReadableStream<Uint8Array>, tipo: string, nombre: string) {
  return new Response(cuerpo, {
    headers: { "content-type": tipo, "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "no-store" },
  });
}
