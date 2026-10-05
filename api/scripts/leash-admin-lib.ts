// Pure helpers behind scripts/leash-admin.ts (the owner's leash Config CLI). Never imported by the server (contracts 3.1).
import { readFileSync } from "node:fs";
import os from "node:os";
import { AccountRole, compileTransaction, createKeyPairSignerFromBytes, createNoopSigner, createTransactionMessage, getTransactionEncoder, pipe, appendTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getSignatureFromTransaction,
  type Address, type Blockhash, type Instruction, type KeyPairSigner, type TransactionSigner } from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { LEG_BYTES, LEG_SPEC, leashConfigPda, encodeConfig, encodeHeader, encodeLeg, initConfigData, setHeaderData, setLegData, type LeashConfig, type LeashLegByte } from "../src/lib/leash";
import { PYTH_FEED } from "../src/lib/venues/addresses";
import { LEASH_ADMIN, LEASH_PROGRAM, SYSTEM_PROGRAM, USDC_MINT } from "../src/lib/constants";

/** Today's puller (leash plan: Config at init; app sign.ts:38). */
export const PULLER_MAINNET = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
/** Solana's packet limit for a serialized transaction; litesvm does not enforce it. */
export const MAX_TX_BYTES = 1232;
/** The only way past the leg 0 (SKR) guard. SKR has no price source today (R324), so an enabled leg 0 is never installable. */
export const SKR_OVERRIDE_FLAG = "--DANGER-enable-skr-leg-without-price-source";

/** R299 + the coordinator's update: the only key allowed is GrHSwzYp...; anything else stops here, before any RPC. Never prints key bytes. */
export async function loadAdmin(path: string): Promise<KeyPairSigner> {
  if (!path) throw new Error("--admin <path to the admin keypair json> is required");
  const bytes = Uint8Array.from(JSON.parse(readFileSync(path.replace(/^~(?=\/)/, os.homedir()), "utf8")) as number[]);
  const signer = await createKeyPairSignerFromBytes(bytes);
  if (signer.address !== LEASH_ADMIN) throw new Error(`${path} holds ${signer.address}, not the Sprouts admin key ${LEASH_ADMIN}`);
  return signer;
}

/** Amended contracts 2.3 per-leg values: tol 100/150/10, fee 50/0, confidence cap 100 bps, max age per leg (60 s; cbBTC 600 s, R324), the leg's pinned feed, feed_account zero. */
export function legConfigFor(leg: LeashLegByte, enabled: boolean): LeashConfig["legs"][number] {
  const s = LEG_SPEC[leg];
  return { enabled, reader: s.reader, feeBps: s.feeBps, tolBps: s.tolBps, confCapBps: 100, maxAgeS: s.maxAgeS, receiptMint: s.receiptMint, rateAccount: s.rateAccount, extra: s.extra, feedId: s.feed ? PYTH_FEED[s.feed] : null, feedAccount: null };
}

