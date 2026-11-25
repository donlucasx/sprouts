import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { readRules } from "@/lib/rules-read";

// 11-25 (server queue): GET paths read rules without writing the defaults row that getRules inserts on a first read.
describe("readRules", () => {
  it("returns the defaults for a user with no rules row and writes nothing", async () => {
    const repo = new MemoryRepo();
    const r = await readRules(repo, "NoRowUser111111111111111111111111111111111");
    expect(r.userPubkey).toBe("NoRowUser111111111111111111111111111111111");
    expect(await repo.findRules("NoRowUser111111111111111111111111111111111")).toBeNull();
    await repo.upsertUser({ seedVaultPubkey: "Other11111111111111111111111111111111111111", sgtMint: "m", skrName: null });
    const viaGet = await repo.getRules("Other11111111111111111111111111111111111111");
    expect({ ...r, userPubkey: "", updatedAt: null }).toEqual({ ...viaGet, userPubkey: "", updatedAt: null });
  });
  it("returns the stored row when there is one", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "HasRow11111111111111111111111111111111111111", sgtMint: "m2", skrName: null });
    const stored = await repo.getRules("HasRow11111111111111111111111111111111111111");
    expect(await readRules(repo, "HasRow11111111111111111111111111111111111111")).toEqual(stored);
  });
});
