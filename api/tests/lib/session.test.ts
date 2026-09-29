import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession, readSession, signOut, signOutEverywhere } from "@/lib/session";

const DAY_MS = 86_400_000;

describe("sessions (R84: opaque token, hashed at rest, seven days fixed, one per wallet per device)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: "PUBKEY1", sgtMint: "DEV1", skrName: null });
  });

  it("issue then read returns the pubkey; the token is random and never stored as is", async () => {
    const token = await issueSession("PUBKEY1", "DEV1");
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(await readSession(token)).toMatchObject({ pubkey: "PUBKEY1" });
    expect(repo.sessions.has(token)).toBe(false);
    expect((await issueSession("PUBKEY1", "DEV1")) === token).toBe(false);
  });

  it("a tampered or unknown token reads null", async () => {
    const token = await issueSession("PUBKEY1", "DEV1");
    expect(await readSession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await readSession("not-a-token")).toBeNull();
    expect(await readSession("")).toBeNull();
  });

  it("expires seven days after sign-in, never extended by use", async () => {
    const at = new Date("2026-09-28T12:00:00Z");
    const token = await issueSession("PUBKEY1", "DEV1", at);
    expect(await readSession(token, new Date(at.getTime() + 7 * DAY_MS - 1000))).not.toBeNull();
    expect(await readSession(token, new Date(at.getTime() + 7 * DAY_MS))).toBeNull();
  });

  it("sign-out revokes this session at once", async () => {
    const token = await issueSession("PUBKEY1", "DEV1");
    const s = await readSession(token);
    await signOut(s!.tokenHash);
    expect(await readSession(token)).toBeNull();
  });

  it("a new sign-in on the same device replaces the old session; another device keeps its own", async () => {
    const first = await issueSession("PUBKEY1", "DEV1");
    const other = await issueSession("PUBKEY1", "DEV2");
    const second = await issueSession("PUBKEY1", "DEV1");
    expect(await readSession(first)).toBeNull();
    expect(await readSession(second)).not.toBeNull();
    expect(await readSession(other)).not.toBeNull();
  });

  it("sign out everywhere ends every device's session", async () => {
    const a = await issueSession("PUBKEY1", "DEV1");
    const b = await issueSession("PUBKEY1", "DEV2");
    await signOutEverywhere("PUBKEY1");
    expect(await readSession(a)).toBeNull();
    expect(await readSession(b)).toBeNull();
  });
});
