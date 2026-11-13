import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },   // tests render page components (tsconfig keeps jsx: preserve for Next)
  test: { environment: "node", include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup/shared-reads.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
