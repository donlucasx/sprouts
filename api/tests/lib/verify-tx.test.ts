import { describe, it, expect, beforeAll } from "vitest";
import {
  address, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction, generateKeyPairSigner, signTransaction, AccountRole,
  type Address, type Instruction, type KeyPairSigner, type Blockhash, type Transaction,
} from "@solana/kit";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { SUBSCRIPTIONS_PROGRAM, SKR_MINT } from "@/lib/constants";

const LIFETIME = { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi" as Blockhash, lastValidBlockHeight: 1n };
const SYSTEM = address("11111111111111111111111111111111");
const COMPUTE_BUDGET = address("ComputeBudget111111111111111111111111111111");
const LIGHTHOUSE = address("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
let wallet: KeyPairSigner;
beforeAll(async () => {
  wallet = await generateKeyPairSigner();
});

const ix = (program: Address, accounts: Address[] = []): Instruction => ({ programAddress: program, accounts: accounts.map((a) => ({ address: a, role: AccountRole.WRITABLE })), data: new Uint8Array([1, 2, 3]) });
/** Built the way the link GET builds an approval: v0, the wallet as noop fee payer, no lookup table. */
const build = (feePayer: Address, ixs: Instruction[]) =>
  compileTransaction(pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  ));
const b64 = (tx: Transaction) => getBase64EncodedWireTransaction(tx);

describe("verifyPostedTransaction [A3]", () => {
  it("accepts the wallet's own signed approval and reads its instructions", async () => {
    const signed = await signTransaction([wallet.keyPair], build(wallet.address, [ix(SUBSCRIPTIONS_PROGRAM, [SKR_MINT])]));
    const posted = verifyPostedTransaction({ base64: b64(signed), feePayer: wallet.address, programs: [SUBSCRIPTIONS_PROGRAM] });
    expect(posted.feePayer).toBe(wallet.address);
    expect(posted.instructions.length).toBe(1);
    expect(posted.instructions[0].program).toBe(SUBSCRIPTIONS_PROGRAM);
    expect(posted.instructions[0].accounts).toContain(SKR_MINT);
    expect(posted.instructions[0].data).toEqual(new Uint8Array([1, 2, 3]));
    expect(posted.signature.length).toBeGreaterThan(80);
    expect(posted.wire).toBe(b64(signed));
    expect(posted.blockhash).toBe(LIFETIME.blockhash);   // round 3, item 8: the confirm routes ask whether it is still valid
  });

  it("garbage is not a transaction", () => {
    expect(() => verifyPostedTransaction({ base64: "AAAA", feePayer: wallet.address, programs: [SUBSCRIPTIONS_PROGRAM] })).toThrow(/not a transaction/);
  });

  it("a transaction built for another wallet is refused", async () => {
    const other = await generateKeyPairSigner();
    const signed = await signTransaction([other.keyPair], build(other.address, [ix(SUBSCRIPTIONS_PROGRAM)]));
    expect(() => verifyPostedTransaction({ base64: b64(signed), feePayer: wallet.address, programs: [SUBSCRIPTIONS_PROGRAM] })).toThrow(/not built for this wallet/);
  });

  it("an unsigned transaction is refused", () => {
    const unsigned = build(wallet.address, [ix(SUBSCRIPTIONS_PROGRAM)]);
    expect(() => verifyPostedTransaction({ base64: b64(unsigned), feePayer: wallet.address, programs: [SUBSCRIPTIONS_PROGRAM] })).toThrow(/has not signed/);
  });

  it("a wallet's own priority fee and Lighthouse assertion are tolerated and set aside (Phantom, 2026-09-29)", async () => {
    const signed = await signTransaction([wallet.keyPair], build(wallet.address, [ix(COMPUTE_BUDGET), ix(SUBSCRIPTIONS_PROGRAM, [SKR_MINT]), ix(LIGHTHOUSE)]));
    const posted = verifyPostedTransaction({ base64: b64(signed), feePayer: wallet.address, programs: [SUBSCRIPTIONS_PROGRAM] });
    expect(posted.instructions.map((i) => i.program)).toEqual([SUBSCRIPTIONS_PROGRAM]);
    expect(posted.walletAdded).toEqual([COMPUTE_BUDGET, LIGHTHOUSE]);
  });

  it("an added System transfer is refused when only the Subscriptions program is allowed", async () => {
    const signed = await signTransaction([wallet.keyPair], build(wallet.address, [ix(SUBSCRIPTIONS_PROGRAM), ix(SYSTEM, [wallet.address])]));
    expect(() => verifyPostedTransaction({ base64: b64(signed), feePayer: wallet.address, programs: [SUBSCRIPTIONS_PROGRAM] })).toThrow(/program Sprouts does not use/);
  });
});
