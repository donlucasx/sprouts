import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, signTransaction, getBase64EncodedWireTransaction, type KeyPairSigner } from "@solana/kit";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import type { MoveProposalRow, VenueDayRow } from "@/db/types";
import { issueSession } from "@/lib/session";
import { dayOf } from "@/domain/day";
import { KLEND_PROGRAM, JLEND_PROGRAM } from "@/lib/constants";
import { checkBeforeSigning } from "../fixtures/app/sign";

let receipt = 1_661_072n;
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }) }) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), receiptBalanceRaw: vi.fn(async () => receipt) }));
vi.mock("@/lib/venues/klend", async (orig) => ({ ...(await orig<object>()), klendRate: vi.fn(async () => ({ rn: 12_050n, rd: 10_000n, availableRaw: 10n ** 12n })) }));
vi.mock("@/lib/venues/jlend", async (orig) => ({ ...(await orig<object>()), jlendRate: vi.fn(async () => ({ rn: 11n, rd: 10n })) }));
vi.mock("@/lib/venues/rates", () => ({ jupiterWithdrawableRaw: vi.fn(async () => 10n ** 12n) }));
vi.mock("@/lib/user-tx", async (orig) => ({ ...(await orig<object>()), sendPosted: vi.fn(async () => {}), waitConfirmed: vi.fn(async () => "confirmed"), settleUnconfirmed: vi.fn(async () => "expired") }));

import { sendPosted, waitConfirmed, settleUnconfirmed, buildUserTransaction } from "@/lib/user-tx";
import { proposeMoves, moveCarriesFor } from "@/lib/moves";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { WSOL_MINT } from "@/lib/constants";
import { buildMove } from "@/lib/venues/user-builders";
import { lendingFrom, latestVenueRows } from "@/lib/holdings";
import { GET as list } from "@/app/api/moves/route";
import { POST as build } from "@/app/api/moves/build/route";
import { POST as confirm } from "@/app/api/moves/confirm/route";
import { POST as dismiss } from "@/app/api/moves/dismiss/route";

