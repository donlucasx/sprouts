import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Source-text guard (narrow by design): the ops sources only READ. A write, a webhook PUT path or a send must never land here.
const src = readFileSync(resolve(__dirname, "../../../src/lib/ops/sources.ts"), "utf8");

describe("ops sources are read-only (source text)", () => {
  for (const banned of ["checkWebhookCoverage", "heliusEnsureAddresses", "heliusAddAddress", ".insert(", ".update(", ".upsert(", ".delete(", "sendTransaction", "addEvent"]) {
    it(`does not contain ${banned}`, () => expect(src).not.toContain(banned));
  }
  it("calls no Postgres function (.rpc( on the db client)", () => expect(src).not.toMatch(/\bdb\(\)\s*\.rpc\(|\.from\([^)]*\)\s*\.rpc\(|supabase[^\n]*\.rpc\(/));
  it("uses only GET fetches (no method: other than GET)", () => expect(src).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/));
});
