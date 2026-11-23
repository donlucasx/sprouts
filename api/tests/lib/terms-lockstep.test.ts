import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TERMS_MD } from "@/lib/terms-text";
import { TERMS_VERSION } from "@/lib/terms";

// Task 16 (11-23): sprouts.money/terms and the version the API asks users to accept are the app's, byte for byte.
describe("Terms lockstep with the app", () => {
  it("serves the app's TERMS_MD and version", () => {
    const app = readFileSync("../app/src/lib/terms-text.ts", "utf8");
    const appMd = /export const TERMS_MD =\s*\n\s*(".*");/s.exec(app)![1];
    expect(TERMS_MD).toBe(JSON.parse(appMd));
    const appVersion = /export const TERMS_VERSION = "([^"]+)"/.exec(readFileSync("../app/src/lib/terms.ts", "utf8"))![1];
    expect(TERMS_VERSION).toBe(appVersion);
    expect(TERMS_VERSION).toBe("2026-11-23");
    expect(TERMS_MD).toContain("Version 2026-11-23.");
  });
});