let user: KeyPairSigner;
beforeAll(async () => { process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret"; user = await generateKeyPairSigner(); });

const vrow = (venue: "kamino_klend" | "jupiter_lend", asset: "USDC_LEND" | "SOL_LEND", exchangeRate: number): VenueDayRow => ({ day: dayOf(new Date()), venue, asset, supplyPct: 4, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e9, tvlUsd: 1e9, exchangeRate, avg7Pct: 4, daysMeasured: 7, eligible: true, verdict: null, reason: null, served: null, ok: true });

describe("Moves (spec 7, contracts 5.4 with S3 = ONE: [redeem, deposit] in one session)", () => {
  let repo: MemoryRepo;
  let p: MoveProposalRow;
  const propose = async (asset: "USDC_LEND" | "SOL_LEND" = "USDC_LEND") =>
    (await repo.insertMoveProposal({ userPubkey: user.address, asset, fromVenue: "jupiter_lend", toVenue: "kamino_klend", receiptRaw: 1_661_072n, valueUsd: 5000, fromAvg7Pct: 4.19, toAvg7Pct: 4.43, gain30dUsd: 0.98, costUsd: 0.25 }))!;
  beforeEach(async () => {
    repo = new MemoryRepo(); setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: user.address, sgtMint: "M", skrName: null });
    for (const asset of ["USDC_LEND", "SOL_LEND"] as const) { await repo.putVenueDay(vrow("jupiter_lend", asset, 1.1)); await repo.putVenueDay(vrow("kamino_klend", asset, 1.205)); }
    receipt = 1_661_072n;
    vi.mocked(sendPosted).mockReset().mockResolvedValue(undefined); vi.mocked(waitConfirmed).mockReset().mockResolvedValue("confirmed"); vi.mocked(settleUnconfirmed).mockReset().mockResolvedValue("expired");
    p = await propose();
  });
  const auth = async () => ({ authorization: `Bearer ${await issueSession(user.address, "M")}` });
  const call = async (fn: (r: Request) => Promise<Response>, body: unknown) => fn(new Request("http://x", { method: "POST", headers: await auth(), body: JSON.stringify(body) }));
  const sign = async (b64: string) => getBase64EncodedWireTransaction(await signTransaction([user.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(b64))));
  const msgOf = (b64: string) => getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(getBase64Encoder().encode(b64)).messageBytes) as unknown as { staticAccounts: string[]; instructions: { programAddressIndex: number }[]; addressTableLookups?: unknown[]; version: number | string };
  const programs = (b64: string) => { const m = msgOf(b64); return m.instructions.map((ix) => m.staticAccounts[ix.programAddressIndex]); };

  it("GET /api/moves: the open card as contracts 5.4, or null", async () => {
    const body = await (await list(new Request("http://x/api/moves", { headers: await auth() }))).json();
    expect(body.proposal).toMatchObject({ id: p.id, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "1661072", valueUsd: 5000, fromAvg7Pct: 4.19, toAvg7Pct: 4.43, gain30dUsd: 0.98, costUsd: 0.25 });
    expect(Object.keys(body.proposal).sort()).toEqual(["asset", "costUsd", "from", "fromAvg7Pct", "gain30dUsd", "id", "inFlight", "receiptRaw", "to", "toAvg7Pct", "ts", "valueUsd"].sort());
    expect(body.proposal.inFlight).toBe(false);
    await repo.storeMoveSignatures(p.id, { redeem: "R", deposit: "D" });
    expect((await (await list(new Request("http://x/api/moves", { headers: await auth() }))).json()).proposal).toMatchObject({ id: p.id, inFlight: true });
    await repo.transitionMoveProposal(p.id, "open", "expired");
    expect(await (await list(new Request("http://x/api/moves", { headers: await auth() }))).json()).toEqual({ proposal: null });
  });

  it("dismiss: status dismissed, the move_dismissed event { id, asset, from, to, receiptRaw, status }; twice is a 409; someone else's card is a 404", async () => {
    const res = await call(dismiss, { id: p.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dismissed: true });
    expect((await repo.getMoveProposal(p.id))?.status).toBe("dismissed");
    expect(repo.events.find((e) => e.kind === "move_dismissed")?.detail).toEqual({ id: p.id, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "1661072", status: "dismissed" });
    expect((await call(dismiss, { id: p.id })).status).toBe(409);
    await repo.upsertUser({ seedVaultPubkey: "OTHER", sgtMint: "M2", skrName: null });
    const theirs = (await repo.insertMoveProposal({ userPubkey: "OTHER", asset: "USDC_LEND", fromVenue: "jupiter_lend", toVenue: "kamino_klend", receiptRaw: 1n, valueUsd: 5000, fromAvg7Pct: 4, toAvg7Pct: 5, gain30dUsd: 1, costUsd: 0.25 }))!;
    expect((await call(dismiss, { id: theirs.id })).status).toBe(404);
    expect((await call(build, { id: theirs.id })).status).toBe(404);
  });

  it("build: two v0 txs, redeem then deposit, the user paying, no lookup table; depositRaw = 99.9% of the expected out", async () => {
    const res = await call(build, { id: p.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(2);
    for (const t of body.transactions) {
      const m = msgOf(t);
      expect(m.version).toBe(0);
      expect(m.staticAccounts[0]).toBe(user.address);
      expect(m.addressTableLookups?.length ?? 0).toBe(0);
    }
    expect(programs(body.transactions[0])).toContain(JLEND_PROGRAM);
    expect(programs(body.transactions[0])).not.toContain(KLEND_PROGRAM);
    expect(programs(body.transactions[1])).toContain(KLEND_PROGRAM);
    expect(programs(body.transactions[1])).not.toContain(JLEND_PROGRAM);
    // expected = 1_661_072 x 11 / 10 = 1_827_179; x 9990 / 10000 = 1_825_351; served = floor(1_661_072 x 1.1) = 1_827_179
    expect(body).toMatchObject({ receiptRaw: "1661072", depositRaw: "1825351", brief: "Moves your USDC from Jupiter to Kamino: about 1.83 USDC out, 1.83 USDC in." });
  });

  it("build: depositRaw is capped by the underlyingRaw /api/me serves for the source position (interest accrued since the snapshot); the app's sign.ts accepts both txs with that cap", async () => {
    await repo.putVenueDay(vrow("jupiter_lend", "USDC_LEND", 1.098));   // the snapshot lags the live 1.1
    const served = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: receipt }], legs: [], rows: await latestVenueRows(repo, dayOf(new Date())), prices: {} })[0].underlyingRaw;
    expect(served).toBe(1_823_857n);
    const body = await (await call(build, { id: p.id })).json();
    expect(body.depositRaw).toBe("1823857");   // under 1_825_351 (99.9% of the live redeem): the rest stays in the wallet
    for (const [i, part] of (["redeem", "deposit"] as const).entries()) {
      const tx = getTransactionDecoder().decode(getBase64Encoder().encode(body.transactions[i]));
      await expect(checkBeforeSigning(tx, { kind: "move_jlend_to_klend", user: user.address, asset: "USDC_LEND", receiptRaw: body.receiptRaw, depositRaw: body.depositRaw, depositCapRaw: served.toString(), part })).resolves.toBeUndefined();
    }
  });

  it("build: the redeem never exceeds the card's position, nor the wallet's receipt balance", async () => {
    receipt = 1_000_000n;
    expect((await (await call(build, { id: p.id })).json()).receiptRaw).toBe("1000000");
    receipt = 0n;
    expect((await call(build, { id: p.id })).status).toBe(409);
  });

  it("confirm: both land; done with both signatures; the move_done event { id, asset, from, to, receiptRaw, status }", async () => {
    const built = await (await call(build, { id: p.id })).json();
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(200);
    const { move } = await res.json();
    expect(move).toMatchObject({ id: p.id, status: "done" });
    expect(typeof move.redeemSignature).toBe("string");
    expect(typeof move.depositSignature).toBe("string");
    expect(vi.mocked(sendPosted)).toHaveBeenCalledTimes(2);
    expect(await repo.getMoveProposal(p.id)).toMatchObject({ status: "done", redeemSignature: move.redeemSignature, depositSignature: move.depositSignature });
    expect(repo.events.find((e) => e.kind === "move_done")?.detail).toEqual({ id: p.id, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "1661072", status: "done" });
    // a replayed confirm answers the record, sends nothing
    vi.mocked(sendPosted).mockClear();
    expect((await (await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) })).json()).move).toEqual(move);
    expect(vi.mocked(sendPosted)).not.toHaveBeenCalled();
  });

  it("confirm rebuilds the deposit with the server's own depositRaw: a signed deposit for more USDC is refused, nothing sent", async () => {
    const built = await (await call(build, { id: p.id })).json();
    const owner = user.address;
    const bigger = await buildUserTransaction(owner, await buildMove({ user: owner, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: 1_661_072n, depositRaw: 1_825_352n, part: "deposit" }));
    const res = await call(confirm, { id: p.id, signedTransactions: [await sign(built.transactions[0]), await sign(bigger)] });
    expect(res.status).toBe(400);
    expect(vi.mocked(sendPosted)).not.toHaveBeenCalled();
    // and a redeem for more receipt than built
    const moreRedeem = await buildUserTransaction(owner, await buildMove({ user: owner, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: 1_661_073n, depositRaw: 1_825_351n, part: "redeem" }));
    expect((await call(confirm, { id: p.id, signedTransactions: [await sign(moreRedeem), await sign(built.transactions[1])] })).status).toBe(400);
    // swapped order
    expect((await call(confirm, { id: p.id, signedTransactions: [await sign(built.transactions[1]), await sign(built.transactions[0])] })).status).toBe(400);
    expect(vi.mocked(sendPosted)).not.toHaveBeenCalled();
    expect((await repo.getMoveProposal(p.id))?.status).toBe("open");
  });

  it("confirm before any build is a 409", async () => {
    const owner = user.address;
    const r = await buildUserTransaction(owner, await buildMove({ user: owner, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: 1_661_072n, depositRaw: 1_825_351n, part: "redeem" }));
    const d = await buildUserTransaction(owner, await buildMove({ user: owner, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: 1_661_072n, depositRaw: 1_825_351n, part: "deposit" }));
    expect((await call(confirm, { id: p.id, signedTransactions: [await sign(r), await sign(d)] })).status).toBe(409);
  });

  it("the redeem fails: nothing moved, the deposit is never sent, the card stays open and is no longer in flight", async () => {
    const built = await (await call(build, { id: p.id })).json();
    vi.mocked(waitConfirmed).mockResolvedValue("failed");
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(409);
    expect((await res.json()).partial).toBeUndefined();
    expect(vi.mocked(sendPosted)).toHaveBeenCalledTimes(1);
    expect(await repo.getMoveProposal(p.id)).toMatchObject({ status: "open", redeemSignature: null, depositSignature: null });
    expect((await call(dismiss, { id: p.id })).status).toBe(200);   // an ordinary open card again
  });

  it("both signatures are stored BEFORE the redeem is sent (C-I2 1, ledger T20 minor 3)", async () => {
    const built = await (await call(build, { id: p.id })).json();
    const atSend: (string | null)[][] = [];
    vi.mocked(sendPosted).mockImplementation(async () => { const c = (await repo.getMoveProposal(p.id))!; atSend.push([c.redeemSignature, c.depositSignature]); });
    const { move } = await (await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) })).json();
    expect(atSend[0]).toEqual([move.redeemSignature, move.depositSignature]);
  });

  /** A confirm whose redeem is still pending when the function answers: the card is in flight, both signatures stored. */
  const inFlight = async () => {
    const built = await (await call(build, { id: p.id })).json();
    const signed = await Promise.all(built.transactions.map(sign));
    vi.mocked(waitConfirmed).mockResolvedValue("pending");
    vi.mocked(settleUnconfirmed).mockResolvedValue("pending");
    const res = await call(confirm, { id: p.id, signedTransactions: signed });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: MAY_STILL });
    vi.mocked(sendPosted).mockClear();
    return { built, signed, card: (await repo.getMoveProposal(p.id))! };
  };

  it("in flight: Not now is refused (409 inFlight), the card stays open with its signatures (K-I1)", async () => {
    const { card } = await inFlight();
    expect(card.redeemSignature).toEqual(expect.any(String));
    const res = await call(dismiss, { id: p.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This move is on its way. Check Home in a minute.", inFlight: true });
    expect(await repo.getMoveProposal(p.id)).toMatchObject({ status: "open", redeemSignature: card.redeemSignature, depositSignature: card.depositSignature });
    expect(repo.events.some((e) => e.kind === "move_dismissed")).toBe(false);
  });

  it("in flight: no rebuild with new amounts (K-I2): build answers 409 inFlight and records no move_built", async () => {
    await inFlight();
    const before = repo.events.filter((e) => e.kind === "move_built").length;
    receipt = 1_000_000n;
    const res = await call(build, { id: p.id });
    expect(res.status).toBe(409);
    expect((await res.json()).inFlight).toBe(true);
    expect(repo.events.filter((e) => e.kind === "move_built").length).toBe(before);
  });

  it("in flight: a different signed pair is refused before anything is sent, and the stored signatures are never overwritten (ledger T20 minor 2)", async () => {
    const { card } = await inFlight();
    vi.mocked(waitConfirmed).mockResolvedValue("confirmed");
    // A fresh build is refused while in flight, so the other pair is made by hand (a deposit one unit smaller: other signatures).
    const owner = user.address;
    const other = await Promise.all((["redeem", "deposit"] as const).map(async (part) => sign(await buildUserTransaction(owner, await buildMove({ user: owner, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: 1_661_072n, depositRaw: 1_825_350n, part })))));
    const res = await call(confirm, { id: p.id, signedTransactions: other });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: MAY_STILL });
    expect(vi.mocked(sendPosted)).not.toHaveBeenCalled();
    expect(await repo.getMoveProposal(p.id)).toMatchObject({ status: "open", redeemSignature: card.redeemSignature, depositSignature: card.depositSignature });
  });

  it("in flight: the SAME pair again (a retry after a lost answer) goes on and finishes the move", async () => {
    const { signed, card } = await inFlight();
    vi.mocked(waitConfirmed).mockResolvedValue("confirmed");
    const res = await call(confirm, { id: p.id, signedTransactions: signed });
    expect(res.status).toBe(200);
    expect((await res.json()).move).toEqual({ id: p.id, status: "done", redeemSignature: card.redeemSignature, depositSignature: card.depositSignature });
    expect(repo.events.filter((e) => e.kind === "move_done")).toHaveLength(1);
  });

  it("the cron settles the move while the confirm polls the deposit: the confirm answers from the winner's state, never a 500 (C-I2 c)", async () => {
    const built = await (await call(build, { id: p.id })).json();
    let sends = 0;
    vi.mocked(sendPosted).mockImplementation(async () => {
      // The deposit goes out; meanwhile the cron's settle finds it confirmed and wins the compare-and-set.
      if (++sends === 2) await proposeMoves({ repo, now: new Date(), positions: async () => [], solUsd: 120, txStatus: async () => "confirmed" });
    });
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(200);
    expect((await res.json()).move).toMatchObject({ id: p.id, status: "done" });
    expect(repo.events.filter((e) => e.kind === "move_done")).toHaveLength(1);
  });

  it("the cron fails the move while the confirm sees the deposit fail: one move_failed, the partial answer, never a 500", async () => {
    const built = await (await call(build, { id: p.id })).json();
    let sends = 0;
    vi.mocked(sendPosted).mockImplementation(async () => {
      if (++sends === 2) await proposeMoves({ repo, now: new Date(), positions: async () => [], solUsd: 120, txStatus: async (sig) => ((await repo.getMoveProposal(p.id))!.redeemSignature === sig ? "confirmed" : "failed") });
    });
    vi.mocked(waitConfirmed).mockResolvedValueOnce("confirmed").mockResolvedValue("failed");
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(409);
    expect((await res.json()).partial).toBe(true);
    expect(repo.events.filter((e) => e.kind === "move_failed")).toHaveLength(1);
  });

  it("a build that slipped in after the signatures were stored never changes the carry: the confirm pinned its own build", async () => {
    const first = await (await call(build, { id: p.id })).json();
    vi.mocked(waitConfirmed).mockResolvedValueOnce("confirmed").mockResolvedValue("pending");
    vi.mocked(settleUnconfirmed).mockResolvedValue("pending");
    expect((await call(confirm, { id: p.id, signedTransactions: await Promise.all(first.transactions.map(sign)) })).status).toBe(409);
    // A build that passed its in-flight check just before the signatures were stored writes its (different) amounts afterwards.
    await repo.addEvent({ userPubkey: user.address, walletPubkey: null, kind: "move_built", detail: { id: p.id, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "1000000", sourceReceiptRaw: "1000000", depositRaw: "1098900", toReceiptRaw: "911950", fromRate: 1.1, toRate: 1.205 } });
    const card = (await repo.getMoveProposal(p.id))!;
    await proposeMoves({ repo, now: new Date(), positions: async () => [], solUsd: 120, txStatus: async () => "confirmed" });
    expect(card.depositSignature).toEqual(expect.any(String));
    expect((await repo.getMoveProposal(p.id))?.status).toBe("done");
    expect((await moveCarriesFor(repo, user.address)).map((c) => c.depositRaw.toString())).toEqual([first.depositRaw]);
  });

  it("the redeem lands and the deposit fails: 409 partial in the USDC wording; status failed", async () => {
    const built = await (await call(build, { id: p.id })).json();
    vi.mocked(waitConfirmed).mockResolvedValueOnce("confirmed").mockResolvedValue("failed");
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Your USDC is back in your wallet; the move did not finish.", partial: true });
    expect(await repo.getMoveProposal(p.id)).toMatchObject({ status: "failed" });
    // C-I2 5: Activity says the money came back to the wallet
    expect(repo.events.filter((e) => e.kind === "move_failed").map((e) => e.detail)).toEqual([{ id: p.id, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "1661072", status: "failed" }]);
  });

  it("SOL: the partial 409 names SOL and hands back an unwrap tx for the WSOL the redeem left (no stranded WSOL)", async () => {
    await repo.transitionMoveProposal(p.id, "open", "dismissed");
    const sol = await propose("SOL_LEND");
    const built = await (await call(build, { id: sol.id })).json();
    expect(built.brief).toMatch(/^Moves your SOL from Jupiter to Kamino: about \d+\.\d{4} SOL out, \d+\.\d{4} SOL in\.$/);
    vi.mocked(waitConfirmed).mockResolvedValueOnce("confirmed").mockResolvedValue("failed");
    const res = await call(confirm, { id: sol.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Your SOL is back in your wallet; the move did not finish.", partial: true });
    // the unwrap: one Token CloseAccount of the user's WSOL account back to the user, the user paying
    const m = msgOf(body.unwrapTransaction);
    expect(m.staticAccounts[0]).toBe(user.address);
    expect(programs(body.unwrapTransaction)).toEqual(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"]);
    // CloseAccount (tag 9) of the user's WSOL ATA, destination = owner = the user (review minor 5)
    const [wsol] = await findAssociatedTokenPda({ owner: user.address, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const ix = (m as unknown as { instructions: { accountIndices: number[]; data: Uint8Array }[] }).instructions[0];
    expect([...ix.data]).toEqual([9]);
    expect(ix.accountIndices.map((i) => m.staticAccounts[i])).toEqual([wsol, user.address, user.address]);
  });

  const MAY_STILL = "It may still go through. Check Home in a minute before you try again.";
  it("the deposit is still pending after the poll: 409 'may still', both signatures stored before the deposit send; the cron then settles it done with the carry intact", async () => {
    const built = await (await call(build, { id: p.id })).json();
    vi.mocked(waitConfirmed).mockResolvedValueOnce("confirmed").mockResolvedValue("pending");
    vi.mocked(settleUnconfirmed).mockResolvedValue("pending");
    let storedAtDepositSend: unknown = null;
    vi.mocked(sendPosted).mockImplementation(async () => { storedAtDepositSend = (await repo.getMoveProposal(p.id))?.depositSignature ?? null; });
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: MAY_STILL });
    const card = (await repo.getMoveProposal(p.id))!;
    expect(card).toMatchObject({ status: "open" });
    expect(typeof card.redeemSignature).toBe("string");
    expect(storedAtDepositSend).toBe(card.depositSignature);   // stored before the deposit went out
    // each poll is 12 tries (18 s): both inside the 60 s function limit
    expect(vi.mocked(waitConfirmed).mock.calls.every((c) => c[1] === 12)).toBe(true);
    // the cron: the money is at the target now; the deposit's signature landed
    await proposeMoves({ repo, now: new Date(), positions: async () => [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_514_000n }], solUsd: 120, txStatus: async (sig) => (sig === card.depositSignature ? "confirmed" : "pending") });
    expect((await repo.getMoveProposal(p.id))?.status).toBe("done");
    expect(repo.events.find((e) => e.kind === "move_done")?.detail).toMatchObject({ id: p.id, status: "done" });
    expect((await moveCarriesFor(repo, user.address)).map((c) => c.depositRaw)).toEqual([1_825_351n]);
  });

  it("the deposit never landed: the cron sets failed, never expired", async () => {
    const built = await (await call(build, { id: p.id })).json();
    vi.mocked(waitConfirmed).mockResolvedValueOnce("confirmed").mockResolvedValue("pending");
    vi.mocked(settleUnconfirmed).mockResolvedValue("pending");
    expect((await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) })).status).toBe(409);
    const card = (await repo.getMoveProposal(p.id))!;
    const r = await proposeMoves({ repo, now: new Date(), positions: async () => [], solUsd: 120, txStatus: async (sig) => (sig === card.redeemSignature ? "confirmed" : "expired") });
    expect(r.expired).toEqual([]);
    expect((await repo.getMoveProposal(p.id))?.status).toBe("failed");
    expect(await moveCarriesFor(repo, user.address)).toEqual([]);
  });

  it("the deposit send throws: its signature is already stored; 'may still' while its blockhash lives", async () => {
    const built = await (await call(build, { id: p.id })).json();
    vi.mocked(sendPosted).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("socket hang up"));
    vi.mocked(waitConfirmed).mockResolvedValueOnce("confirmed").mockResolvedValue("pending");
    vi.mocked(settleUnconfirmed).mockResolvedValue("pending");
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: MAY_STILL });
    expect((await repo.getMoveProposal(p.id))?.depositSignature).toEqual(expect.any(String));
  });

  it("a failed move_done write: still 200 and done, and the carry survives (it reads the done card)", async () => {
    const built = await (await call(build, { id: p.id })).json();
    const add = repo.addEvent.bind(repo);
    vi.spyOn(repo, "addEvent").mockImplementation(async (e) => { if (e.kind === "move_done") throw new Error("db down"); return add(e); });
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(built.transactions.map(sign)) });
    expect(res.status).toBe(200);
    expect((await repo.getMoveProposal(p.id))?.status).toBe("done");
    expect((await moveCarriesFor(repo, user.address)).map((c) => c.id)).toEqual([p.id]);
  });

  it("built twice with different amounts: the first signed pair still confirms, and the carry uses the build that matched (review minor 4)", async () => {
    const first = await (await call(build, { id: p.id })).json();
    receipt = 1_000_000n;
    const second = await (await call(build, { id: p.id })).json();
    expect(second.depositRaw).not.toBe(first.depositRaw);
    const res = await call(confirm, { id: p.id, signedTransactions: await Promise.all(first.transactions.map(sign)) });
    expect(res.status).toBe(200);
    expect((await moveCarriesFor(repo, user.address)).map((c) => c.depositRaw.toString())).toEqual([first.depositRaw]);
  });
});
