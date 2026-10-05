import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, decompileTransactionMessage, compileTransaction, signTransaction, getBase64EncodedWireTransaction, address, type KeyPairSigner } from "@solana/kit";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

/**
 * A tiny fake chain: the old puller delegation (OLD) is live until a send lands; the send lands unless `chain.sendLands` is false.
 * The new delegation reads as the leash delegation for this user (delegator, delegatee, $5 per day, no expiry) once a send landed,
 * unless a test overrides `chain.created`.
 */
const { simulateMock, chain } = vi.hoisted(() => ({
  simulateMock: vi.fn(async () => ({ value: { err: null as unknown, logs: [] as string[] } })),
  chain: { oldLive: true, sendLands: true, landed: false, sent: 0, user: "", leash: "", created: null as null | Record<string, unknown> },
}));
const NONE = { exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n };
vi.mock("@/lib/subscriptions", async (orig) => ({
  ...(await orig<object>()),
  readDelegation: vi.fn(async (pda: string) => (pda === "ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD" && !chain.oldLive
    ? { exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n }
    : { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n })),
  readSubscriptionAuthority: vi.fn(async () => ({ exists: true, initId: 4n })),
  readUsdcAtaExists: vi.fn(async () => true),
  waitForDelegation: vi.fn(async () => (!chain.landed
    ? { exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n }
    : chain.created ?? { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n, delegator: chain.user, delegatee: chain.leash, expiryTs: 0n })),
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  simulateTransaction: () => ({ send: simulateMock }),
  sendTransaction: () => ({ send: async () => {
    chain.sent++;
    if (!chain.sendLands) throw new Error("blockhash not found");
    chain.landed = true;
    chain.oldLive = false;
    return "sig";
  } }),
}) }));

import { POST as build } from "@/app/api/relink/build/route";
import { POST as confirm } from "@/app/api/relink/confirm/route";
import { leashPda } from "@/lib/leash";
import { buildApproveOnceIxs, buildRevokeDelegationIx, readSubscriptionAuthority, readUsdcAtaExists } from "@/lib/subscriptions";
import type { Instruction } from "@solana/kit";
import { buildUserTransaction } from "@/lib/user-tx";
import { appCheckApproval, appLeashPda, SignRefused } from "../fixtures/app-sign-approval";

let user: KeyPairSigner;
beforeAll(async () => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  user = await generateKeyPairSigner();
  chain.user = user.address;
  chain.leash = await leashPda(user.address, user.address);
});

const OLD = "ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD";
const decode = (b64: string) => getTransactionDecoder().decode(getBase64Encoder().encode(b64));
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SUBS = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
/** program id + first data byte of each instruction, e.g. "ATA:1", "SUBS:3". */
function shape(b64: string): string[] {
  const m = getCompiledTransactionMessageDecoder().decode(decode(b64).messageBytes);
  if (m.version !== 0) throw new Error("not v0");
  const keys = m.staticAccounts as readonly string[];
  return m.instructions.map((ix) => `${keys[ix.programAddressIndex] === ATA ? "ATA" : keys[ix.programAddressIndex] === SUBS ? "SUBS" : keys[ix.programAddressIndex]}:${ix.data?.[0]}`);
}

