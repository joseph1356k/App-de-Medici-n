// Lo que el .exe recibe al registrarse o refrescar config: settings + roster + fases.
import { sql } from "./db";

export type Ajustes = {
  hospital: string; config_version: number; config: Record<string, unknown>;
  hmac_version: number; hmac_secret: string;
};

export async function leerAjustes(): Promise<Ajustes> {
  const [a] = await sql<Ajustes[]>`select hospital, config_version, config, hmac_version, hmac_secret from settings where id = 1`;
  if (!a) throw new Error("La tabla settings está vacía: aplica supabase/schema.sql.");
  return a;
}

export async function rosterActivo() {
  return sql<{ id: string; display_name: string; sap_users: string[] }[]>`
    select id, display_name, sap_users from roster where active order by sort_order, display_name`;
}

export async function fases() {
  return sql<{ phase: string; starts_on: string; ends_on: string | null }[]>`
    select phase, starts_on::text, ends_on::text from study_phases order by starts_on`;
}

/** El paquete que viaja al .exe. El secreto solo va cuando `conSecreto` (registro o rotación). */
export async function paqueteParaElMedidor(conSecreto: boolean) {
  const [a, r, f] = await Promise.all([leerAjustes(), rosterActivo(), fases()]);
  return {
    hospital: a.hospital,
    config_version: a.config_version,
    config: { ...a.config, config_version: a.config_version },
    roster: r,
    phases: f,
    hmac: conSecreto ? { version: a.hmac_version, secret: a.hmac_secret } : { version: a.hmac_version },
  };
}
