import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { address, AccountRole, generateKeyPairSigner, getTransactionDecoder, getBase64Encoder, getCompiledTransactionMessageDecoder, type Instruction, type Blockhash } from "@solana/kit";
import { loadAdmin, legConfigFor, configFor, parseLegs, planAdminSteps, adminIx, adminIxData, adminTxSize, stepName, assertInstallable, runAdminSteps,
  PULLER_MAINNET, MAX_TX_BYTES, SKR_OVERRIDE_FLAG, type AdminChain } from "../../scripts/leash-admin-lib";
import { encodeConfig, encodeHeader, encodeLeg, leashConfigPda, LEG_BYTES } from "@/lib/leash";
import { LEASH_PROGRAM } from "@/lib/constants";

// The leash track's Task 8 files (leash/config/mainnet-{init,day1}.hex + the encoder-only TEST-VECTOR, 2,976 hex chars each) and the built
// program's golden instruction payloads (leash/tests/golden/{init_config,set_leg_0..7,config}.hex). Read-only.
const LEASH_ROOTS = [process.env.LEASH_GOLDEN_DIR && path.resolve(process.env.LEASH_GOLDEN_DIR, "../.."), path.resolve(__dirname, "../../../leash"), "/Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts-leash/leash"].filter(Boolean) as string[];
const leashRoot = LEASH_ROOTS.find((d) => existsSync(path.join(d, "config/mainnet-day1.hex")) && existsSync(path.join(d, "tests/golden/init_config.hex")));
const hex = (rel: string) => readFileSync(path.join(leashRoot as string, rel), "utf8").trim();
const ADMIN = address("GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY");
const OTHER_PULLER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
/** The 1504-byte account as the program stores it: magic, version 1, bump, 6 zero bytes, the body. */
const account = (body: Uint8Array) => new Uint8Array(Buffer.concat([Buffer.from("LEASHCFG"), Buffer.from([1, 255]), Buffer.alloc(6), Buffer.from(body)]));
const ALL_LEGS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const DAY1 = [2, 6, 7] as const;
const throwawayKeyFile = () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "leash-admin-")), "not-admin.json");
  writeFileSync(file, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  return file;
};

