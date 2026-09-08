/**
 * EL CAMBIO frente al periodo anterior del mismo largo.
 *
 * Quien llama dice qué significa subir (`mejor`), porque el signo por sí solo no lo sabe: en
 * «tiempo en SAP» subir es malo y en «pacientes» es bueno. Sin dato anterior no se inventa un
 * 0 % — se dice que no hay con qué comparar.
 */
export function Delta({ antes, ahora, mejor = "menos" }: {
  antes: number | null | undefined; ahora: number | null | undefined; mejor?: "mas" | "menos" | "neutro";
}) {
  if (antes == null || ahora == null || Number(antes) === 0) return <span className="text-muted">sin periodo anterior</span>;
  const pct = ((Number(ahora) - Number(antes)) / Math.abs(Number(antes))) * 100;
  if (Math.abs(pct) < 1) return <span className="text-muted">igual que antes</span>;
  const sube = pct > 0;
  const bueno = mejor === "neutro" ? null : sube === (mejor === "mas");
  const color = bueno == null ? "text-secondary" : bueno ? "text-good-text" : "text-critical";
  return (
    <span className={color} title="Frente al periodo anterior del mismo largo">
      {sube ? "▲" : "▼"} {Math.abs(pct).toFixed(0)} %
    </span>
  );
}
