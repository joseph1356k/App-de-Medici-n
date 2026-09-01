// Cómo se lee DATABASE_URL. En su propio archivo, SIN efectos secundarios, a propósito:
// lib/db.ts se conecta a la base al cargarse, así que cualquier página que solo necesite
// saber «cuántas URLs hay» no puede importarlo — al importarlo se conectaría, y la página
// de puesta en marcha, que existe justo para cuando la conexión NO funciona, moriría con
// ella. (Pasó: /instalacion daba 500 con una URL inválida en vez de explicarla.)

/** Las URLs a probar, en orden. Admite varias separadas por coma, y si una apunta a un
 * pooler de Supabase añade sola su hermana (aws-0 ↔ aws-1): Supabase asigna cada proyecto
 * a uno de los dos y no se sabe cuál sin entrar al panel. */
export function candidatos(valor: string | undefined): string[] {
  if (!valor) return [];
  const lista = valor.split(",").map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const u of lista) {
    out.push(u);
    const m = u.match(/aws-([01])-([a-z0-9-]+)\.pooler\.supabase\.com/);
    if (m) {
      const hermana = u.replace(`aws-${m[1]}-${m[2]}.pooler`, `aws-${m[1] === "0" ? "1" : "0"}-${m[2]}.pooler`);
      if (!lista.includes(hermana)) out.push(hermana);
    }
  }
  return out;
}

/** La URL sin la contraseña, para poder escribirla en un log sin filtrarla. */
export function sinClave(url: string): string {
  return url.replace(/\/\/[^@/]*@/, "//…@");
}
