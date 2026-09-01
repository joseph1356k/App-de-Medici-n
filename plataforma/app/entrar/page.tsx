import { entrar } from "./actions";

export const dynamic = "force-dynamic";

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ error?: string; a?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form action={entrar} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="inline-block h-3 w-3 rounded-full bg-good" aria-hidden />
          <h1 className="text-lg font-semibold text-ink">Panel del medidor</h1>
        </div>
        <p className="mb-4 text-sm text-muted">Escribe la contraseña del panel para ver los datos de la medición.</p>
        {sp.error && <p className="mb-3 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">Contraseña incorrecta.</p>}
        <input type="hidden" name="a" value={sp.a ?? ""} />
        <label className="block text-sm font-medium text-ink">
          Contraseña
          <input name="password" type="password" autoFocus required className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" />
        </label>
        <button type="submit" className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Entrar</button>
      </form>
    </main>
  );
}
