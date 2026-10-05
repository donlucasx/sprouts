/**
 * VENDORED, read-only copy of the phone's pre-sign check for the approval flows (link, relink), so the API's tests can prove the
 * re-link builders produce a transaction the phone signs. Source: sprouts-lend-app app/src/lib/sign.ts at 1ed1156
 * (sha256 e72641c87f67aebe7998f3d3d283b8b6ae4306ed1cbf2980ea8a8f677cb6c770): checkBeforeSigning's common rules (v0, no lookup table,
 * fee payer = user, one signer = user) and checkApproval, verbatim apart from formatting and the app-only imports. If sign.ts
 * changes, re-copy it; this file must never be loosened to make an API test pass.
 */
import { getAddressEncoder, getCompiledTransactionMessageDecoder, getProgramDerivedAddress, type Address, type Transaction } from "@solana/kit";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SUBSCRIPTIONS_PROGRAM = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const LEASH_PROGRAM = "GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7";
export const APP_PULLER = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const LINK_DAILY_CAP_RAW = 5_000_000n;
const DAY_S = 86_400n;
const SUB_INIT = 0, SUB_CREATE_RECURRING = 2, SUB_REVOKE_DELEGATION = 3;
const ATA_CREATE_IDEMPOTENT = 1;

export const REFUSED = {
  unreadable: "Sprouts could not read this transaction. Nothing was signed.",
  payer: "This transaction was not built for your wallet. Nothing was signed.",
  signer: "This transaction asks for a signature besides yours. Nothing was signed.",
  lookup: "This transaction uses a lookup table Sprouts did not build. Nothing was signed.",
  program: "This transaction touches a program Sprouts does not use here. Nothing was signed.",
  plan: "This transaction does not match what the screen shows. Nothing was signed.",
} as const;
export class SignRefused extends Error {}
type Ix = { program: string; accounts: string[]; data: Uint8Array };
const refuse = (why: keyof typeof REFUSED): never => { throw new SignRefused(REFUSED[why]); };
const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true);
const i64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigInt64(at, true);
type Seed = Parameters<typeof getProgramDerivedAddress>[0]["seeds"][number];
const pda = async (program: string, seeds: Seed[]) => (await getProgramDerivedAddress({ programAddress: program as Address, seeds }))[0] as string;
const key = (a: string) => getAddressEncoder().encode(a as Address);

export async function appLeashPda(delegator: string, user: string): Promise<string> {
  return pda(LEASH_PROGRAM, ["leash", key(delegator), key(user)]);
}
async function derived(user: string) {
  const [authority, usdcAta] = await Promise.all([
    pda(SUBSCRIPTIONS_PROGRAM, ["SubscriptionAuthority", key(user), key(USDC_MINT)]),
    pda(ATA_PROGRAM, [key(user), key(TOKEN_PROGRAM), key(USDC_MINT)]),
  ]);
  return { authority, usdcAta };
}
async function delegationPda(authority: string, user: string, delegatee: string, nonce: bigint): Promise<string> {
  const n = new Uint8Array(8);
  new DataView(n.buffer).setBigUint64(0, nonce, true);
  return pda(SUBSCRIPTIONS_PROGRAM, ["delegation", key(authority), key(user), key(delegatee), n]);
}
function accountsAre(ix: Ix, expected: readonly (string | null)[]) {
  if (ix.accounts.length !== expected.length || expected.some((e, i) => e !== null && ix.accounts[i] !== e)) refuse("plan");
}

async function checkApproval(ixs: Ix[], user: string, d: Awaited<ReturnType<typeof derived>>, delegatees: readonly string[], maxRevokes: number): Promise<void> {
  let creates = 0;
  let revokes = 0;
  let atas = 0;
  let inits = 0;
  const revoked: string[] = [];
  if (ixs.some((ix) => ix.program !== ATA_PROGRAM && ix.program !== SUBSCRIPTIONS_PROGRAM)) refuse("program");
  for (const ix of ixs) {
    if (creates > 0) refuse("plan");
    if (ix.program === ATA_PROGRAM) {
      if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) refuse("plan");
      accountsAre(ix, [user, d.usdcAta, user, USDC_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM]);
      if (++atas > 1 || inits > 0) refuse("plan");
      continue;
    }
    const kind = ix.data[0];
    if (kind === SUB_INIT) {
      if (ix.data.length !== 1) refuse("plan");
      accountsAre(ix, [user, d.authority, USDC_MINT, d.usdcAta, SYSTEM_PROGRAM, TOKEN_PROGRAM]);
      if (++inits > 1) refuse("plan");
      continue;
    }
    if (kind === SUB_REVOKE_DELEGATION) {
      if (ix.data.length !== 1) refuse("plan");
      accountsAre(ix, [user, null]);
      if (++revokes > maxRevokes || inits > 0) refuse("plan");
      revoked.push(ix.accounts[1]);
      continue;
    }
    if (kind !== SUB_CREATE_RECURRING) refuse("plan");
    if (ix.data.length !== 49 || ix.accounts.length !== 5) refuse("plan");
    if (u64At(ix.data, 9) !== LINK_DAILY_CAP_RAW || u64At(ix.data, 17) !== DAY_S || i64At(ix.data, 33) !== 0n) refuse("plan");
    const delegatee = ix.accounts[3];
    if (!delegatees.includes(delegatee)) refuse("plan");
    const delegation = await delegationPda(d.authority, user, delegatee, u64At(ix.data, 1));
    accountsAre(ix, [user, d.authority, delegation, delegatee, SYSTEM_PROGRAM]);
    if (revoked.includes(delegation)) refuse("plan");
    creates++;
  }
  if (creates !== 1) refuse("plan");
}

/** sign.ts checkBeforeSigning for `{ kind: 'relink' | 'link', user }`. */
export async function appCheckApproval(tx: Transaction, flow: { kind: "relink" | "link"; user: string }): Promise<void> {
  let message;
  try {
    message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  } catch {
    return refuse("unreadable");
  }
  if (message.version !== 0) return refuse("unreadable");
  if (message.addressTableLookups && message.addressTableLookups.length > 0) refuse("lookup");
  const keys = message.staticAccounts as readonly string[];
  if (keys[0] !== flow.user) refuse("payer");
  const slots = Object.keys(tx.signatures);
  if (message.header.numSignerAccounts !== 1 || slots.length !== 1 || slots[0] !== flow.user) refuse("signer");
  const ixs: Ix[] = message.instructions.map((ix) => ({
    program: keys[ix.programAddressIndex],
    accounts: (ix.accountIndices ?? []).map((i) => keys[i]),
    data: new Uint8Array(ix.data ?? []),
  }));
  if (ixs.some((ix) => ix.program === undefined || ix.accounts.some((a) => a === undefined))) refuse("unreadable");
  const d = await derived(flow.user);
  const leash = await appLeashPda(flow.user, flow.user);
  return flow.kind === "relink" ? checkApproval(ixs, flow.user, d, [leash], 1) : checkApproval(ixs, flow.user, d, [APP_PULLER, leash], 1);
}
