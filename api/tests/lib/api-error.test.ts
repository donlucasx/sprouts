import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { API_ERROR_CODES, apiError, settleCode, type ApiErrorCode } from "@/lib/api-error";

// 0.1.13 Spanish pass P8: every JSON error answer carries a stable `code` next to its English `error`, which stays byte-identical.

const SRC = path.resolve(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });

describe("apiError", () => {
  it("answers { error, code, ...extras } with the status and headers as given, the error text untouched", async () => {
    const res = apiError("rate_limited", { error: "Too many requests. Try again in a minute." }, { status: 429, headers: { "Retry-After": "30" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    const text = await res.text();
    expect(text).toBe('{"error":"Too many requests. Try again in a minute.","code":"rate_limited"}');
  });

  it("keeps a route's extra fields (partial, inFlight, reauth) after the code", async () => {
    const res = apiError("move_partial", { error: "Your SOL is back in your wallet; the move did not finish.", partial: true, unwrapTransaction: "AA==" }, { status: 409 });
    expect(await res.json()).toEqual({ error: "Your SOL is back in your wallet; the move did not finish.", code: "move_partial", partial: true, unwrapTransaction: "AA==" });
  });

  it("settleCode names each settle outcome that is not confirmed", () => {
    expect(settleCode("failed")).toBe("tx_failed");
    expect(settleCode("expired")).toBe("tx_expired");
    expect(settleCode("pending")).toBe("still_waiting");
  });

  it("codes are snake_case and each is documented", () => {
    for (const [code, doc] of Object.entries(API_ERROR_CODES)) {
      expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(doc.length).toBeGreaterThan(10);
    }
  });

  it("the two codes the app retries on are pinned (app/src/lib/confirm-retry.ts)", () => {
    const pinned: ApiErrorCode[] = ["no_delegation", "relink_not_on_chain"];
    for (const c of pinned) expect(API_ERROR_CODES).toHaveProperty(c);
  });
});

describe("sweep: no error body leaves the API without a code", () => {
  const all = files(SRC);

  it("no route or helper answers a JSON { error } without apiError", () => {
    const bare = all.filter((f) => !f.endsWith(path.join("lib", "api-error.ts"))).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((line, i) => (/\b(NextResponse|Response)\.json\(\s*\{\s*error\b/.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : [])),
    );
    expect(bare).toEqual([]);
  });

  it("every literal code used at a call site is in the map", () => {
    const used = new Set(all.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/apiError\("([a-z_]+)"/g)].map((m) => m[1]!)));
    expect(used.size).toBeGreaterThan(40);
    for (const c of used) expect(API_ERROR_CODES, c).toHaveProperty(c);
  });

  it("no route answers a 4xx or 5xx status outside apiError", () => {
    const stray = all.filter((f) => f.endsWith("route.ts")).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((line, i) => (/status: [45]\d\d/.test(line) && !line.includes("apiError(") ? [`${path.relative(SRC, f)}:${i + 1}`] : [])),
    );
    expect(stray).toEqual([]);
  });
});
