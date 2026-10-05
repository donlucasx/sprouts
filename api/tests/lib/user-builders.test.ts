import { describe, it, expect } from "vitest";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { buildLendWithdraw, buildMove, buildRelink } from "@/lib/venues/user-builders";
import { leashPda } from "@/lib/leash";
import { KLEND_PROGRAM, JLEND_PROGRAM, SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const programs = (ixs: { programAddress: string }[]) => ixs.map((i) => i.programAddress);
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
void findAssociatedTokenPda; void TOKEN_PROGRAM_ADDRESS;

describe("user-signed builders (contracts 6): pure, one signer, the user pays", () => {
  it("withdraw dispatches per venue", async () => {
    expect(programs(await buildLendWithdraw({ user: USER, asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 5n }))).toEqual([ATA, KLEND_PROGRAM, KLEND_PROGRAM]);
    expect(programs(await buildLendWithdraw({ user: USER, asset: "SOL_LEND", venue: "jupiter_lend", receiptRaw: 5n }))).toEqual([ATA, JLEND_PROGRAM, TOKEN]);
  });
  it("a SOL move keeps the WSOL account open between redeem and deposit, closing it once at the end", async () => {
    const redeem = await buildMove({ user: USER, asset: "SOL_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: 9n, depositRaw: 8n, part: "redeem" });
    expect(programs(redeem)).toEqual([ATA, KLEND_PROGRAM, KLEND_PROGRAM]);
    const deposit = await buildMove({ user: USER, asset: "SOL_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: 9n, depositRaw: 8n, part: "deposit" });
    expect(programs(deposit)).toEqual([ATA, JLEND_PROGRAM, TOKEN]);
    const whole = await buildMove({ user: USER, asset: "SOL_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: 9n, depositRaw: 8n, part: "whole" });
    expect(programs(whole)).toEqual([ATA, KLEND_PROGRAM, KLEND_PROGRAM, ATA, JLEND_PROGRAM, TOKEN]);
    expect(Buffer.from(deposit[1].data!).readBigUInt64LE(8)).toBe(8n);
  });
  it("relink: [revoke old], [init + ata when missing], create with delegatee = leashPda(user, user)", async () => {
    const old = address("ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD");
    const ixs = await buildRelink({ user: USER, nonce: 7n, startTs: 1_791_200_000n, existingDelegationPda: old, existingInitId: 3n, createAta: false });
    expect(programs(ixs)).toEqual([SUBSCRIPTIONS_PROGRAM, SUBSCRIPTIONS_PROGRAM]);
    expect(ixs[1].accounts![3].address).toBe(await leashPda(USER, USER));
    expect((await buildRelink({ user: USER, nonce: 7n, startTs: 1n, existingDelegationPda: null, createAta: true })).length).toBe(3);
  });
});
