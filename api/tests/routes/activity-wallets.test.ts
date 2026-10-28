import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { GET as activity } from "@/app/api/activity/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const W = "FdPpbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbYjB6";
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));

// 10-28 (his note: "revoked wallets should appear on the activity tab"): links and revokes, each with why a revoke happened.
describe("GET /api/activity wallets", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  });
  type Row = { kind: string; wallet: string; why: string | null; signature: string | null };
  const get = async () => ((await (await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }))).json()) as { wallets: Row[] }).wallets;

  it("serves links and revokes with the revoke's cause, and skips an event with no wallet", async () => {
    await repo.addEvent({ userPubkey: U, walletPubkey: W, kind: "wallet_linked", detail: { webhookAdded: true, linkModel: "leash" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: W, kind: "revoke_seen", detail: { signature: "sig1", by: "user" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: U, kind: "revoke_seen", detail: { by: "token_revoke" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: U, kind: "revoke_seen", detail: null });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "revoke_seen", detail: null });
    const rows = (await get()).map(({ kind, wallet, why, signature }) => ({ kind, wallet, why, signature }));
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(expect.arrayContaining([
      { kind: "linked", wallet: W, why: null, signature: null },
      { kind: "revoked", wallet: W, why: "user", signature: "sig1" },
      { kind: "revoked", wallet: U, why: "approval", signature: null },
      { kind: "revoked", wallet: U, why: "outside", signature: null },
    ]));
  });
});
