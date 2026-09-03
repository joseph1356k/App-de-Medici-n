// Un día sintético para probar la línea de tiempo sin base de datos: bloques en horas de
// Bogotá («08:00»–«10:00», app, paciente, usuario) → cubetas de 15 s → segmentos, igual que
// lo haría lib/consultas.ts con filas reales.
import type { LineaDeTiempoDia, VisitaSap } from "../../lib/consultas";
import { finDiaOperativo, inicioDiaOperativo } from "../../lib/fechas";
import { medicosVistos, pacientesDelDia, segmentar, type Bucket, type Marca } from "../../lib/segmentos";

export const FECHA = "2026-09-01";
export const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);
export const SAP = "sapgui://PRD/NV2000/SAPMNPA10/0100";
export const CONSULTORIO_ID = "00000000-0000-4000-8000-000000000001";
const HORA = 3_600_000, MIN = 60_000;
export const DIA0 = Date.parse(inicioDiaOperativo(FECHA)); // 06:00 Bogotá

/** «08:30» del día operativo → epoch ms (las horas < 06 caen en la madrugada siguiente). */
export function hora(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return DIA0 + (((h - 6) + 24) % 24) * HORA + m * MIN;
}

export type Bloque = {
  desde: string; hasta: string;
  app?: string; surface?: string | null; encounter?: string | null; sap_user?: string | null;
  activo?: boolean; bloqueado?: boolean;
  /** Alterna la app cada cubeta entre `app` y `alterna` (para el caso de 5 760 cubetas). */
  alterna?: string;
};

export function cubetas(bloques: Bloque[]): Bucket[] {
  const out: Bucket[] = [];
  for (const b of bloques) {
    let i = 0;
    // «06:00»–«06:00» es el día entero: un fin que no va después del inicio es del día siguiente.
    const fin = hora(b.hasta) <= hora(b.desde) ? hora(b.hasta) + 24 * HORA : hora(b.hasta);
    for (let t = hora(b.desde); t < fin; t += 15_000, i++) {
      const bloq = !!b.bloqueado;
      const app = bloq ? "bloqueado" : b.alterna && i % 2 === 1 ? b.alterna : (b.app ?? "sap");
      const activo = !bloq && b.activo !== false;
      out.push({
        bucket_start: new Date(t).toISOString(), bucket_ms: 15000, seq: 0, app,
        surface: bloq ? null : b.surface === undefined ? (app === "sap" ? SAP : null) : b.surface,
        encounter_key: bloq ? null : (b.encounter ?? null), sap_user: bloq ? null : (b.sap_user ?? null),
        foreground_ms: 15000, active_ms: activo ? 12000 : 0, typing_ms: activo ? 3000 : 0,
        keystrokes: activo ? 20 : 0, clicks: activo ? 3 : 0, sap_wait_ms: app === "sap" ? 200 : 0,
      });
    }
  }
  return out;
}

export function visita(tcode: string, desde: string, dwellS: number, extra: Partial<VisitaSap> = {}): VisitaSap {
  const t0 = hora(desde);
  return {
    visit_uid: `${tcode}-${desde}`, tcode, surface: `sapgui://PRD/${tcode}/SAPMNPA10/0100`, dynpro: "0100",
    entered_at: new Date(t0).toISOString(), left_at: new Date(t0 + dwellS * 1000).toISOString(), dwell_ms: dwellS * 1000,
    ready_ms: 900, sap_wait_ms: 1500, roundtrips: 3, exit_to: null, encounter_key: null, sap_user: "MED01",
    ...extra,
  };
}

export function marca(kind: string, hhmm: string, detail: Marca["detail"] = {}): Marca {
  return { t: new Date(hora(hhmm)).toISOString(), kind, detail };
}

/** «08:00» + `n` minutos, en «HH:MM» (para sembrar eventos minuto a minuto). */
function hhmm(minutosDesdeLas8: number): string {
  const t = 8 * 60 + minutosDesdeLas8;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * EL DÍA QUE ROMPÍA EL CARRIL DE EVENTOS: SIN pacientes y sin visitas SAP (así que esos dos
 * carriles no tienen nada que enseñar) y con `n` eventos apelotonados minuto a minuto, que
 * era lo que salía en pantalla como «×16 ×9 ×7 ×2010».
 */
export function diaCargado(n = 40): LineaDeTiempoDia {
  const marcas = Array.from({ length: n }, (_, i) => marca(i % 2 ? "lock" : "unlock", hhmm(i)));
  return diaSintetico([{ desde: "08:00", hasta: "12:00", app: "chrome", surface: null }], { marcas });
}

export function diaSintetico(bloques: Bloque[], extra: { visitas?: VisitaSap[]; marcas?: Marca[]; hasta?: string; roster?: { id: string; display_name: string; sap_users: string[] }[] } = {}): LineaDeTiempoDia {
  const segmentos = segmentar(cubetas(bloques));
  const visitas = extra.visitas ?? [];
  return {
    consultorio: { id: CONSULTORIO_ID, nombre: "Consultorio 1" },
    device: { id: "00000000-0000-4000-8000-0000000000aa", machine_name: "PC-C1" },
    fecha: FECHA, desde: inicioDiaOperativo(FECHA), hasta: extra.hasta ?? finDiaOperativo(FECHA),
    segmentos, marcas: extra.marcas ?? [], visitas,
    pacientes: pacientesDelDia(segmentos, visitas),
    resumen: null,
    medicos_vistos: medicosVistos(segmentos, extra.roster ?? []),
  };
}
