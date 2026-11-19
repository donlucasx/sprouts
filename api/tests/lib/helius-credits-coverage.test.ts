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
  "lib/staking.ts": "heliusRpcUrl only for wss signature subscriptions; HTTP goes through rpc() (counted)",
  "lib/planting.ts": "heliusRpcUrl only for wss signature subscriptions; HTTP goes through rpc() (counted)",
  "lib/pyth.ts": "heliusRpcUrl only for wss signature subscriptions; HTTP goes through rpc() (counted)",
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
      .filter((f) => BILLED.test(f.text) && !(f.rel in ALLOW) && !/from "(@\/lib\/|\.\/)helius-credits"/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the allowlisted wss-only files use heliusRpcUrl only for wss subscriptions", () => {
    for (const rel of ["lib/staking.ts", "lib/planting.ts", "lib/pyth.ts"]) {
      const lines = readFileSync(path.join(SRC, rel), "utf8").split("\n").filter((l) => l.includes("heliusRpcUrl"));
      expect(lines.length, rel).toBeGreaterThan(0);
      for (const l of lines) expect(l, rel).toMatch(/createSolanaRpcSubscriptions\(config\(\)\.heliusRpcUrl\.replace\("https:\/\/", "wss:\/\/"\)\)/);
    }
  });

  it("the swap webhook route counts each delivered item (1 credit each)", () => {
    const text = readFileSync(path.join(SRC, "app/api/webhooks/helius/route.ts"), "utf8");
    expect(text).toMatch(/from "@\/lib\/helius-credits"/);
    expect(text).toMatch(/countHelius\(\s*items\.length/);
  });
});
