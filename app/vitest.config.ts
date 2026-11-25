import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], env: { TZ: "America/Los_Angeles" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // 0.1.13 i18n: native modules the language code reaches, stubbed for node.
      "expo-localization": path.resolve(__dirname, "tests/stubs/expo-localization.ts"),
      "react-native-mmkv": path.resolve(__dirname, "tests/stubs/react-native-mmkv.ts"),
    },
  },
});
