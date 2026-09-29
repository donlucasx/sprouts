// Task 15 step 4: link the throwaway trading wallet to a Seeker account through the real routes, end to end.
//   1. upsert the Seeker's user row (Genesis mint and .skr name read live from chain; nothing about the Seeker is hardcoded)
//   2. mint a session for it in-process (same SESSION_SECRET as production; the token is never printed)
//   3. POST /api/link/new -> code; GET /api/link/{code}?wallet= -> unsigned approve-once (one instruction: the throwaway's
//      authority already exists, so this exercises the re-link path); sign with the throwaway key; simulate; send with --send
//   4. POST /api/link/confirm -> { linked, skrName }; the wallet row and the webhook address follow
// Run from api/: pnpm tsx --env-file=.env.local spikes/link-throwaway.ts <seedVaultPubkey or name.skr> [baseUrl] [--send]
import { createKeyPairSignerFromPrivateKeyBytes, getBase64Encoder, getBase64EncodedWireTransaction, getTransactionDecoder,
  signTransaction, getSignatureFromTransaction, address } from "@solana/kit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rpc } from "../src/lib/rpc";
import { config } from "../src/lib/config";
import { getRepo } from "../src/db/repo";
import { issueSession } from "../src/lib/session";
import { verifyGenesisHolder } from "../src/lib/genesis";
import { skrNameOf } from "../src/lib/skr";
import { readDelegation } from "../src/lib/subscriptions";

/** A Seed Vault address, or a .skr name resolved through AllDomains to its owner. */
async function seedVaultFrom(arg: string) {
  if (!arg.toLowerCase().endsWith(".skr")) return address(arg);
  const { Connection } = await import("@solana/web3.js");
  const { TldParser } = await import("@onsol/tldparser");
  const owner = await new TldParser(new Connection(config().heliusRpcUrl, "confirmed")).getOwnerFromDomainTld(arg.toLowerCase());
  if (!owner) throw new Error(`${arg}: no owner found`);
  return address(typeof owner === "string" ? owner : owner.toBase58());
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const send = process.argv.includes("--send");
const seeker = await seedVaultFrom(args[0] ?? "");
const base = (args[1] ?? "https://sprouts-api-gamma.vercel.app").replace(/\/$/, "");

const saved = JSON.parse(readFileSync(path.join(import.meta.dirname, "keys", "throwaway.json"), "utf8")) as { secret: string };
const wallet = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(Buffer.from(saved.secret, "base64url")));
console.log(`seeker ${seeker}, throwaway ${wallet.address}, api ${base}`);

// 1. the user row, from chain facts
const genesis = await verifyGenesisHolder(config().heliusRpcUrl, seeker);
if (!genesis) { console.log("the Seeker key holds no Genesis Token; stop"); process.exit(1); }
const skrName = await skrNameOf(config().heliusRpcUrl, seeker);
const repo = await getRepo();
const { row: user } = await repo.upsertUser({ seedVaultPubkey: seeker, sgtMint: genesis.mint, skrName });
console.log(`user row ok: name ${user.skrName ?? "none"}, mint ${user.sgtMint.slice(0, 6)}..., created ${user.createdAt.toISOString().slice(0, 10)}`);

// 2. a session, kept in memory
const token = await issueSession(seeker, genesis.mint);
const authed = { authorization: `Bearer ${token}`, "content-type": "application/json" };

// 3. the link flow
const codeRes = await fetch(`${base}/api/link/new`, { method: "POST", headers: authed });
if (!codeRes.ok) { console.log(`link/new failed: ${codeRes.status} ${await codeRes.text()}`); process.exit(1); }
const { code } = (await codeRes.json()) as { code: string };
console.log(`code ${code}`);

const txRes = await fetch(`${base}/api/link/${code}?wallet=${wallet.address}`);
if (!txRes.ok) { console.log(`link/{code} failed: ${txRes.status} ${await txRes.text()}`); process.exit(1); }
const t = (await txRes.json()) as { transaction: string; cap: number; puller: string; delegationPda: string };
console.log(`approval received: cap ${t.cap} cents/day, puller ${t.puller}, delegation ${t.delegationPda}`);

const unsigned = getTransactionDecoder().decode(getBase64Encoder().encode(t.transaction));
const signed = await signTransaction([wallet.keyPair], unsigned);
const wire = getBase64EncodedWireTransaction(signed);
console.log(`signed, ${Buffer.from(wire, "base64").length} bytes, signature ${getSignatureFromTransaction(signed)}`);

const sim = await rpc().simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }).send();
if (sim.value.err) {
  console.log(`simulation FAILED: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  for (const l of (sim.value.logs ?? []).slice(-6)) console.log(`   ${l}`);
  process.exit(1);
}
console.log(`simulation OK, ${sim.value.unitsConsumed} compute units${send ? "; sending" : "; dry run, add --send to link for real"}`);
if (!send) process.exit(0);

const sig = await rpc().sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1_500));
  const st = (await rpc().getSignatureStatuses([sig]).send()).value[0];
  if (st?.err) { console.log(`transaction FAILED on chain: ${JSON.stringify(st.err)}`); process.exit(1); }
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) break;
}
console.log(`sent ${sig}`);
const d = await readDelegation(address(t.delegationPda));
console.log(`delegation on chain: exists=${d.exists}, ${d.amountPerPeriodRaw} raw per ${d.periodLengthS}s`);

// 4. confirm
const conf = await fetch(`${base}/api/link/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, wallet: wallet.address }) });
console.log(`confirm: ${conf.status} ${await conf.text()}`);
const row = await repo.getWallet(wallet.address);
console.log(row ? `wallet row: user ${row.userPubkey.slice(0, 6)}..., status ${row.status}, cap ${row.dailyCapCents} cents, webhook ${row.webhookAdded}` : "wallet row MISSING");
console.log(`THROWAWAY_DELEGATION_PDA=${t.delegationPda}`);