describe("re-link the Seed Vault wallet to the leash (contracts 5.5, R287)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: user.address, sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: user.address, userPubkey: user.address, delegationPda: OLD, dailyCapCents: 500 });
    simulateMock.mockClear();
    Object.assign(chain, { oldLive: true, sendLands: true, landed: false, sent: 0, created: null });
  });
  const call = async (fn: typeof build, body: unknown) => fn(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${await issueSession(user.address, "M")}` }, body: JSON.stringify(body) }));
  const sign = async (b64: string) => getBase64EncodedWireTransaction(await signTransaction([user.keyPair], decode(b64)));

  it("build: revoke the old delegation, create one whose delegatee is leashPda(user, user), $5 a day", async () => {
    const res = await call(build, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ leashPda: await leashPda(user.address, user.address), revokes: OLD, cap: 500 });
  });
  it("confirm: sends it, waits for the delegation, marks the wallet leashed", async () => {
    const built = await (await call(build, {})).json();
    const res = await call(confirm, { signedTransaction: await sign(built.transaction) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relinked: true, linkModel: "leash", delegationPda: built.delegationPda });
    expect(await repo.getWallet(user.address)).toMatchObject({ linkModel: "leash", delegationPda: built.delegationPda });
    expect(repo.events.find((e) => e.kind === "relinked")?.detail).toEqual({ delegationPda: built.delegationPda, oldDelegationPda: OLD, revoked: true });
  });
  it("confirm refuses a create whose delegatee is not the leash PDA", async () => {
    const built = await (await call(build, {})).json();
    const t = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(t.messageBytes)) as Extract<ReturnType<typeof decompileTransactionMessage>, { version: 0 }>;
    const attacker = (await generateKeyPairSigner()).address;
    const tampered = { ...m, instructions: m.instructions.map((ix, i) => (i === m.instructions.length - 1 ? { ...ix, accounts: ix.accounts!.map((a, j) => (j === 3 ? { ...a, address: address(attacker) } : a)) } : ix)) };
    const wire = getBase64EncodedWireTransaction(await signTransaction([user.keyPair], compileTransaction(tampered as typeof m)));
    expect((await call(confirm, { signedTransaction: wire })).status).toBe(400);
  });
  it("a wallet already on the leash gets 409", async () => {
    await repo.setWalletLink(user.address, { delegationPda: "D", linkModel: "leash" });
    expect((await call(build, {})).status).toBe(409);
  });

  // ---- beyond the brief: the app's exact strings, the phone's verifier, the simulation gate ----

  it("a late re-link answers 409 with the sentence the app matches, and nothing is recorded", async () => {
    const built = await (await call(build, {})).json();
    chain.sendLands = false;   // a failed or never-landing send
    const res = await call(confirm, { signedTransaction: await sign(built.transaction) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("No re-link found on chain yet. Check again in a minute.");
    expect(await repo.getWallet(user.address)).toMatchObject({ linkModel: "puller", delegationPda: OLD });
    expect(repo.events.map((e) => e.kind)).not.toContain("relinked");
  });
  it("confirm refuses a wallet that is not this user's linked Seed Vault wallet", async () => {
    const built = await (await call(build, {})).json();
    await repo.setWalletLink(user.address, { delegationPda: "D", linkModel: "leash" });
    expect((await call(confirm, { signedTransaction: await sign(built.transaction) })).status).toBe(409);
  });
  it("a simulation failure asks nothing of the wallet (400)", async () => {
    simulateMock.mockResolvedValueOnce({ value: { err: "AccountNotFound", logs: [] } });
    expect((await call(build, {})).status).toBe(400);
  });
  it("no live old delegation: no revoke, revokes null", async () => {
    chain.oldLive = false;
    const body = await (await call(build, {})).json();
    expect(body.revokes).toBeNull();
    expect(shape(body.transaction)).toEqual(["SUBS:2"]);
    await expect(appCheckApproval(decode(body.transaction), { kind: "relink", user: user.address })).resolves.toBeUndefined();
  });

  // ---- fix round 1 (review I1, I2): the create is bound in full before the send, and the chain is read back after it ----

  /** Re-signs the built transaction with its instruction list changed by `f`. */
  async function tamper(b64: string, f: (ixs: Instruction[]) => Instruction[]) {
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(decode(b64).messageBytes)) as Extract<ReturnType<typeof decompileTransactionMessage>, { version: 0 }>;
    const changed = { ...m, instructions: f([...m.instructions] as Instruction[]) };
    return getBase64EncodedWireTransaction(await signTransaction([user.keyPair], compileTransaction(changed as typeof m)));
  }
  const withCreate = (ixs: Instruction[], g: (ix: Instruction) => Instruction) => ixs.map((ix, i) => (i === ixs.length - 1 ? g(ix) : ix));
  const expectRefusedUnsent = async (wire: string) => {
    const res = await call(confirm, { signedTransaction: wire });
    expect(res.status).toBe(400);
    expect(chain.sent).toBe(0);
    expect(await repo.getWallet(user.address)).toMatchObject({ linkModel: "puller", delegationPda: OLD });
  };

  it("I1: a create whose delegation account is the old puller delegation is refused before sending", async () => {
    const built = await (await call(build, {})).json();
    await expectRefusedUnsent(await tamper(built.transaction, (ixs) => withCreate(ixs, (ix) => ({ ...ix, accounts: ix.accounts!.map((a, j) => (j === 2 ? { ...a, address: address(OLD) } : a)) }))));
  });
  it("I1: a create for $10 a day (same accounts) is refused before sending", async () => {
    const built = await (await call(build, {})).json();
    await expectRefusedUnsent(await tamper(built.transaction, (ixs) => withCreate(ixs, (ix) => {
      const data = new Uint8Array(ix.data!);
      new DataView(data.buffer).setBigUint64(9, 10_000_000n, true);
      return { ...ix, data };
    })));
  });
  it("I1: a create with an expiry, or a 1-hour period, is refused before sending", async () => {
    const built = await (await call(build, {})).json();
    for (const [at, v] of [[33, 1_900_000_000n], [17, 3_600n]] as const) {
      await expectRefusedUnsent(await tamper(built.transaction, (ixs) => withCreate(ixs, (ix) => {
        const data = new Uint8Array(ix.data!);
        new DataView(data.buffer).setBigUint64(at, v, true);
        return { ...ix, data };
      })));
    }
  });
  it("I1: a create whose authority account is not this user's USDC subscription authority is refused before sending", async () => {
    const built = await (await call(build, {})).json();
    const other = (await generateKeyPairSigner()).address;
    await expectRefusedUnsent(await tamper(built.transaction, (ixs) => withCreate(ixs, (ix) => ({ ...ix, accounts: ix.accounts!.map((a, j) => (j === 1 ? { ...a, address: other } : a)) }))));
  });
  it("I1: the delegation on chain after the poll must be the leash delegation; otherwise nothing is recorded", async () => {
    const built = await (await call(build, {})).json();
    const wire = await sign(built.transaction);
    for (const created of [
      { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n, delegator: user.address, delegatee: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1", expiryTs: 0n },
      { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n, delegator: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6", delegatee: chain.leash, expiryTs: 0n },
      { exists: true, amountPerPeriodRaw: 9_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n, delegator: user.address, delegatee: chain.leash, expiryTs: 0n },
      { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n },   // no header read: never trusted
    ]) {
      Object.assign(chain, { oldLive: true, landed: false, created });
      expect((await call(confirm, { signedTransaction: wire })).status).toBe(400);
      expect((await repo.getWallet(user.address))!.linkModel).toBe("puller");
    }
  });
  it("I2: with the old delegation live, a re-link that does not revoke it is refused before sending", async () => {
    const built = await (await call(build, {})).json();
    expect(shape(built.transaction)).toEqual(["SUBS:3", "SUBS:2"]);
    await expectRefusedUnsent(await tamper(built.transaction, (ixs) => ixs.slice(1)));
  });
  it("I2: a revoke of some other delegation does not count", async () => {
    const built = await (await call(build, {})).json();
    const other = (await generateKeyPairSigner()).address;
    await expectRefusedUnsent(await tamper(built.transaction, (ixs) => ixs.map((ix, i) => (i === 0 ? { ...ix, accounts: ix.accounts!.map((a, j) => (j === 1 ? { ...a, address: other } : a)) } : ix))));
  });
  it("I2: the old delegation still on chain after the new one appears: 409, nothing recorded; once it is gone the retry records", async () => {
    const built = await (await call(build, {})).json();
    const wire = await sign(built.transaction);
    // The send lands the create but the old delegation still reads live (a lagging read).
    chain.landed = true;
    chain.sendLands = false;
    const res = await call(confirm, { signedTransaction: wire });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("No re-link found on chain yet. Check again in a minute.");
    expect((await repo.getWallet(user.address))!.linkModel).toBe("puller");
    chain.oldLive = false;
    expect((await call(confirm, { signedTransaction: wire })).status).toBe(200);
    expect(await repo.getWallet(user.address)).toMatchObject({ linkModel: "leash", delegationPda: built.delegationPda });
  });
  it("the re-link refreshes the wallet's daily cap from the new delegation", async () => {
    await repo.addWallet({ pubkey: user.address, userPubkey: user.address, delegationPda: OLD, dailyCapCents: 250 });
    const built = await (await call(build, {})).json();
    expect((await call(confirm, { signedTransaction: await sign(built.transaction) })).status).toBe(200);
    expect((await repo.getWallet(user.address))!.dailyCapCents).toBe(500);
  });
  describe("the phone's own check (app sign.ts checkApproval, vendored) accepts what the API builds", () => {
    it("the leash PDA the API derives is the one the phone derives", async () => {
      expect(await leashPda(user.address, user.address)).toBe(await appLeashPda(user.address, user.address));
    });
    it("authority exists: [revoke, create]", async () => {
      const body = await (await call(build, {})).json();
      expect(shape(body.transaction)).toEqual(["SUBS:3", "SUBS:2"]);
      await expect(appCheckApproval(decode(body.transaction), { kind: "relink", user: user.address })).resolves.toBeUndefined();
    });
    it("no USDC account, no authority: the one builder's order [revoke, ATA, init, create], no ComputeBudget", async () => {
      vi.mocked(readUsdcAtaExists).mockResolvedValueOnce(false);
      vi.mocked(readSubscriptionAuthority).mockResolvedValueOnce({ exists: false });
      const body = await (await call(build, {})).json();
      expect(shape(body.transaction)).toEqual(["SUBS:3", "ATA:1", "SUBS:0", "SUBS:2"]);
      await expect(appCheckApproval(decode(body.transaction), { kind: "relink", user: user.address })).resolves.toBeUndefined();
      // and the server accepts its own build
      expect((await call(confirm, { signedTransaction: await sign(body.transaction) })).status).toBe(200);
    });
    it("the other order the phone accepts, [revoke, ATA, init, create] (link/[code] and the Task 18 builder put the revoke first)", async () => {
      const me = user.address;
      const leash = await leashPda(me, me);
      const ixs = [buildRevokeDelegationIx({ delegator: me, delegationPda: address(OLD) }), ...(await buildApproveOnceIxs({ delegator: me, delegatee: leash, capRaw: 5_000_000n, nonce: 99n, createAta: true }))];
      const b64 = await buildUserTransaction(me, ixs);
      expect(shape(b64)).toEqual(["SUBS:3", "ATA:1", "SUBS:0", "SUBS:2"]);
      await expect(appCheckApproval(decode(b64), { kind: "relink", user: me })).resolves.toBeUndefined();
      expect((await call(confirm, { signedTransaction: await sign(b64) })).status).toBe(200);
    });
    it("the vendored check is live: a create to the puller, or a revoke after the init, is refused", async () => {
      const me = user.address;
      const toPuller = await buildUserTransaction(me, await buildApproveOnceIxs({ delegator: me, delegatee: address("HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd"), capRaw: 5_000_000n, nonce: 1n, existingInitId: 4n }));
      await expect(appCheckApproval(decode(toPuller), { kind: "relink", user: me })).rejects.toBeInstanceOf(SignRefused);
      const [ata, init, create] = await buildApproveOnceIxs({ delegator: me, delegatee: await leashPda(me, me), capRaw: 5_000_000n, nonce: 2n, createAta: true });
      const late = await buildUserTransaction(me, [ata, init, buildRevokeDelegationIx({ delegator: me, delegationPda: address(OLD) }), create]);
      await expect(appCheckApproval(decode(late), { kind: "relink", user: me })).rejects.toBeInstanceOf(SignRefused);
      const tenDollars = await buildUserTransaction(me, await buildApproveOnceIxs({ delegator: me, delegatee: await leashPda(me, me), capRaw: 10_000_000n, nonce: 3n, existingInitId: 4n }));
      await expect(appCheckApproval(decode(tenDollars), { kind: "relink", user: me })).rejects.toBeInstanceOf(SignRefused);
    });
  });
});
