import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  address, createNoopSigner, getBase64Decoder, getBase64Encoder, getTransactionDecoder, getTransactionEncoder, getCompiledTransactionMessageDecoder, AccountRole,
  type Address, type Instruction, type Transaction,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { getTransferInstruction } from "@solana-program/token";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { buildUserTransaction } from "@/lib/user-tx";
import { reconcileOwnStakes } from "@/lib/reconcile";
// The APP's verifier (app/src/lib/sign.ts, vendored verbatim but for its coins import): what the Seed Vault refuses, run on our output.
import { checkBeforeSigning, SignRefused } from "../fixtures/app/sign";

/**
 * 0.1.13 Plant my SKR (brief 2026-11-25, Kimi scope check #15): (a) the transaction holds only the capped compute budget and the one
 * stake, on the server's build and confirm AND the phone's check; (b) STAKE_PLANT_OFF=1: idleSkr null, build 503, confirm 503; (c) the
 * confirm books the put in, the next reconcile adds nothing, one Activity row; a retry of the same signature writes nothing more.
 */
const SP = 1_146_000_000n;
const JOINED = 1_000_000_000n;
const { chain, simulateMock } = vi.hoisted(() => ({
  chain: { walletSkr: 500_000_000n as bigint | "down", shares: 1_000_000_000n, sent: 0, status: "confirmed" as "confirmed" | "failed" | "pending", blockhashValid: true, statuses: 0 },
  simulateMock: vi.fn(async () => ({ value: { err: null as unknown, logs: [] as string[] } })),
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  simulateTransaction: () => ({ send: simulateMock }),
  sendTransaction: () => ({ send: async () => { chain.sent++; return "sig"; } }),
  getSignatureStatuses: (sigs: string[]) => ({ send: async () => { chain.statuses++; return { value: sigs.map(() => (chain.status === "pending" ? null : { err: chain.status === "failed" ? { InstructionError: [0, "x"] } : null, confirmationStatus: "confirmed" })) }; } }),
  isBlockhashValid: () => ({ send: async () => ({ value: chain.blockhashValid }) }),
}) }));
vi.mock("@/lib/user-tx", async (orig) => {
  const real = await orig<typeof import("@/lib/user-tx")>();
  return { ...real, waitConfirmed: (sig: string, _t?: number, _e?: number, opts?: { deadlineMs?: number }) => real.waitConfirmed(sig, 2, 0, opts) };
});
vi.mock("@/lib/staking", async (orig) => ({
  ...(await orig<object>()),
  readPosition: vi.fn(async () => ({ shares: chain.shares, stakedRaw: (chain.shares * SP) / 1_000_000_000n, unstakingRaw: 0n, unstakeTs: null })),
  sharePrice: vi.fn(async () => SP),
}));
vi.mock("@/lib/holdings", async (orig) => ({
  ...(await orig<object>()),
  readHoldings: vi.fn(async () => ({})), readLendingPositions: vi.fn(async () => []),
  assetBalanceRaw: vi.fn(async () => { if (chain.walletSkr === "down") throw new Error("fetch failed"); return chain.walletSkr; }),
}));
vi.mock("@/lib/jupiter", async (orig) => ({ ...(await orig<object>()), priceUsd: vi.fn(async () => 0.02) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 0n), storeRedeemRate: vi.fn(async () => 1_048_350_000n) }));
vi.mock("@/lib/leash", async (orig) => ({ ...(await orig<object>()), readLeashConfig: vi.fn(async () => { throw new Error("not deployed"); }) }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(async () => ({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n })) }));

import { POST as build } from "@/app/api/stake/build/route";
import { POST as confirm } from "@/app/api/stake/confirm/route";
import { GET as me } from "@/app/api/me/route";
import { GET as activity } from "@/app/api/activity/route";
import { checkPlantSkr, plantSkrAccounts, plantSkrIxs, idleSkrFrom } from "@/lib/plant-skr";
import { toTopUpIx } from "@/lib/topup";
import { buildStakeIx } from "@/lib/staking";
import { GUARDIAN_POOL, SKR_MINT, STAKE_VAULT } from "@/lib/constants";

