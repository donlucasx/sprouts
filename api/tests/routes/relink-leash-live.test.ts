import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from "vitest";
import { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder, signTransaction, getBase64EncodedWireTransaction, type KeyPairSigner, type Address } from "@solana/kit";
import { findSubscriptionAuthorityPda } from "@solana/subscriptions";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

/** relink.needed (/api/me) x LEASH_LIVE x plant-run's "relink needed" skip, across the real relink confirm (the joint the app depends on). */
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OLD = "ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD";
const { chain } = vi.hoisted(() => ({ chain: { landed: false, user: "", leash: "", authority: "" } }));
vi.mock("@/lib/staking", () => ({ readPosition: vi.fn(async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null })), sharePrice: vi.fn(async () => 1_146_000_000n) }));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 0n), storeRedeemRate: vi.fn(async () => 1_048_350_000n) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), readHoldings: vi.fn(async () => ({})), readLendingPositions: vi.fn(async () => []) }));
vi.mock("@/lib/leash", async (orig) => ({ ...(await orig<object>()), readLeashConfig: vi.fn(async () => { throw new Error("not deployed"); }) }));
vi.mock("@/lib/subscriptions", async (orig) => ({
  ...(await orig<object>()),
  readDelegation: vi.fn(async (pda: string) => (pda === OLD && chain.landed ? { exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n } : { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n })),
  readSubscriptionAuthority: vi.fn(async () => ({ exists: true, initId: 4n })),
  readUsdcAtaExists: vi.fn(async () => true),
  waitForDelegation: vi.fn(async () => ({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n, delegator: chain.user, delegatee: chain.leash, expiryTs: 0n, mint: USDC, subscriptionAuthority: chain.authority })),
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  simulateTransaction: () => ({ send: async () => ({ value: { err: null, logs: [] } }) }),
  sendTransaction: () => ({ send: async () => { chain.landed = true; return "sig"; } }),
}) }));

import { GET as me } from "@/app/api/me/route";
import { POST as build } from "@/app/api/relink/build/route";
import { POST as confirm } from "@/app/api/relink/confirm/route";
import { leashPda, type LeashConfig } from "@/lib/leash";
import { runPlanting, type Chain } from "@/lib/plant-run";

const NOW = new Date("2026-09-29T14:00:00Z");
let user: KeyPairSigner;
beforeAll(async () => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  user = await generateKeyPairSigner();
  chain.user = user.address;
  chain.leash = await leashPda(user.address, user.address);
  chain.authority = (await findSubscriptionAuthorityPda({ user: user.address, tokenMint: USDC as Address }))[0];
});
afterEach(() => { delete process.env.LEASH_LIVE; });

const DELEGATION = { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n };
const leashCfg = (): LeashConfig => ({ puller: "P" as never, pullerUsdc: "PU" as never, maxPullRaw: 5_000_000n, legs: [0, 1, 2, 3, 4, 5, 6, 7].map(() => ({ enabled: true, reader: 0, feeBps: 0, tolBps: 0, confCapBps: 0, maxAgeS: 60, receiptMint: null, rateAccount: null, extra: null, feedId: null, feedAccount: null })) });
const plantChain = (): Chain => ({
  readDelegation: async () => DELEGATION, usdcBalanceRaw: async () => 50_000_000n,
  buildPlantingTx: async (a) => ({ tx: {}, signature: "sig1", expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n, asset: a.asset, venue: a.venue, usdcFloat: "PU", wsolFloat: "PW", skrFloat: null, watched: ["PU", "PW"], pullerJl: null, jlLeftover: null, cleanup: [] }),
  simulatePlanting: async (b) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 1_000n, post: 1_000n + b.minOutRaw }, watched: Object.fromEntries((b.watched ?? []).map((x) => [x, { pre: 5_000n, post: 5_000n }])) }),
  sendPlanting: async () => {}, signatureStatus: async () => "pending", readShares: async () => 1_000_000_000n, sharePrice: async () => 1_146_000_000n,
  assetBalanceRaw: async () => 0n, pullerSkrChangeRaw: async () => 0n, readLeashConfig: async () => leashCfg(), lendingPositions: async () => [], pullerCarryChangeRaw: async () => 0n,
  cleanup: async () => {}, priceFresh: async () => {},
} as Chain);

describe("relink.needed x LEASH_LIVE x plant-run, across relink/confirm", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    chain.landed = false;
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: user.address, sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: user.address, userPubkey: user.address, delegationPda: OLD, dailyCapCents: 500 });
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `s${i}`, walletPubkey: user.address, ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
  });
  const auth = async () => ({ authorization: `Bearer ${await issueSession(user.address, "M")}` });
  const getMe = async () => (await me(new Request("http://x/api/me", { headers: await auth() }))).json();
  const call = async (fn: typeof build, body: unknown) => fn(new Request("http://x", { method: "POST", headers: await auth(), body: JSON.stringify(body) }));
  const relink = async () => {
    const built = await (await call(build, {})).json();
    const signed = await signTransaction([user.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction)));
    return call(confirm, { signedTransaction: getBase64EncodedWireTransaction(signed) });
  };

  it("LEASH_LIVE unset: not needed, and the puller wallet still plants", async () => {
    expect((await getMe()).relink).toEqual({ needed: false, wallets: [{ pubkey: user.address, via: "app" }] });
    const r = await runPlanting({ repo, now: NOW, chain: plantChain() });
    expect(r.skipped).toEqual([]);
    expect(r.planted.length).toBe(1);
  });
  it("LEASH_LIVE=1: needed, the wallet is skipped with 'relink needed'; after relink/confirm both flip", async () => {
    process.env.LEASH_LIVE = "1";
    expect((await getMe()).relink.needed).toBe(true);
    expect((await runPlanting({ repo, now: NOW, chain: plantChain() })).skipped).toEqual([{ wallet: user.address, reason: "relink needed" }]);
    expect((await relink()).status).toBe(200);
    expect((await repo.getWallet(user.address))!.linkModel).toBe("leash");
    expect((await getMe()).relink).toEqual({ needed: false, wallets: [] });
    const r = await runPlanting({ repo, now: NOW, chain: plantChain() });
    expect(r.skipped).toEqual([]);
    expect(r.planted.length).toBe(1);
  });
  it("LEASH_LIVE=1 and no wallet on the puller link: not needed", async () => {
    process.env.LEASH_LIVE = "1";
    await repo.setWalletLink(user.address, { delegationPda: "D", linkModel: "leash" });
    expect((await getMe()).relink.needed).toBe(false);
  });
});
