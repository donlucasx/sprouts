import { describe, it, expect } from "vitest";
import { CallError } from "@/app/call";
import { isBlockhashExpired, signAndConfirmRebuildingOnce } from "@/lib/link-rebuild";

// 11-26 (Kimi scope 2 B): the web /link page's rebuild-once on an expired approval.
const expired = () => new CallError("No delegation found: the network did not accept the approval (BlockhashNotFound). Nothing was linked. Try again.", 409, "blockhash_expired");

function flow(confirms: (() => unknown)[]) {
  const log: string[] = [];
  let builds = 0, i = 0;
  return {
    log,
    run: () => signAndConfirmRebuildingOnce({
      build: async () => { builds++; log.push(`build${builds}`); return { transaction: `tx${builds}` }; },
      sign: async (b) => { log.push(`sign ${b.transaction}`); return `signed ${b.transaction}`; },
      confirm: async (s) => { log.push(`confirm ${s}`); const r = confirms[i++](); if (r instanceof Error) throw r; return r; },
      onRebuild: () => log.push("again"),
    }),
  };
}

describe("signAndConfirmRebuildingOnce", () => {
  it("expired once: a fresh approval, signed once more, confirmed", async () => {
    const f = flow([expired, () => ({ skrName: null })]);
    await expect(f.run()).resolves.toEqual({ built: { transaction: "tx2" }, result: { skrName: null } });
    expect(f.log).toEqual(["build1", "sign tx1", "confirm signed tx1", "again", "build2", "sign tx2", "confirm signed tx2"]);
  });
  it("expired twice: the second is thrown, no third signature", async () => {
    const f = flow([expired, expired, () => ({})]);
    await expect(f.run()).rejects.toMatchObject({ code: "blockhash_expired" });
    expect(f.log.filter((l) => l.startsWith("sign"))).toHaveLength(2);
  });
  it("any other refusal (no_delegation, another status) is thrown at once, no rebuild", async () => {
    for (const e of [new CallError("No delegation found yet.", 409, "no_delegation"), new CallError("x", 400, "blockhash_expired"), new Error("No delegation found")]) {
      const f = flow([() => e]);
      await expect(f.run()).rejects.toBe(e);
      expect(f.log).not.toContain("again");
    }
  });
  it("isBlockhashExpired needs the 409 and the code (an older server's English alone is not enough)", () => {
    expect(isBlockhashExpired(expired())).toBe(true);
    expect(isBlockhashExpired(new CallError(expired().message, 409))).toBe(false);
  });
});
