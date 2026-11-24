import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Meta: every file under api/src that can make a billed Helius HTTP/RPC call counts it through helius-credits. A file that only
 * opens wss subscriptions, only declares the config, or only hands the URL to a module that counts is listed here with its reason.
 */
const SRC = path.resolve(__dirname, "../../src");
const BILLED = /heliusRpcUrl|api\.helius\.xyz|new Connection\(/;
const ALLOW: Record<string, string> = {
  "lib/config.ts": "declares the URL and key, makes no call",
  "app/api/auth/verify/route.ts": "hands the URL to genesis.ts and skr.ts, which count each request",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("Helius credit counting covers every billed call site", () => {
  it("every file that reaches Helius over HTTP imports helius-credits (offenders listed)", () => {
    const offenders = files(SRC)
      .map((p) => ({ rel: path.relative(SRC, p).split(path.sep).join("/"), text: readFileSync(p, "utf8") }))
      .filter((f) => BILLED.test(f.text) && !(f.rel in ALLOW) && !/from "(@\/lib\/|\.\/)helius-(credits|count)"/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("11-24: no file opens a Helius websocket any more (confirmation polls over HTTP, lib/confirm.ts), so none needs the wss allowance", () => {
    for (const rel of ["lib/staking.ts", "lib/planting.ts", "lib/pyth.ts", "lib/confirm.ts"]) {
      const text = readFileSync(path.join(SRC, rel), "utf8");
      expect(text, rel).not.toMatch(/heliusRpcUrl|createSolanaRpcSubscriptions/);
    }
  });

  it("rpc.ts and helius-count.ts stay loadable from the app's tests: no '@/' import, nothing from db/ or founder-alert, types included", () => {
    // The app's vitest and tsc map '@' to app/src, and app tests import api code that imports rpc.ts (fix round 2).
    for (const rel of ["lib/rpc.ts", "lib/helius-count.ts"]) {
      const text = readFileSync(path.join(SRC, rel), "utf8");
      const specs = [...text.matchAll(/(?:from|import\()\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(specs.filter((x) => x.startsWith("@/") || x.includes("db/") || x.includes("founder-alert") || x.includes("helius-credits")), rel).toEqual([]);
    }
  });

  it("the swap webhook route counts each delivered item (1 credit each)", () => {
    const text = readFileSync(path.join(SRC, "app/api/webhooks/helius/route.ts"), "utf8");
    expect(text).toMatch(/from "@\/lib\/helius-count"/);
    expect(text).toMatch(/countHelius\(\s*items\.length/);
  });
});
