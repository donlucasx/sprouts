/**
 * Lending transactions as contracts 1.4 and 6 describe them, with their OWN literal addresses (typed from the contracts, checked as
 * 32-byte base58 on 10-04): nothing comes from app/src/lib/sign.ts, so a typo or a swapped account there fails
 * app/tests/lib/sign-lend.test.ts instead of agreeing with itself. Task 15 also signs Track A's real builder output once it lands.
 */
import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Instruction } from '@solana/kit'
import { USER } from './api-built'

export const L = {
  KLEND: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', MARKET: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF', LMA: '9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo', SCOPE: '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH',
  JLEND: 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9', JLIQ_PROGRAM: 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC', JADMIN: '5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6', JLIQ: '7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', WSOL: 'So11111111111111111111111111111111111111112',
  TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', ATA: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', SYSTEM: '11111111111111111111111111111111', IXS: 'Sysvar1nstructions1111111111111111111111111',
  JUNK_RESERVE: 'AWnKJ9dsiHcoDCThxE5E93ikDTAXkApoNwrKM2tp9KFJ',   // K-Lend's $104 USDC reserve at 8.6% (spec 3): never ours
} as const
export const KRES = {
  USDC_LEND: { reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', mint: L.USDC, vault: 'Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6', kMint: 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D' },
  SOL_LEND: { reserve: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q', mint: L.WSOL, vault: 'GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U', kMint: '2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1' },
} as const
export const JRES = {
  USDC_LEND: { lending: '2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ', mint: L.USDC, fMint: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D', strl: '94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu', lspol: 'Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF', rateModel: '5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688', vault: 'BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB', rewards: '5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd', claim: 'HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW' },
  SOL_LEND: { lending: 'BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3', mint: L.WSOL, fMint: '2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU', strl: '4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy', lspol: '4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm', rateModel: 'Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo', vault: '5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr', rewards: 'CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR', claim: '6AQGR8zK4KTVZfZ9UZaRzyEL5ynvwVaF5ywVdmtJT24N' },
} as const
type LA = 'USDC_LEND' | 'SOL_LEND'
/** Anchor discriminators, sha256("global:<name>")[0..8], recomputed 10-04 and equal to the contracts' hex. */
export const D = {
  refresh: [2, 218, 138, 235, 79, 201, 25, 102],        // refresh_reserve 02da8aeb4fc91966
  kRedeem: [234, 117, 181, 125, 185, 142, 220, 29],     // redeem_reserve_collateral ea75b57db98edc1d
  kDeposit: [169, 201, 30, 126, 6, 205, 102, 68],       // deposit_reserve_liquidity a9c91e7e06cd6644
  jRedeem: [184, 12, 86, 149, 70, 196, 97, 225],        // redeem b80c569546c461e1
  jDeposit: [242, 35, 198, 137, 82, 225, 242, 182],     // deposit f223c68952e1f2b6
} as const
const READONLY = new Set<string>([L.KLEND, L.JLEND, L.JLIQ_PROGRAM, L.TOKEN, L.TOKEN_2022, L.ATA, L.SYSTEM, L.IXS])
export function ix(program: string, accounts: string[], data: readonly number[], signer: string = USER): Instruction {
  return {
    programAddress: address(program),
    accounts: accounts.map((a) => ({ address: address(a), role: a === signer ? AccountRole.WRITABLE_SIGNER : READONLY.has(a) ? AccountRole.READONLY : AccountRole.WRITABLE })),
    data: new Uint8Array(data),
  }
}
export const u64le = (n: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, true)
  return [...b]
}
const enc = (a: string) => getAddressEncoder().encode(address(a))
export async function ataOf(owner: string, mint: string): Promise<string> {
  return (await getProgramDerivedAddress({ programAddress: address(L.ATA), seeds: [enc(owner), enc(L.TOKEN), enc(mint)] }))[0]
}
export const createAta = (ataAddr: string, mint: string, user: string = USER) => ix(L.ATA, [user, ataAddr, user, mint, L.SYSTEM, L.TOKEN], [1], user)
export const closeAcct = (acct: string, user: string = USER) => ix(L.TOKEN, [acct, user, user], [9], user)
export const refresh = (asset: LA) => ix(L.KLEND, [KRES[asset].reserve, L.MARKET, L.KLEND, L.KLEND, L.KLEND, L.SCOPE], D.refresh)

/** withdraw_klend (contracts 6): [create underlying ATA; required for SOL], refresh, redeem(amount) into the user's underlying ATA, [SOL: close]. */
export async function klendWithdrawIxs(o: { asset: LA; amount: bigint; createAta?: boolean; close?: boolean; dest?: string; reserve?: string }): Promise<Instruction[]> {
  const r = KRES[o.asset], und = await ataOf(USER, r.mint), k = await ataOf(USER, r.kMint)
  const out: Instruction[] = []
  if (o.createAta ?? o.asset === 'SOL_LEND') out.push(createAta(und, r.mint))
  out.push(refresh(o.asset))
  out.push(ix(L.KLEND, [USER, L.MARKET, o.reserve ?? r.reserve, L.LMA, r.mint, r.kMint, r.vault, k, o.dest ?? und, L.TOKEN, L.TOKEN, L.IXS], [...D.kRedeem, ...u64le(o.amount)]))
  if (o.close ?? o.asset === 'SOL_LEND') out.push(closeAcct(und))
  return out
}
/** withdraw_jlend (contracts 6): [create underlying ATA], redeem(shares) with its 18 accounts, [SOL: close]. */
export async function jlendWithdrawIxs(o: { asset: LA; amount: bigint; createAta?: boolean; close?: boolean; dest?: string }): Promise<Instruction[]> {
  const j = JRES[o.asset], und = await ataOf(USER, j.mint), f = await ataOf(USER, j.fMint)
  const out: Instruction[] = []
  if (o.createAta) out.push(createAta(und, j.mint))
  out.push(ix(L.JLEND, [USER, f, o.dest ?? und, L.JADMIN, j.lending, j.mint, j.fMint, j.strl, j.lspol, j.rateModel, j.vault, j.claim, L.JLIQ, L.JLIQ_PROGRAM, j.rewards, L.TOKEN, L.ATA, L.SYSTEM], [...D.jRedeem, ...u64le(o.amount)]))
  if (o.close ?? o.asset === 'SOL_LEND') out.push(closeAcct(und))
  return out
}
