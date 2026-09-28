import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], env: { TZ: "America/Los_Angeles" } }, resolve: { alias: { "@": path.resolve(__dirname, "src") } } });