// Each test its own wallet: the build's rate limit (6 a minute per wallet) is module state.
const USERS = [
  "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e", "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH", "DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr",
  "4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw", "8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8", "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
  "GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7", "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
] as const;
let n = 0;
let U: Address;
let repo: MemoryRepo;
const OTHER = address("4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1");
const AMOUNT = 100_000_000n; // 100 SKR
const MINTED = (AMOUNT * 1_000_000_000n) / SP; // the shares the program mints for it at SP

const auth = async () => ({ authorization: `Bearer ${await issueSession(U, "M")}` });
const post = async (fn: typeof build, body: unknown) => fn(new Request("http://x", { method: "POST", headers: await auth(), body: JSON.stringify(body) }));
const get = async (fn: typeof me) => fn(new Request("http://x", { headers: await auth() }));
const decode = (b64: string) => getTransactionDecoder().decode(getBase64Encoder().encode(b64));
/** The wallet's signature, faked (the API never checks it; the chain does): 64 non-zero bytes in the user's slot. */
const signed = (b64: string, who: Address = U) => {
  const t = decode(b64);
  const tx: Transaction = { ...t, signatures: { ...t.signatures, [who]: new Uint8Array(64).fill(7) } as Transaction["signatures"] };
  return getBase64Decoder().decode(getTransactionEncoder().encode(tx));
};
const programsOf = (b64: string) => {
  const m = getCompiledTransactionMessageDecoder().decode(decode(b64).messageBytes) as unknown as { staticAccounts: string[]; instructions: { programAddressIndex: number }[] };
  return m.instructions.map((ix) => m.staticAccounts[ix.programAddressIndex]);
};
const noop = (a: Address) => createNoopSigner(a);
const retarget = (ix: Instruction, k: number, to: Address): Instruction => ({ ...ix, accounts: ix.accounts!.map((a, i) => (i === k ? { ...a, address: to } : a)) });
/** A posted transaction built from `ixs` (as the build route compiles it), signed. */
const postedOf = async (ixs: Instruction[]) => signed(await buildUserTransaction(U, ixs));

beforeEach(async () => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  delete process.env.STAKE_PLANT_OFF;
  U = address(USERS[n++ % USERS.length]);
  repo = new MemoryRepo();
  setRepoForTests(repo);
  await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  await repo.setJoinedPosition(U, { shares: JOINED, sharePrice: SP });
  Object.assign(chain, { walletSkr: 500_000_000n, shares: JOINED, sent: 0, status: "confirmed", blockhashValid: true, statuses: 0 });
  simulateMock.mockClear();
});
afterEach(() => { delete process.env.STAKE_PLANT_OFF; });

