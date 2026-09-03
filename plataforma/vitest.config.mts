import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// El alias «@/» sirve a tests/lote.test.ts (la ruta de ingesta con la base simulada) y a
// tests/linea-tiempo-render.test.tsx (el componente de servidor con react-dom/server, sin
// levantar Next). tsconfig deja el JSX en `preserve` porque lo compila Next; aquí hay que
// decirle a oxc (el compilador de Vite 8) que lo transforme él.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.{ts,tsx}"] },
});