describe("leash-admin helpers", () => {
  it("refuses any keypair that is not the Sprouts admin GrHSwzYp... before anything is sent", async () => {
    await expect(loadAdmin(throwawayKeyFile())).rejects.toThrow(/not the Sprouts admin key GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY/);
    await expect(loadAdmin("")).rejects.toThrow(/--admin/);
  });
  it("leg configs carry the amended contracts' values (R324: cbBTC 600 s)", () => {
    expect(legConfigFor(2, true)).toMatchObject({ enabled: true, reader: 3, feeBps: 0, tolBps: 10, confCapBps: 100, maxAgeS: 60, feedId: null, feedAccount: null, receiptMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", rateAccount: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59" });
    expect(legConfigFor(7, false)).toMatchObject({ enabled: false, reader: 0, feeBps: 50, tolBps: 100, maxAgeS: 600, feedId: "2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97", rateAccount: null });
    expect(legConfigFor(1, true)).toMatchObject({ reader: 5, tolBps: 100, maxAgeS: 60, feedId: "142b804c658e14ff60886783e46e5a51bdf398b4871d9d8f7c28aa1585cad504", extra: "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR" });
    expect(legConfigFor(4, true)).toMatchObject({ tolBps: 150, feeBps: 0 });
    expect(parseLegs("2,6,7")).toEqual([2, 6, 7]);
    expect(parseLegs(" 7, 2,2 ")).toEqual([2, 7]);
    expect(parseLegs("")).toEqual([]);
    expect(() => parseLegs("8")).toThrow(/leg/);
    expect(() => parseLegs("x")).toThrow(/leg/);
  });
  it("puller_usdc is the mainnet puller's canonical USDC ATA (= the leash tests' PULLER_MAINNET_USDC 3581Qy3h...)", async () => {
    expect(PULLER_MAINNET).toBe("HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd");
    const c = await configFor({ puller: address(PULLER_MAINNET), enabled: [] });
    expect(c.pullerUsdc).toBe("3581Qy3hmNHiy8gkRPqyvyWoZ4Lt6sXc3jfokDNW6Eap");
    expect(c.maxPullRaw).toBe(5_000_000n);
    // a different puller gets its own ATA, not the mainnet one
    expect((await configFor({ puller: OTHER_PULLER, enabled: [] })).pullerUsdc).not.toBe(c.pullerUsdc);
  });
  it("refuses a target Config with leg 0 (SKR) enabled unless the scary flag is passed", async () => {
    const skr = await configFor({ puller: address(PULLER_MAINNET), enabled: [0, 2, 6, 7] });
    expect(() => assertInstallable(skr, false)).toThrow(/leg 0 \(SKR\) enabled.*Nothing was sent/);
    expect(() => assertInstallable(skr, true)).not.toThrow();
    const day1 = await configFor({ puller: address(PULLER_MAINNET), enabled: DAY1 });
    expect(() => assertInstallable(day1, false)).not.toThrow();
    expect(SKR_OVERRIDE_FLAG).toMatch(/DANGER/);
  });
  it("the CLI refuses --enable with leg 0 offline, before the key is read; with the flag it reaches the key check (still offline)", () => {
    const key = throwawayKeyFile();
    const run = (args: string[]) => {
      try { execFileSync(path.resolve(__dirname, "../../node_modules/.bin/tsx"), ["scripts/leash-admin.ts", ...args], { cwd: path.resolve(__dirname, "../.."), encoding: "utf8", stdio: "pipe", env: { ...process.env, HELIUS_RPC_URL: "" } }); return { code: 0, err: "" }; }
      catch (e) { const x = e as { status: number; stderr: string }; return { code: x.status, err: x.stderr }; }
    };
    // --rpc points at a closed local port: nothing can reach mainnet even if a guard were missing
    const noSkr = run(["set", "--admin", key, "--enable", "0,2,6,7", "--rpc", "http://127.0.0.1:9"]);
    expect(noSkr.code).not.toBe(0);
    expect(noSkr.err).toMatch(/leg 0 \(SKR\) enabled/);
    expect(noSkr.err).not.toMatch(/not the Sprouts admin key/);
    const withFlag = run(["set", "--admin", key, "--enable", "0,2,6,7", SKR_OVERRIDE_FLAG, "--rpc", "http://127.0.0.1:9"]);
    expect(withFlag.code).not.toBe(0);
    expect(withFlag.err).toMatch(/not the Sprouts admin key/);
    expect(withFlag.err).not.toMatch(/leg 0 \(SKR\)/);
  }, 60_000);
  it.skipIf(!leashRoot)("encodes byte for byte the leash track's installable bodies (init, day1) and the encoder vector, and the step payloads rebuild them", async () => {
    for (const [file, legs] of [["config/mainnet-init.hex", []], ["config/mainnet-day1.hex", DAY1], ["config/TEST-VECTOR-all-legs-NEVER-INSTALL.hex", ALL_LEGS]] as const) {
      const want = await configFor({ puller: address(PULLER_MAINNET), enabled: legs });
      const golden = hex(file);
      expect(Buffer.from(encodeConfig(want)).toString("hex"), file).toBe(golden);
      // what the program writes from the golden path's payloads: init's header, then each set_leg's 176 bytes
      const steps = planAdminSteps(null, want);
      const rebuilt = Buffer.concat(steps.map((s) => Buffer.from(adminIxData(s, want)).subarray(s.kind === "leg" ? 2 : 1)));
      expect(rebuilt.toString("hex"), `${file} rebuilt from the steps`).toBe(golden);
    }
    // the only installable target: day1 has leg 0 off
    expect((await configFor({ puller: address(PULLER_MAINNET), enabled: DAY1 })).legs[0].enabled).toBe(false);
  });
  it.skipIf(!leashRoot)("matches the BUILT program's golden instruction payloads: init_config, set_leg 0..7, config", async () => {
    const day1 = await configFor({ puller: address(PULLER_MAINNET), enabled: DAY1 });
    const init = hex("tests/golden/init_config.hex");
    expect(init.length).toBe(162);
    expect(Buffer.from(encodeHeader(day1)).toString("hex")).toBe(init.slice(2));
    expect(Buffer.from(adminIxData({ kind: "init" }, day1)).toString("hex")).toBe(init);
    for (const n of LEG_BYTES) {
      const g = hex(`tests/golden/set_leg_${n}.hex`);
      expect(g.length, `set_leg_${n}`).toBe(356);
      expect(Buffer.from(encodeLeg(n, day1.legs[n])).toString("hex"), `encodeLeg(${n})`).toBe(g.slice(4));
      expect(Buffer.from(adminIxData({ kind: "leg", leg: n }, day1)).toString("hex"), `set_leg ${n}`).toBe(g);
    }
    expect(Buffer.from(encodeConfig(day1)).toString("hex")).toBe(hex("tests/golden/config.hex"));
  });
  it("plans one step per changed part, from the chain's bytes (init, resume, enable, rotate, nothing)", async () => {
    const off = await configFor({ puller: address(PULLER_MAINNET), enabled: [] });
    const day1 = await configFor({ puller: address(PULLER_MAINNET), enabled: DAY1 });
    const rotated = await configFor({ puller: OTHER_PULLER, enabled: DAY1 });
    expect(planAdminSteps(null, off).map(stepName)).toEqual(["init_config", ...ALL_LEGS.map((l) => `set_leg ${l}`)]);
    const headerOnly = account(new Uint8Array(Buffer.concat([Buffer.from(encodeHeader(off)), Buffer.alloc(176 * 8)])));   // init landed, no set_leg yet
    expect(planAdminSteps(headerOnly, off).map(stepName)).toEqual(ALL_LEGS.map((l) => `set_leg ${l}`));
    expect(planAdminSteps(account(encodeConfig(off)), day1).map(stepName)).toEqual(["set_leg 2", "set_leg 6", "set_leg 7"]);
    expect(planAdminSteps(account(encodeConfig(day1)), rotated).map(stepName)).toEqual(["set_header"]);
    expect(planAdminSteps(account(encodeConfig(day1)), day1)).toEqual([]);
    expect(() => planAdminSteps(new Uint8Array(1503), day1)).toThrow(/1503/);
  });
  it("builds the contracts 2.5 instructions: tags, lengths, accounts", async () => {
    const c = await configFor({ puller: address(PULLER_MAINNET), enabled: DAY1 });
    const init = await adminIx({ admin: ADMIN, step: { kind: "init" }, config: c });
    expect(init.programAddress).toBe(LEASH_PROGRAM);
    expect([init.data!.length, init.data![0]]).toEqual([81, 2]);
    expect(init.accounts!.map((a) => [a.address, a.role])).toEqual([[ADMIN, AccountRole.WRITABLE_SIGNER], [await leashConfigPda(), AccountRole.WRITABLE], ["11111111111111111111111111111111", AccountRole.READONLY]]);
    const hdr = await adminIx({ admin: ADMIN, step: { kind: "header" }, config: c });
    expect([hdr.data!.length, hdr.data![0], hdr.accounts!.length]).toEqual([81, 4, 2]);
    expect(hdr.accounts!.map((a) => [a.address, a.role])).toEqual([[ADMIN, AccountRole.READONLY_SIGNER], [await leashConfigPda(), AccountRole.WRITABLE]]);
    const leg = await adminIx({ admin: ADMIN, step: { kind: "leg", leg: 7 }, config: c });
    expect([leg.data!.length, leg.data![0], leg.data![1], leg.accounts!.length]).toEqual([178, 5, 7, 2]);
  });
  it("every admin tx fits 1,232 bytes (litesvm does not check; mainnet does): 371 / 338 / 436 B; the retired full-body ix does not", async () => {
    const c = await configFor({ puller: address(PULLER_MAINNET), enabled: [0, 1, 2, 3, 4, 5, 6, 7] });
    const steps = [...planAdminSteps(null, c), { kind: "header" } as const];
    const sizes = await Promise.all(steps.map(async (step) => adminTxSize(ADMIN, await adminIx({ admin: ADMIN, step, config: c }))));
    expect(sizes).toEqual([371, ...ALL_LEGS.map(() => 436), 338]);
    for (const n of sizes) expect(n).toBeLessThanOrEqual(MAX_TX_BYTES);
    // negative control (the old contracts problem 1): [3][config bytes 16..1504] = 1,489 B of data
    const old = { ...(await adminIx({ admin: ADMIN, step: { kind: "header" }, config: c })), data: new Uint8Array([3, ...encodeConfig(c)]) } as Instruction;
    expect(adminTxSize(ADMIN, old)).toBe(1747);
    expect(adminTxSize(ADMIN, old)).toBeGreaterThan(MAX_TX_BYTES);
  });
});