describe("(a) only the capped compute budget and the one stake: the server's build and check, and the phone's", () => {
  it("build answers a simulated v0 tx the wallet pays and alone signs: compute budget, then ONE stake of exactly the amount; the phone accepts it", async () => {
    const res = await post(build, { amountRaw: AMOUNT.toString() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amountRaw).toBe("100000000");
    expect(programsOf(body.transaction)).toEqual(["ComputeBudget111111111111111111111111111111", "ComputeBudget111111111111111111111111111111", "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ"]);
    const m = getCompiledTransactionMessageDecoder().decode(decode(body.transaction).messageBytes);
    expect(m.staticAccounts[0]).toBe(U);
    expect(m.header.numSignerAccounts).toBe(1);
    expect(simulateMock).toHaveBeenCalledTimes(1);
    // The phone's own check (app sign.ts 'stake'): accepted for the amount shown, refused for any other.
    await expect(checkBeforeSigning(decode(body.transaction), { kind: "stake", user: U, amountRaw: "100000000" })).resolves.toBeUndefined();
    await expect(checkBeforeSigning(decode(body.transaction), { kind: "stake", user: U, amountRaw: "100000001" })).rejects.toBeInstanceOf(SignRefused);
    await expect(checkBeforeSigning(decode(body.transaction), { kind: "stake", user: OTHER, amountRaw: "100000000" })).rejects.toBeInstanceOf(SignRefused);
  });

  it("server check refuses an extra instruction, a wrong account, a wrong amount, an uncapped priority fee and a second signer", async () => {
    const acc = { user: U as string, ...(await plantSkrAccounts(U)) };
    const ixs = await plantSkrIxs(U, AMOUNT);
    expect(checkPlantSkr(ixs.map(toTopUpIx), { ...acc, amountRaw: AMOUNT }).amountRaw).toBe(AMOUNT);
    const [limit, price, stake] = ixs;
    const transfer = getTransferInstruction({ source: address(acc.ata), destination: address(acc.ata), authority: noop(U), amount: 1n }) as Instruction;
    const refusals: Instruction[][] = [
      [limit, price, stake, transfer],   // an extra instruction after the stake
      [limit, price, transfer, stake],   // before it
      [limit, price, stake, stake],   // two stakes
      [limit, price, retarget(stake, 6, OTHER)],   // another vault
      [limit, price, retarget(stake, 5, OTHER)],   // SKR out of another account
      [limit, price, retarget(stake, 0, OTHER)],   // another position
      [limit, price, retarget(stake, 2, OTHER)],   // another guardian pool
      [limit, price, retarget(stake, 4, OTHER)],   // another beneficiary
      [getSetComputeUnitLimitInstruction({ units: 1_400_000 }) as Instruction, getSetComputeUnitPriceInstruction({ microLamports: 1_000_000n }) as Instruction, stake],   // 1.4 SOL priority
      [limit, limit, stake],   // a second limit
      [limit, price],   // no stake
    ];
    for (const r of refusals) expect(() => checkPlantSkr(r.map(toTopUpIx), acc)).toThrow(/refused/);
    expect(() => checkPlantSkr(ixs.map(toTopUpIx), { ...acc, amountRaw: AMOUNT + 1n })).toThrow(/not the amount asked/);
    // payer = someone else: the stake is no longer this wallet's own (and the other key would sign)
    const theirs = await buildStakeIx({ payer: noop(OTHER), user: U, amountRaw: AMOUNT });
    expect(() => checkPlantSkr([limit, price, theirs].map(toTopUpIx), acc)).toThrow(/refused/);
    // The vault, pool and mint are the program's real ones (not any address the builder picked).
    expect(toTopUpIx(stake).accounts.slice(1, 8)).toEqual(["4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw", GUARDIAN_POOL, U, U, acc.ata, STAKE_VAULT, SKR_MINT]);
  });

  it("the phone refuses the same tampering (sign.ts 'stake'), each before the wallet is asked", async () => {
    const ixs = await plantSkrIxs(U, AMOUNT);
    const [limit, price, stake] = ixs;
    const acc = await plantSkrAccounts(U);
    const transfer = getTransferInstruction({ source: address(acc.ata), destination: address(acc.ata), authority: noop(U), amount: 1n }) as Instruction;
    const flow = { kind: "stake" as const, user: U, amountRaw: AMOUNT.toString() };
    for (const r of [
      [limit, price, stake, transfer], [limit, price, retarget(stake, 6, OTHER)], [limit, price, retarget(stake, 5, OTHER)],
      [getSetComputeUnitLimitInstruction({ units: 1_400_000 }) as Instruction, getSetComputeUnitPriceInstruction({ microLamports: 1_000_000n }) as Instruction, stake],
      [limit, price],
    ]) await expect(checkBeforeSigning(decode(await buildUserTransaction(U, r)), flow)).rejects.toBeInstanceOf(SignRefused);
  });

  it("confirm refuses a posted stake that is not the build's shape, and sends nothing", async () => {
    const ixs = await plantSkrIxs(U, AMOUNT);
    const res = await post(confirm, { signedTransaction: await postedOf([ixs[0], ixs[1], retarget(ixs[2], 6, OTHER)]) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This is not a Sprouts SKR planting, so nothing was sent.");
    expect(chain.sent).toBe(0);
    // A lookup-free, user-paid transaction with another wallet as fee payer is refused too.
    const theirs = signed(await buildUserTransaction(OTHER, ixs), OTHER);
    expect((await post(confirm, { signedTransaction: theirs })).status).toBe(400);
    expect(chain.sent).toBe(0);
  });

  it("build refuses (never clamps) an amount above the balance read fresh: 409; under 1 SKR or not digits: 400; a failed simulation: 400", async () => {
    chain.walletSkr = AMOUNT - 1n;
    const stale = await post(build, { amountRaw: AMOUNT.toString() });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("Your SKR balance changed. Nothing was asked of your wallet. Pick an amount again.");
    expect((await post(build, { amountRaw: "999999" })).status).toBe(400);
    expect((await post(build, { amountRaw: "-5" })).status).toBe(400);
    chain.walletSkr = AMOUNT;
    simulateMock.mockResolvedValueOnce({ value: { err: "InsufficientFundsForFee", logs: [] } });
    expect((await post(build, { amountRaw: AMOUNT.toString() })).status).toBe(400);
  });

  it("build is rate limited per wallet (Kimi #7): the 7th build in a minute is 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post(build, { amountRaw: AMOUNT.toString() })).status);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes[6]).toBe(429);
  });
});

describe("(b) STAKE_PLANT_OFF=1 (Kimi #3)", () => {
  it("/api/me idleSkr is null, build is 503, confirm is 503 and sends nothing", async () => {
    expect((await (await get(me)).json()).idleSkr).toEqual({ raw: "500000000", usdCents: 1000 });
    const ixs = await plantSkrIxs(U, AMOUNT);
    const posted = await postedOf(ixs);
    process.env.STAKE_PLANT_OFF = "1";
    expect((await (await get(me)).json()).idleSkr).toBeNull();
    expect((await post(build, { amountRaw: AMOUNT.toString() })).status).toBe(503);
    const c = await post(confirm, { signedTransaction: posted });
    expect(c.status).toBe(503);
    expect(chain.sent).toBe(0);
    expect(await repo.listEvents(U, ["skr_plant_sent", "skr_planted"], 10)).toHaveLength(0);
  });

  it("idleSkr: null under $5, null on a failed read, the floored cents from $5", async () => {
    chain.walletSkr = 249_000_000n; // $4.98 at $0.02
    expect((await (await get(me)).json()).idleSkr).toBeNull();
    chain.walletSkr = "down";
    const res = await get(me);
    expect(res.status).toBe(200);
    expect((await res.json()).idleSkr).toBeNull();
    expect(idleSkrFrom(250_000_000n, 0.02)).toEqual({ raw: "250000000", usdCents: 500 });
    expect(idleSkrFrom(250_000_000n, null)).toBeNull();
  });
});

describe("(c) the confirm books the put in once; the next reconcile adds nothing; one Activity row", () => {
  const reconcileChain = () => ({ readPosition: async () => ({ shares: chain.shares, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null }), sharePrice: async () => SP, finalized: async () => true });

  it("confirmed: one own_stake adjustment as reconcile books it, one skr_planted row; reconcile next day books nothing more; Activity shows one row", async () => {
    const posted = await postedOf(await plantSkrIxs(U, AMOUNT));
    chain.shares = JOINED + MINTED; // the chain shows the stake
    const res = await post(confirm, { signedTransaction: posted });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "confirmed", amountRaw: "100000000" });
    expect(chain.sent).toBe(1);
    const adj = await repo.listStakeAdjustments(U);
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ kind: "own_stake", sharesDelta: MINTED, amountRaw: (MINTED * SP) / 1_000_000_000n, sharePrice: SP });
    const out = await reconcileOwnStakes({ repo, chain: reconcileChain(), now: new Date(Date.now() + 3_600_000) });
    expect(out.adjusted).not.toContain(U);
    expect(await repo.listStakeAdjustments(U)).toHaveLength(1);
    const a = await (await get(activity)).json();
    expect(a.skrPlants).toHaveLength(1);
    expect(a.skrPlants[0]).toMatchObject({ amountRaw: "100000000" });
  });

  it("a retried confirm of the same signed transaction: 200 again, nothing sent, no second row or adjustment (Kimi #5)", async () => {
    const posted = await postedOf(await plantSkrIxs(U, AMOUNT));
    chain.shares = JOINED + MINTED;
    expect((await post(confirm, { signedTransaction: posted })).status).toBe(200);
    const again = await post(confirm, { signedTransaction: posted });
    expect(again.status).toBe(200);
    expect((await again.json()).status).toBe("confirmed");
    expect(chain.sent).toBe(1);
    expect(await repo.listStakeAdjustments(U)).toHaveLength(1);
    expect((await repo.listEvents(U, ["skr_planted"], 10))).toHaveLength(1);
    expect((await repo.listEvents(U, ["skr_plant_sent"], 10))).toHaveLength(1);
  });

  it("two racing confirms that both wrote a row: neither books (reconcile does, once); Activity still shows one row", async () => {
    const posted = await postedOf(await plantSkrIxs(U, AMOUNT));
    chain.shares = JOINED + MINTED;
    const write = repo.addEvent.bind(repo);
    // the racer's row lands right beside ours
    repo.addEvent = async (e) => { await write(e); if (e.kind === "skr_planted") await write(e); };
    expect((await post(confirm, { signedTransaction: posted })).status).toBe(200);
    expect(await repo.listStakeAdjustments(U)).toHaveLength(0);
    await reconcileOwnStakes({ repo, chain: reconcileChain(), now: new Date(Date.now() + 3_600_000) });
    expect(await repo.listStakeAdjustments(U)).toHaveLength(1);
    expect((await (await get(activity)).json()).skrPlants).toHaveLength(1);
  });

  it("on any doubt the confirm books nothing and reconcile books it, once: a delta that is not this stake", async () => {
    const posted = await postedOf(await plantSkrIxs(U, AMOUNT));
    chain.shares = JOINED + 3n * MINTED; // another wallet stake not booked yet: not this stake's shares
    expect((await post(confirm, { signedTransaction: posted })).status).toBe(200);
    expect(await repo.listStakeAdjustments(U)).toHaveLength(0);
    expect(await repo.listEvents(U, ["skr_planted"], 10)).toHaveLength(1); // the Activity row is still written
    await reconcileOwnStakes({ repo, chain: reconcileChain(), now: new Date(Date.now() + 3_600_000) });
    const adj = await repo.listStakeAdjustments(U);
    expect(adj).toHaveLength(1);
    expect(adj[0].sharesDelta).toBe(3n * MINTED);
  });

  it("a read that does not show the stake yet books nothing (reconcile is the fallback)", async () => {
    const posted = await postedOf(await plantSkrIxs(U, AMOUNT));
    chain.shares = JOINED;
    expect((await post(confirm, { signedTransaction: posted })).status).toBe(200);
    expect(await repo.listStakeAdjustments(U)).toHaveLength(0);
  });

  it("a failure on chain is 400 and writes no row", async () => {
    chain.status = "failed";
    const failed = await post(confirm, { signedTransaction: await postedOf(await plantSkrIxs(U, AMOUNT)) });
    expect(failed.status).toBe(400);
    expect((await failed.json()).error).toBe("The planting failed on chain. Your SKR stayed in your wallet.");
    expect(await repo.listEvents(U, ["skr_planted"], 10)).toHaveLength(0);
    expect((await (await get(activity)).json()).skrPlants).toHaveLength(0); // its mark is asked on chain and stays failed
  });

  it("pending is 202, and a later landing gets its Activity row from the settle (Kimi #6)", async () => {
    chain.status = "pending";
    const p = await post(confirm, { signedTransaction: await postedOf(await plantSkrIxs(U, AMOUNT + 10_000n)) });
    expect(p.status).toBe(202);
    expect((await p.json()).message).toBe("Your SKR was sent but is not confirmed yet. Check Home in a minute before you try again.");
    expect((await (await get(activity)).json()).skrPlants).toHaveLength(0);
    chain.status = "confirmed";
    const a = await (await get(activity)).json();
    expect(a.skrPlants).toHaveLength(1);
    expect(a.skrPlants[0].amountRaw).toBe("100010000");
    // A second load: the same one row, not asked on chain again for it.
    chain.statuses = 0;
    expect((await (await get(activity)).json()).skrPlants).toHaveLength(1);
    expect(chain.statuses).toBe(0);
    expect(await repo.listStakeAdjustments(U)).toHaveLength(0); // its put in is left to the daily reconcile
  });

  it("the Activity row is never the reconcile's: a confirm-booked stake then reconcile is still exactly one row", async () => {
    chain.shares = JOINED + MINTED;
    await post(confirm, { signedTransaction: await postedOf(await plantSkrIxs(U, AMOUNT)) });
    await reconcileOwnStakes({ repo, chain: reconcileChain(), now: new Date(Date.now() + 3_600_000) });
    const a = await (await get(activity)).json();
    expect(a.skrPlants).toHaveLength(1);
    expect(a.topUps ?? []).toHaveLength(0);
    // the role of the payer in the stake is a writable signer; the user is read-only and never signs
    const stake = (await plantSkrIxs(U, AMOUNT))[2];
    expect(stake.accounts![3].role).toBe(AccountRole.WRITABLE_SIGNER);
    expect(stake.accounts![4].role).toBe(AccountRole.READONLY);
  });
});