/** The wanted Config: puller_usdc = the puller's canonical USDC ATA (classic token program), max_pull 5 USDC. */
export async function configFor(a: { puller: Address; enabled: readonly LeashLegByte[] }): Promise<LeashConfig> {
  const [pullerUsdc] = await findAssociatedTokenPda({ owner: a.puller, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return { puller: a.puller, pullerUsdc, maxPullRaw: 5_000_000n, legs: LEG_BYTES.map((l) => legConfigFor(l, a.enabled.includes(l))) };
}

export function parseLegs(s: string): LeashLegByte[] {
  const legs = s.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
  for (const l of legs) if (!Number.isInteger(l) || l < 0 || l > 7) throw new Error(`unknown leg ${l} (0..7)`);
  return [...new Set(legs)].sort() as LeashLegByte[];
}

/**
 * R324: leg 0 (SKR) has no price source, so a Config with leg 0 enabled is never an install target (leash/config/README: only
 * mainnet-day1.hex is installable; the all-legs file is an encoder test vector). Refused unless the owner passes SKR_OVERRIDE_FLAG.
 */
export function assertInstallable(want: LeashConfig, allowSkr: boolean): void {
  if (want.legs[0]?.enabled && !allowSkr)
    throw new Error(`refusing a Config with leg 0 (SKR) enabled: SKR has no price source (R324). Nothing was sent. (Override, only if the coordinator says so: ${SKR_OVERRIDE_FLAG})`);
}

/** One admin instruction per tx (contracts 2.5, R325). */
export type AdminStep = { kind: "init" } | { kind: "header" } | { kind: "leg"; leg: LeashLegByte };
export const stepName = (s: AdminStep): string => (s.kind === "init" ? "init_config" : s.kind === "header" ? "set_header" : `set_leg ${s.leg}`);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The steps that move the on-chain account (`raw` = its 1504 bytes, null = no Config yet) to `want`, compared byte for byte:
 * init_config when absent (init leaves every leg unset, so every leg follows), set_header when bytes 16..96 differ,
 * then one set_leg per leg whose 176 bytes at 96 + 176 * leg differ. A rerun after an interruption plans only what is missing.
 */
export function planAdminSteps(raw: Uint8Array | null, want: LeashConfig): AdminStep[] {
  const steps: AdminStep[] = [];
  if (!raw) steps.push({ kind: "init" });
  else {
    if (raw.length !== 1504) throw new Error(`leash config: ${raw.length} bytes, expected 1504`);
    if (!sameBytes(raw.subarray(16, 96), encodeHeader(want))) steps.push({ kind: "header" });
  }
  for (const leg of LEG_BYTES) {
    const at = 96 + 176 * leg;
    if (!raw || !sameBytes(raw.subarray(at, at + 176), encodeLeg(leg, want.legs[leg]))) steps.push({ kind: "leg", leg });
  }
  return steps;
}

/** Contracts 2.5 (amended): [2][header] 81 B, [4][header] 81 B, [5][leg][LegConfig] 178 B. */
export const adminIxData = (step: AdminStep, c: LeashConfig): Uint8Array =>
  step.kind === "init" ? initConfigData(c) : step.kind === "header" ? setHeaderData(c) : setLegData(step.leg, c);

export async function adminIx(a: { admin: TransactionSigner | Address; step: AdminStep; config: LeashConfig }): Promise<Instruction> {
  const signer = typeof a.admin === "string" ? createNoopSigner(a.admin) : a.admin;
  const config = await leashConfigPda();
  const accounts = a.step.kind === "init"
    ? [{ address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer }, { address: config, role: AccountRole.WRITABLE }, { address: SYSTEM_PROGRAM, role: AccountRole.READONLY }]
    : [{ address: signer.address, role: AccountRole.READONLY_SIGNER, signer }, { address: config, role: AccountRole.WRITABLE }];
  return { programAddress: LEASH_PROGRAM, accounts, data: adminIxData(a.step, a.config) } as Instruction;
}

/** The CU pair every admin tx carries (counted in the contracts 2.5 size table). */
export const computeBudgetIxs = (): Instruction[] => [getSetComputeUnitLimitInstruction({ units: 100_000 }), getSetComputeUnitPriceInstruction({ microLamports: 20_000n })];

/** The v0 message the CLI signs: fee payer = ADMIN, the CU pair, then exactly one admin instruction. */
export function adminMessage(a: { admin: TransactionSigner; ix: Instruction; blockhash: Blockhash; lastValidBlockHeight: bigint }) {
  return pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(a.admin, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: a.blockhash, lastValidBlockHeight: a.lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions([...computeBudgetIxs(), a.ix], m));
}

/** The serialized size (signature included) of the tx the CLI sends for `ix`, measured before anything is sent. */
export function adminTxSize(admin: Address, ix: Instruction): number {
  const msg = adminMessage({ admin: createNoopSigner(admin), ix, blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 0n });
  return getTransactionEncoder().encode(compileTransaction(msg)).length;
}

/** Signs an adminMessage with its signers (the admin). */
export const signAdminMessage = (m: ReturnType<typeof adminMessage>) => signTransactionMessageWithSigners(m);
export type SignedAdminTx = Awaited<ReturnType<typeof signAdminMessage>>;
/** What runAdminSteps needs from the network; the CLI wires it to an RPC, the tests to an in-memory program. */
export type AdminChain = {
  readRaw(): Promise<Uint8Array | null>;
  latestBlockhash(): Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>;
  simulate(wireBase64: string): Promise<{ err: unknown; logs: readonly string[] | null }>;
  send(tx: SignedAdminTx, ix: Instruction): Promise<void>;
};
export type AdminRun = { code: 0 | 1 | 2 | 3; sent: string[] };
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/**
 * Plans from the chain, then per step: build, size-check (<= 1,232 B), sign, simulate, send; any failure stops the run (rerunning
 * resumes from the chain). After the last step re-reads the account and requires bytes 16..1504 to equal encodeConfig(want).
 * Codes: 0 matched, 1 simulation failed, 2 over the size limit, 3 the final read differs.
 */
export async function runAdminSteps(a: { admin: TransactionSigner; want: LeashConfig; chain: AdminChain; log?: (s: string) => void; maxTxBytes?: number }): Promise<AdminRun> {
  const log = a.log ?? console.log;
  const limit = a.maxTxBytes ?? MAX_TX_BYTES;
  const sent: string[] = [];
  const steps = planAdminSteps(await a.chain.readRaw(), a.want);
  if (!steps.length) { log("nothing to do: the on-chain Config already matches"); return { code: 0, sent }; }
  for (const [k, step] of steps.entries()) {
    const label = `step ${k + 1}/${steps.length} ${stepName(step)}`;
    const ix = await adminIx({ admin: a.admin, step, config: a.want });
    const size = adminTxSize(a.admin.address, ix);
    if (size > limit) { log(`${label}: the tx is ${size} bytes, over Solana's ${limit}. Stopped; nothing more was sent.`); return { code: 2, sent }; }
    const lifetime = await a.chain.latestBlockhash();
    const tx = await signAdminMessage(adminMessage({ admin: a.admin, ix, ...lifetime }));
    const sim = await a.chain.simulate(getBase64EncodedWireTransaction(tx));
    if (sim.err) {
      log(`${label}: simulation FAILED ${json(sim.err)}; ${(sim.logs ?? []).slice(-3).join(" | ")}. Stopped; rerun the same command to resume.`);
      return { code: 1, sent };
    }
    await a.chain.send(tx, ix);
    sent.push(stepName(step));
    log(`${label} confirmed ${getSignatureFromTransaction(tx)} (${size} B)`);
  }
  const after = await a.chain.readRaw();
  if (!after || Buffer.from(after.subarray(16)).toString("hex") !== Buffer.from(encodeConfig(a.want)).toString("hex")) {
    log("the on-chain Config does not equal what was planned: STOP and send `show` output to the coordinator");
    return { code: 3, sent };
  }
  log("Config matches (bytes 16..1504 == encodeConfig). Run 'show' or the leash track's onchain_config_matches to read it back.");
  return { code: 0, sent };
}
