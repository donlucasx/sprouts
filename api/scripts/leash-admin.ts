// The leash's config, run ONLY by the owner from his Terminal (R299). Never imported by the server. Interface fixed by the leash plan (Task 9):
//   cd api && pnpm tsx scripts/leash-admin.ts show --admin ~/.config/solana/sprouts-admin.json
//   cd api && pnpm tsx scripts/leash-admin.ts init --admin ~/.config/solana/sprouts-admin.json
//   cd api && pnpm tsx scripts/leash-admin.ts set  --admin ~/.config/solana/sprouts-admin.json --enable 2,6,7 [--puller <pubkey>]
// Optional on every command: --rpc <url> (else HELIUS_RPC_URL if exported, else https://api.mainnet-beta.solana.com).
// The admin key must be GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY or nothing happens; the key file is read by path and never printed.
// One admin instruction per tx (contracts 2.5, R325): each is size-checked (<= 1,232 B) and simulated before it is sent; a failure stops
// the run, and rerunning the same command resumes from the chain. Leg 0 (SKR) is refused unless the scary flag (SKR_OVERRIDE_FLAG) is passed.
import { address, createSolanaRpc, createSolanaRpcSubscriptions, sendAndConfirmTransactionFactory, assertIsTransactionWithBlockhashLifetime } from "@solana/kit";
import { loadAdmin, configFor, parseLegs, assertInstallable, assertInitSafe, configAccountBytes, runAdminSteps, PULLER_MAINNET, SKR_OVERRIDE_FLAG, type AdminChain } from "./leash-admin-lib";
import { decodeConfig, leashConfigPda, LEASH_IX, type LeashConfig } from "../src/lib/leash";

const fail = (msg: string, code = 1): never => { console.error(msg); process.exit(code); };

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (n: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd !== "show" && cmd !== "init" && cmd !== "set") fail("usage: leash-admin.ts show|init|set --admin <path> [--enable <legs>] [--puller <pubkey>] [--rpc <url>]");

  // Everything that can be refused offline is refused before the key is read or any RPC is made.
  const enable = cmd === "set" ? opt("enable") : undefined;
  if (cmd === "set" && enable === undefined) fail("set needs --enable <comma-separated legs> (the full list that should be on; \"\" for none). Nothing was sent.");
  const enabledLegs = enable !== undefined ? parseLegs(enable) : [];
  const allowSkr = rest.includes(SKR_OVERRIDE_FLAG);
  if (enabledLegs.includes(0) && !allowSkr) assertInstallable(await configFor({ puller: address(PULLER_MAINNET), enabled: enabledLegs }), false);

  const admin = await loadAdmin(opt("admin") ?? "");   // throws before any network call for any other key
  const rpcUrl = opt("rpc") || process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";   // || : an exported-but-empty var falls through
  const rpc = createSolanaRpc(rpcUrl);
  const configPda = await leashConfigPda();
  const readRaw = async (): Promise<Uint8Array | null> => {
    const info = await rpc.getAccountInfo(configPda, { encoding: "base64", commitment: "confirmed" }).send();   // confirmed: sends confirm at "confirmed", so the final read sees them
    // pre-funded (System-owned, empty) = no Config yet; any other foreign owner throws
    return configAccountBytes(info.value ? { owner: info.value.owner, data: new Uint8Array(Buffer.from(info.value.data[0], "base64")) } : null);
  };
  /** A leg init_config left alone (all zero): unusable until its set_leg lands (contracts 2.3). */
  const unset = (raw: Uint8Array, leg: number) => raw.subarray(96 + 176 * leg, 96 + 176 * (leg + 1)).every((b) => b === 0);

  const raw = await readRaw();
  if (cmd === "show") {
    if (!raw) { console.log(`no Config at ${configPda} yet`); process.exit(0); }
    const c = decodeConfig(raw);
    console.log(`Config ${configPda}`);
    console.log(`puller ${c.puller}  puller_usdc ${c.pullerUsdc}  max_pull ${c.maxPullRaw}`);
    c.legs.forEach((l, i) => console.log(unset(raw, i) ? `leg ${i} UNSET (never set: unusable)` : `leg ${i} ${l.enabled ? "ON " : "off"} reader ${l.reader} fee ${l.feeBps} tol ${l.tolBps} conf ${l.confCapBps} age ${l.maxAgeS} receipt ${l.receiptMint} rate ${l.rateAccount} extra ${l.extra} feed ${l.feedId?.slice(0, 8) ?? "-"}`));
    process.exit(0);
  }

  let want: LeashConfig;
  if (cmd === "init") {
    want = await configFor({ puller: address(PULLER_MAINNET), enabled: [] });   // every leg set, every leg off (leash plan: Config at init)
    assertInitSafe(raw, want);   // never undoes enabled legs or a puller rotation
  } else {
    if (!raw) fail("no Config yet: run init first. Nothing was sent.");
    want = await configFor({ puller: address(opt("puller") ?? decodeConfig(raw as Uint8Array).puller), enabled: enabledLegs });
  }
  assertInstallable(want, allowSkr);   // the same leg 0 refusal, on the final target

  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, "ws")) });
  const chain: AdminChain = {
    readRaw,
    latestBlockhash: async () => (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
    simulate: async (wire) => {
      const sim = await rpc.simulateTransaction(wire as Parameters<typeof rpc.simulateTransaction>[0], { encoding: "base64", sigVerify: true, commitment: "confirmed" }).send();
      return { err: sim.value.err, logs: sim.value.logs };
    },
    send: async (tx, ix) => {
      const tag = ix.data?.[0];
      if (tag !== LEASH_IX.initConfig && tag !== LEASH_IX.setHeader && tag !== LEASH_IX.setLeg) fail(`refusing to send an instruction with tag ${tag}`);
      assertIsTransactionWithBlockhashLifetime(tx);
      await sendAndConfirm(tx, { commitment: "confirmed" });
    },
  };
  const { code } = await runAdminSteps({ admin, want, chain });
  return code;
}

// One line per failure, no stack trace (messages never carry key bytes: loadAdmin reports parse failures generically).
main().then((code) => process.exit(code), (e: unknown) => { console.error(`leash-admin: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
