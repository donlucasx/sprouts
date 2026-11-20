import { describe, it, expect, vi, beforeEach } from "vitest";
import { address, createNoopSigner, getBase64Encoder, type Address, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

/** The chain: which accounts exist (by address); getMultipleAccounts answers null for the rest. */
const { chain } = vi.hoisted(() => ({ chain: { existing: new Set<string>(), reads: 0 } }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  getMultipleAccounts: (as: string[]) => ({ send: async () => { chain.reads++; return { value: as.map((a) => (chain.existing.has(a) ? { lamports: 2_039_280n } : null)) }; } }),
}) }));

import {
  ATA_RENT_LAMPORTS, SETUP_MAX, TOPUP_SETUP_MAX, SETUP_SOL_MARGIN, SETUP_MINTS, SETUP_MINTS_BY_ASSET, SetupRefused,
  fitSetup, missingSetupMints, setupCreates, setupOrder, takeSetupPrefix, wireBytes,
} from "@/lib/user-setup";
import { buildUserTransaction } from "@/lib/user-tx";
import { buildApproveOnceIxs, buildRevokeDelegationIx, delegationPda } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { buildRelink } from "@/lib/venues/user-builders";
import { DEFAULT_RULES, type Rules } from "@/domain/roundup";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const OTHER = address("8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6");
const STORE = address("storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR");
const HSOL = address("he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A");
const CBBTC = address("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij");
const KUSDC = address("B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D");
const FUSDC = address("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D");
const KSOL = address("2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1");
const FSOL = address("2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const SKR = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const ataOf = async (owner: string, mint: string, tokenProgram: Address = TOKEN_PROGRAM_ADDRESS) => (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram }))[0] as string;
const rules = (allocation: Partial<Rules["allocation"]>, pins: Rules["pins"] = {}): Rules => ({
  ...DEFAULT_RULES,
  allocation: { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...allocation },
  pins,
});
const ALL_ON = rules({ SKR: 40, stORE: 10, USDC_LEND: 20, SOL_LEND: 10, hSOL: 10, cbBTC: 10 });
type Ix = { program: string; accounts: string[]; data: Uint8Array };
const create = async (mint: string, o: Partial<{ payer: string; owner: string; ata: string; data: number[]; program: string; extra: string }> = {}): Promise<Ix> => ({
  program: o.program ?? ATA_PROGRAM,
  accounts: [o.payer ?? USER, o.ata ?? (await ataOf(o.owner ?? USER, mint)), o.owner ?? USER, mint, SYSTEM, TOKEN, ...(o.extra ? [o.extra] : [])],
  data: new Uint8Array(o.data ?? [1]),
});
const OTHER_IX: Ix = { program: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44", accounts: [USER], data: new Uint8Array([2]) };

beforeEach(() => {
  chain.existing.clear();
  chain.reads = 0;
});

describe("user-setup constants (design 2, 3; founder D1: both lending venues' receipts)", () => {
  it("the 7 setup mints, per asset, in the design's table order; SKR none; the rent is moves.ts's old constant", () => {
    expect(SETUP_MINTS_BY_ASSET).toEqual({ SKR: [], stORE: [STORE], hSOL: [HSOL], cbBTC: [CBBTC], USDC_LEND: [KUSDC, FUSDC], SOL_LEND: [KSOL, FSOL] });
    expect(SETUP_MINTS).toEqual([STORE, HSOL, CBBTC, KUSDC, FUSDC, KSOL, FSOL]);
    expect(Object.isFrozen(SETUP_MINTS)).toBe(true);
    expect(SETUP_MAX).toBe(7);
    expect(TOPUP_SETUP_MAX).toBe(3);
    expect(ATA_RENT_LAMPORTS).toBe(2_039_280);
    expect(SETUP_SOL_MARGIN).toBe(20_000_000);
  });

  it("every setup mint is one the app's top-up check already screens out (TOPUP_FOREIGN_MINTS, vendored)", async () => {
    const app = await import("node:fs").then((fs) => fs.readFileSync(new URL("../fixtures/app/sign.ts", import.meta.url), "utf8"));
    const foreign = app.slice(app.indexOf("const TOPUP_FOREIGN_MINTS"), app.indexOf("])", app.indexOf("const TOPUP_FOREIGN_MINTS")));
    for (const m of [STORE, HSOL, CBBTC]) expect(foreign).toContain(m);
    for (const k of ["KLEND_RESERVE.USDC_LEND.collateralMint", "KLEND_RESERVE.SOL_LEND.collateralMint", "JLEND.USDC_LEND.fTokenMint", "JLEND.SOL_LEND.fTokenMint"]) expect(foreign).toContain(k);
  });
});

describe("setupOrder / missingSetupMints (switched on = plantingTarget(rules, []) > 0)", () => {
  it("default rules (SKR only, stORE's 10% default): stORE only", () => {
    expect(setupOrder(rules({ SKR: 100 }))).toEqual([STORE]);
  });
  it("stORE switched off (pin 0) and SKR only: nothing to set up, and no chain read", async () => {
    expect(setupOrder(rules({ SKR: 100 }, { stORE: 0 }))).toEqual([]);
    expect(await missingSetupMints(USER, rules({ SKR: 100 }, { stORE: 0 }))).toEqual([]);
    expect(chain.reads).toBe(0);
  });
  it("by target share, largest first, ties in table order; a lending coin brings both venues' receipts", () => {
    expect(setupOrder(ALL_ON)).toEqual([KUSDC, FUSDC, STORE, HSOL, CBBTC, KSOL, FSOL]);
  });
  it("a coin switched off by a 0 pin is left out even with a stale share", () => {
    expect(setupOrder(rules({ SKR: 40, stORE: 10, USDC_LEND: 20, SOL_LEND: 10, hSOL: 10, cbBTC: 10 }, { cbBTC: 0, stORE: 0 }))).not.toContain(CBBTC);
  });
  it("a broken target (sums under 100) or an empty one: nothing (never throws)", () => {
    expect(setupOrder(rules({ SKR: 10 }, { stORE: 0 }))).toEqual([]);
    expect(setupOrder(rules({}, { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 }))).toEqual([]);
  });
  it("one getMultipleAccounts read of the classic ATAs; accounts that exist are skipped; order kept", async () => {
    chain.existing.add(await ataOf(USER, FUSDC));
    chain.existing.add(await ataOf(USER, HSOL));
    expect(await missingSetupMints(USER, ALL_ON)).toEqual([KUSDC, STORE, CBBTC, KSOL, FSOL]);
    expect(chain.reads).toBe(1);
  });
});

describe("setupCreates", () => {
  it("CreateIdempotent of the user's own classic ATA, paid by the user, accounts [payer, ata, owner, mint, system, token], data [1]", async () => {
    const ixs = await setupCreates(USER, [STORE, KUSDC]);
    expect(ixs).toHaveLength(2);
    for (const [k, mint] of [STORE, KUSDC].entries()) {
      const ix = ixs[k];
      expect(ix.programAddress).toBe(ATA_PROGRAM);
      expect([...(ix.data ?? [])]).toEqual([1]);
      expect((ix.accounts ?? []).map((a) => a.address)).toEqual([USER, await ataOf(USER, mint), USER, mint, SYSTEM, TOKEN]);
    }
  });
});

describe("takeSetupPrefix (the server mirror of the app's takeSetup)", () => {
  it("peels a leading run of setup creates up to max and returns the rest unchanged", async () => {
    const lead = await Promise.all([STORE, HSOL, KUSDC].map((m) => create(m)));
    const rest = [OTHER_IX];
    expect(await takeSetupPrefix([...lead, ...rest], USER, 3)).toEqual(rest);
    expect(await takeSetupPrefix(rest, USER, 0)).toEqual(rest);
    expect(await takeSetupPrefix([], USER, 7)).toEqual([]);
  });
  it("each of the 7 mints passes alone", async () => {
    for (const m of SETUP_MINTS) expect(await takeSetupPrefix([await create(m), OTHER_IX], USER, 1)).toEqual([OTHER_IX]);
  });
  it("more creates than max is refused; max absent (0) with any create is refused", async () => {
    const lead = await Promise.all([STORE, HSOL, KUSDC].map((m) => create(m)));
    await expect(takeSetupPrefix([...lead, OTHER_IX], USER, 2)).rejects.toBeInstanceOf(SetupRefused);
    await expect(takeSetupPrefix([lead[0], OTHER_IX], USER, 0)).rejects.toBeInstanceOf(SetupRefused);
  });
  it("max 8, -1 or 1.5 is refused", async () => {
    for (const max of [8, -1, 1.5, Number.NaN]) await expect(takeSetupPrefix([OTHER_IX], USER, max)).rejects.toBeInstanceOf(SetupRefused);
  });
  it("USDC, wSOL, SKR, JitoSOL and a random mint are not setup mints: the run stops there and the rest keeps them", async () => {
    for (const m of [USDC, WSOL, SKR, "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", OTHER as string]) {
      const c = await create(m);
      expect(await takeSetupPrefix([c, OTHER_IX], USER, 7)).toEqual([c, OTHER_IX]);
    }
  });
  it("owner, payer or ATA not the user's own, Token-2022, Create (data [0] or empty), an extra or missing account, the same mint twice: refused", async () => {
    const bad = [
      await create(STORE, { owner: OTHER }),
      await create(STORE, { payer: OTHER }),
      await create(STORE, { ata: await ataOf(OTHER, STORE) }),
      await create(STORE, { ata: await ataOf(USER, STORE, TOKEN_2022_PROGRAM_ADDRESS) }),
      await create(STORE, { data: [0] }),
      await create(STORE, { data: [] }),
      await create(STORE, { data: [2] }),
      await create(STORE, { extra: SYSTEM }),
      { ...(await create(STORE)), accounts: (await create(STORE)).accounts.slice(0, 5) },
      { ...(await create(STORE)), accounts: [...(await create(STORE)).accounts.slice(0, 5), TOKEN_2022_PROGRAM_ADDRESS] },
    ];
    for (const ix of bad) await expect(takeSetupPrefix([ix, OTHER_IX], USER, 7)).rejects.toBeInstanceOf(SetupRefused);
    await expect(takeSetupPrefix([await create(STORE), await create(STORE), OTHER_IX], USER, 7)).rejects.toBeInstanceOf(SetupRefused);
  });
  it("a setup create after the first other instruction is not peeled (the flow's own check sees it)", async () => {
    const late = await create(STORE);
    expect(await takeSetupPrefix([OTHER_IX, late], USER, 7)).toEqual([OTHER_IX, late]);
    const first = await create(HSOL);
    expect(await takeSetupPrefix([first, OTHER_IX, late], USER, 7)).toEqual([OTHER_IX, late]);
  });
});

describe("fitSetup", () => {
  it("keeps every create when the wire fits; drops from the END until it fits; 0 when none fit", async () => {
    const creates = await setupCreates(USER, [STORE, HSOL, CBBTC]);
    const seen: number[] = [];
    const compile = async (c: readonly Instruction[]) => { seen.push(c.length); return buildUserTransaction(USER, [...c]); };
    const all = await fitSetup(compile, creates);
    expect(all.used).toBe(3);
    const two = await fitSetup(compile, creates, wireBytes(await buildUserTransaction(USER, creates.slice(0, 2))));
    expect(two.used).toBe(2);
    seen.length = 0;
    const none = await fitSetup(compile, creates, 10);
    expect(none.used).toBe(0);
    expect(seen).toEqual([3, 2, 1, 0]);
    expect(none.transaction).toBe(await buildUserTransaction(USER, []));
  });
});

describe("measured sizes (design 5: 1232 bytes; ~74 B per create estimated)", () => {
  it("link approval worst cases + 0..7 creates all fit; the per-create cost is measured", async () => {
    const leash = await leashPda(USER, USER);
    const old = await delegationPda({ delegator: USER, delegatee: address("HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd"), nonce: 1n });
    const shapes: Record<string, Instruction[]> = {
      "link: revoke + USDC create + init + delegation create": [buildRevokeDelegationIx({ delegator: USER, delegationPda: old }), ...(await buildApproveOnceIxs({ delegator: USER, delegatee: leash, capRaw: 5_000_000n, nonce: 9n, createAta: true }))],
      "link: revoke + USDC create + reapprove + delegation create": [buildRevokeDelegationIx({ delegator: USER, delegationPda: old }), ...(await buildApproveOnceIxs({ delegator: USER, delegatee: leash, capRaw: 5_000_000n, nonce: 9n, existingInitId: 3n, createAta: true, reapprove: true }))],
      "relink: revoke + USDC create + init + create": await buildRelink({ user: USER, nonce: 8n, startTs: 1_791_200_000n, existingDelegationPda: old, createAta: true }),
    };
    const order = [KUSDC, FUSDC, STORE, HSOL, CBBTC, KSOL, FSOL];
    const lines: string[] = [];
    for (const [name, ixs] of Object.entries(shapes)) {
      const sizes: number[] = [];
      for (let n = 0; n <= 7; n++) sizes.push(wireBytes(await buildUserTransaction(USER, [...(await setupCreates(USER, order.slice(0, n))), ...ixs])));
      lines.push(`${name}: ${sizes.join(", ")}`);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(1232);
    }
    console.info(`SIZES (wire bytes, 0..7 creates)\n${lines.join("\n")}`);
  });
  it("wireBytes is the decoded base64 length", async () => {
    const tx = await buildUserTransaction(USER, []);
    expect(wireBytes(tx)).toBe(getBase64Encoder().encode(tx).length);
  });
  it("a create costs no new signer: the user is payer, owner and fee payer", async () => {
    const ix = getCreateAssociatedTokenIdempotentInstruction({ payer: createNoopSigner(USER), ata: address(await ataOf(USER, STORE)), owner: USER, mint: address(STORE) });
    const one = wireBytes(await buildUserTransaction(USER, [ix]));
    const two = wireBytes(await buildUserTransaction(USER, [ix, ...(await setupCreates(USER, [HSOL]))]));
    expect(two - one).toBeLessThanOrEqual(80);
  });
});