/**
 * An in-memory leash program behind the AdminChain seam: simulate decodes the signed wire tx (fee payer must be the signer, signature
 * present, last ix = the leash program), send applies the admin ix the way contracts 2.5 says the program writes it.
 */
function mockChain(o: { failSimAt?: number; corrupt?: boolean } = {}) {
  let acct: Uint8Array | null = null;
  let sims = 0;
  const log: string[] = [];
  const simulated: string[] = [];
  const chain: AdminChain = {
    readRaw: async () => (acct ? new Uint8Array(acct) : null),
    latestBlockhash: async () => ({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" as Blockhash, lastValidBlockHeight: 100n }),
    simulate: async (wire) => {
      sims++;
      const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
      const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
      const payer = msg.staticAccounts[0];
      const ixs = (msg as unknown as { instructions: { programAddressIndex: number }[] }).instructions;
      simulated.push(`${payer}:${tx.signatures[payer] ? "signed" : "unsigned"}:${ixs.length}:${msg.staticAccounts[ixs[2].programAddressIndex]}`);
      return sims === o.failSimAt ? { err: { InstructionError: [2, { Custom: 6 }] }, logs: ["Program log: refused"] } : { err: null, logs: [] };
    },
    send: async (_tx, ix) => {
      const d = ix.data as Uint8Array;
      if (d[0] === 2) { if (acct) throw new Error("already initialised"); acct = account(new Uint8Array(Buffer.concat([Buffer.from(d.subarray(1)), Buffer.alloc(176 * 8)]))); }
      else if (!acct) throw new Error("no config");
      else if (d[0] === 4) acct.set(d.subarray(1), 16);
      else if (d[0] === 5) acct.set(d.subarray(2), 96 + 176 * d[1]);
      else throw new Error(`tag ${d[0]}`);
      if (o.corrupt) acct[1500] = 0xee;   // a stray write in leg 7's feed_account after every send
    },
  };
  return { chain, log, simulated, raw: () => acct };
}

describe("leash-admin run (size check, simulate, send, resume, final byte comparison) against an in-memory program", () => {
  it("init from nothing: 9 txs, each simulated signed before it is sent, then the final read equals encodeConfig", async () => {
    const admin = await generateKeyPairSigner();
    const want = await configFor({ puller: address(PULLER_MAINNET), enabled: [] });
    const m = mockChain();
    const r = await runAdminSteps({ admin, want, chain: m.chain, log: (s) => m.log.push(s) });
    expect(r).toEqual({ code: 0, sent: ["init_config", ...ALL_LEGS.map((l) => `set_leg ${l}`)] });
    expect(m.simulated).toEqual(Array(9).fill(`${admin.address}:signed:3:${LEASH_PROGRAM}`));
    expect(Buffer.from(m.raw()!.subarray(16)).toString("hex")).toBe(Buffer.from(encodeConfig(want)).toString("hex"));
    expect(m.log.at(-1)).toMatch(/Config matches/);
    // the same command again: nothing to do
    expect(await runAdminSteps({ admin, want, chain: m.chain, log: () => {} })).toEqual({ code: 0, sent: [] });
  });
  it("a failed simulation stops before that send; the rerun resumes from the chain and finishes", async () => {
    const admin = await generateKeyPairSigner();
    const want = await configFor({ puller: address(PULLER_MAINNET), enabled: [] });
    const m = mockChain({ failSimAt: 4 });
    const first = await runAdminSteps({ admin, want, chain: m.chain, log: (s) => m.log.push(s) });
    expect(first).toEqual({ code: 1, sent: ["init_config", "set_leg 0", "set_leg 1"] });
    expect(m.log.at(-1)).toMatch(/step 4\/9 set_leg 2: simulation FAILED .*Custom.*rerun the same command to resume/);
    const second = await runAdminSteps({ admin, want, chain: m.chain, log: () => {} });
    expect(second).toEqual({ code: 0, sent: [2, 3, 4, 5, 6, 7].map((l) => `set_leg ${l}`) });
  });
  it("set: enabling day1 then rotating the puller send only the changed parts", async () => {
    const admin = await generateKeyPairSigner();
    const m = mockChain();
    await runAdminSteps({ admin, want: await configFor({ puller: address(PULLER_MAINNET), enabled: [] }), chain: m.chain, log: () => {} });
    expect((await runAdminSteps({ admin, want: await configFor({ puller: address(PULLER_MAINNET), enabled: DAY1 }), chain: m.chain, log: () => {} })).sent).toEqual(["set_leg 2", "set_leg 6", "set_leg 7"]);
    expect((await runAdminSteps({ admin, want: await configFor({ puller: OTHER_PULLER, enabled: DAY1 }), chain: m.chain, log: () => {} })).sent).toEqual(["set_header"]);
  });
  it("a tx over the size limit stops before it is signed or simulated", async () => {
    const admin = await generateKeyPairSigner();
    const m = mockChain();
    const r = await runAdminSteps({ admin, want: await configFor({ puller: address(PULLER_MAINNET), enabled: [] }), chain: m.chain, log: (s) => m.log.push(s), maxTxBytes: 400 });
    expect(r).toEqual({ code: 2, sent: ["init_config"] });
    expect(m.simulated).toHaveLength(1);
    expect(m.log.at(-1)).toMatch(/step 2\/9 set_leg 0: the tx is 436 bytes, over/);
  });
  it("a final read that differs from encodeConfig(want) fails with code 3", async () => {
    const admin = await generateKeyPairSigner();
    const m = mockChain({ corrupt: true });
    const r = await runAdminSteps({ admin, want: await configFor({ puller: address(PULLER_MAINNET), enabled: [] }), chain: m.chain, log: (s) => m.log.push(s) });
    expect(r.code).toBe(3);
    expect(m.log.at(-1)).toMatch(/does not equal/);
  });
});
