import { describe, it, expect } from "vitest";
import { parseArgs, parseLeg, needsPost, runLeg, exitCode, headroom, leashErrorOf, sizeFromError, accountLocks, type Built, type LegDeps, type Leg, type Sim } from "../../scripts/simulate-legs-lib";
import { address, appendTransactionMessageInstructions, compileTransaction, createNoopSigner, createTransactionMessage, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, AccountRole, type Blockhash } from "@solana/kit";

const A = "DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR";
const W = "887dEPR85vfSZ45zFrxttJ6cLomwvnYbh5HnyGbTAXVu";
const P = "GXcd5FZoxQKQm78CCzUzv7sfsL197CxCjt2eCD4ZRrgz";
const base = ["--user", A, "--wallet", W, "--delegation", P];

describe("parseArgs", () => {
  it("reads the addresses, the legs, and defaults: unleashed, pull 1 USDC, no-post ON", () => {
    const o = parseArgs([...base, "cbBTC", "USDC_LEND:jupiter_lend"]);
    expect(o).toMatchObject({ user: A, wallet: W, delegation: P, leashed: false, pullRaw: 1_000_000n, noPost: true, sizeOnly: false });
    expect(o.legs).toEqual([{ name: "cbBTC", asset: "cbBTC", venue: null }, { name: "USDC_LEND:jupiter_lend", asset: "USDC_LEND", venue: "jupiter_lend" }]);
  });
  it("never takes a flag's value for a leg", () => {
    const o = parseArgs(["--pull", "500000", ...base, "--leashed", "hSOL", "--size-only"]);
    expect(o.legs.map((l) => l.name)).toEqual(["hSOL"]);
    expect(o).toMatchObject({ leashed: true, sizeOnly: true, pullRaw: 500_000n });
  });
  it("no-post stays ON with --no-post and turns off only with --allow-post", () => {
    expect(parseArgs([...base, "--no-post", "hSOL"]).noPost).toBe(true);
    expect(parseArgs([...base, "--allow-post", "hSOL"]).noPost).toBe(false);
    expect(() => parseArgs([...base, "--allow-post", "--no-post", "hSOL"])).toThrow(/contradict/);
  });
  it("refuses unknown flags, missing or bad addresses, a bad pull, no legs, a repeated leg", () => {
    expect(() => parseArgs([...base, "--leash", "hSOL"])).toThrow(/unknown flag --leash/);
    expect(() => parseArgs(["--user", A, "--wallet", W, "hSOL"])).toThrow(/--delegation/);
    expect(() => parseArgs(["--user", "nope", "--wallet", W, "--delegation", P, "hSOL"])).toThrow(/base58/);
    expect(() => parseArgs([...base, "--pull", "0", "hSOL"])).toThrow(/--pull/);
    expect(() => parseArgs([...base, "--pull", "1.5", "hSOL"])).toThrow(/--pull/);
    expect(() => parseArgs([...base, "--pull"])).toThrow(/needs a value/);
    expect(() => parseArgs(base)).toThrow(/at least one leg/);
    expect(() => parseArgs([...base, "hSOL", "hSOL"])).toThrow(/twice/);
  });
});

describe("parseLeg", () => {
  it("needs a venue on a lending leg and refuses one on a coin leg", () => {
    expect(() => parseLeg("USDC_LEND")).toThrow(/needs a venue/);
    expect(() => parseLeg("hSOL:kamino_klend")).toThrow(/takes no venue/);
    expect(() => parseLeg("JitoSOL")).toThrow(/unknown leg/);
    expect(() => parseLeg("SOL_LEND:marginfi")).toThrow(/unknown leg/);
    expect(() => parseLeg("SOL_LEND:kamino_klend:x")).toThrow(/unknown leg/);
    expect(parseLeg("SOL_LEND:kamino_klend")).toEqual({ name: "SOL_LEND:kamino_klend", asset: "SOL_LEND", venue: "kamino_klend" });
  });
});

describe("needsPost", () => {
  it("unleashed never posts; leashed SKR always does (no source, R324); others only on a live 'post'", () => {
    expect(needsPost(parseLeg("SKR"), false)).toBe(false);
    expect(needsPost(parseLeg("SKR"), true)).toBe(true);
    expect(needsPost(parseLeg("hSOL"), true, "sponsored")).toBe(false);
    expect(needsPost(parseLeg("hSOL"), true, "post")).toBe(true);
    expect(needsPost(parseLeg("USDC_LEND:kamino_klend"), true, "none")).toBe(false);
  });
});

const built = (over: Partial<Built> = {}): Built => ({ sizeBytes: 1100, locks: 40, minOut: 123n, cleanupCount: 0, ...over });
function deps(o: { builds?: ((jl: 0n | 1n | undefined) => Built | Error)[]; sims?: Sim[]; guard?: (s: Sim) => string | null; source?: "none" | "sponsored" | "post" | Error } = {}) {
  const calls = { build: [] as (0n | 1n | undefined)[], sim: 0, cleanup: 0, logs: [] as string[], source: 0 };
  let bi = 0;
  let si = 0;
  const d: LegDeps = {
    priceSource: async () => { calls.source++; if (o.source instanceof Error) throw o.source; return o.source ?? "sponsored"; },
    build: async (_l: Leg, jl) => { calls.build.push(jl); const f = o.builds?.[bi++] ?? (() => built()); const r = f(jl); if (r instanceof Error) throw r; return r; },
    simulate: async () => { calls.sim++; return o.sims?.[si++] ?? { ok: true, units: 150_000, logs: [] }; },
    guard: o.guard ?? (() => null),
    cleanup: async () => { calls.cleanup++; },
    log: (l) => calls.logs.push(l),
  };
  return { d, calls };
}
const unleashed = { leashed: false, noPost: true, sizeOnly: false };

describe("runLeg", () => {
  it("a coin leg: one build, one simulation, the brief's line with locks, no cleanup under no-post", async () => {
    const { d, calls } = deps();
    const r = await runLeg(parseLeg("hSOL"), unleashed, d);
    expect(r.status).toBe("ok");
    expect(r.line).toBe("LEG hSOL unleashed size=1100 ok=true units=150000 guard=null leashError=null minOut=123 locks=40");
    expect(calls.build).toEqual([undefined]);
    expect(calls.cleanup).toBe(0);
  });
  it("Jupiter Lend: jlLeftover 0 passes first, 1 is never tried", async () => {
    const { d, calls } = deps();
    const r = await runLeg(parseLeg("USDC_LEND:jupiter_lend"), unleashed, d);
    expect(calls.build).toEqual([0n]);
    expect(r).toMatchObject({ status: "ok", jlLeftover: 0n });
    expect(r.line).toContain("jlLeftover=0");
  });
  it("Jupiter Lend: 0 fails its delivery guard, 1 passes; the line names 1 and the 0 attempt is logged", async () => {
    const { d, calls } = deps({ guard: (() => { let n = 0; return () => (n++ === 0 ? "jl account not closed" : null); })() });
    const r = await runLeg(parseLeg("SOL_LEND:jupiter_lend"), unleashed, d);
    expect(calls.build).toEqual([0n, 1n]);
    expect(r).toMatchObject({ status: "ok", jlLeftover: 1n });
    expect(r.line).toContain("ok=true");
    expect(r.line).toContain("jlLeftover=1");
    expect(calls.logs[0]).toContain("jlLeftover=0");
    expect(calls.logs[0]).toContain("guard=jl account not closed");
  });
  it("Jupiter Lend: 0 build throws, 1 passes", async () => {
    const { d, calls } = deps({ builds: [() => new Error("leftover mismatch"), () => built()] });
    const r = await runLeg(parseLeg("USDC_LEND:jupiter_lend"), unleashed, d);
    expect(calls.build).toEqual([0n, 1n]);
    expect(r.status).toBe("ok");
    expect(calls.logs[0]).toContain("build failed jlLeftover=0: leftover mismatch");
  });
  it("Jupiter Lend: both fail, the leg fails with the last attempt's line and the logs", async () => {
    const bad: Sim = { ok: false, units: 9, logs: ["a", "b", "Program x failed: custom program error: 0x1778"] };
    const { d } = deps({ sims: [bad, bad] });
    const r = await runLeg(parseLeg("USDC_LEND:jupiter_lend"), unleashed, d);
    expect(r.status).toBe("fail");
    expect(r.line).toContain("jlLeftover=1");
    expect(r.line).toContain("leashError=BelowFloor");
    expect(r.line).toContain("logs: a | b |");
  });
  it("a K-Lend leg is never retried", async () => {
    const { d, calls } = deps({ sims: [{ ok: false, units: 1, logs: [] }] });
    const r = await runLeg(parseLeg("USDC_LEND:kamino_klend"), unleashed, d);
    expect(calls.build).toEqual([undefined]);
    expect(r.status).toBe("fail");
  });
  it("an over-size build reports the size from the refusal", async () => {
    const { d } = deps({ builds: [() => new Error("SOL_LEND planting is 1240 bytes, over 1232")] });
    const r = await runLeg(parseLeg("SOL_LEND:kamino_klend"), unleashed, d);
    expect(r).toMatchObject({ status: "fail", sizeBytes: 1240 });
    expect(r.line).toContain("size=1240 build failed");
  });
  it("no-post: leashed SKR is skipped before any build or price read", async () => {
    const { d, calls } = deps();
    const r = await runLeg(parseLeg("SKR"), { leashed: true, noPost: true, sizeOnly: false }, d);
    expect(r).toMatchObject({ status: "skipped", line: "LEG SKR leashed skipped=needs-post" });
    expect(calls.build).toEqual([]);
    expect(calls.source).toBe(0);
  });
  it("no-post: a leashed leg whose live source answers post is skipped before the build", async () => {
    const { d, calls } = deps({ source: "post" });
    const r = await runLeg(parseLeg("cbBTC"), { leashed: true, noPost: true, sizeOnly: false }, d);
    expect(r.line).toBe("LEG cbBTC leashed skipped=needs-post");
    expect(calls.build).toEqual([]);
  });
  it("no-post: a stale sponsored price (the source throws) is a skip, not a send", async () => {
    const { d, calls } = deps({ source: new Error("sponsored SOL price is 50 s old") });
    const r = await runLeg(parseLeg("hSOL"), { leashed: true, noPost: true, sizeOnly: false }, d);
    expect(r.status).toBe("skipped");
    expect(r.line).toContain("skipped=no-price (sponsored SOL price is 50 s old)");
    expect(calls.build).toEqual([]);
  });
  it("no-post: a build that posted anyway stops the run, and cleanup is never called", async () => {
    const { d, calls } = deps({ builds: [() => built({ cleanupCount: 2 })] });
    await expect(runLeg(parseLeg("hSOL"), { leashed: true, noPost: true, sizeOnly: false }, d)).rejects.toThrow(/posted a price under --no-post/);
    expect(calls.cleanup).toBe(0);
    expect(calls.sim).toBe(0);
  });
  it("allow-post: cleanup runs after the simulation and a cleanup failure is only logged", async () => {
    const { d, calls } = deps();
    d.cleanup = async () => { calls.cleanup++; throw new Error("rpc down"); };
    const r = await runLeg(parseLeg("SKR"), { leashed: true, noPost: false, sizeOnly: false }, d);
    expect(r.status).toBe("ok");
    expect(calls.cleanup).toBe(1);
    expect(calls.logs).toEqual(["  price cleanup failed: rpc down"]);
  });
  it("size-only: built and measured, never simulated", async () => {
    const { d, calls } = deps();
    const r = await runLeg(parseLeg("USDC_LEND:kamino_klend"), { leashed: true, noPost: true, sizeOnly: true }, d);
    expect(r).toMatchObject({ status: "built", sizeBytes: 1100, locks: 40, units: null });
    expect(r.line).toBe("LEG USDC_LEND:kamino_klend leashed size=1100 locks=40 ok=n/a (built, not simulated) minOut=123");
    expect(calls.sim).toBe(0);
  });
});

describe("exitCode", () => {
  it("1 on any failure, 2 on a skip without failure, 0 otherwise", () => {
    expect(exitCode([{ status: "ok" }, { status: "built" }])).toBe(0);
    expect(exitCode([{ status: "ok" }, { status: "skipped" }])).toBe(2);
    expect(exitCode([{ status: "skipped" }, { status: "fail" }])).toBe(1);
    expect(exitCode([])).toBe(0);
  });
});

describe("helpers", () => {
  it("leashErrorOf names leash and Subscriptions codes, hex otherwise, null without one", () => {
    expect(leashErrorOf(["custom program error: 0x177f"])).toBe("LegDisabled");
    expect(leashErrorOf(["custom program error: 0x190"])).toBe("Subscriptions: AmountExceedsPeriodLimit");
    expect(leashErrorOf(["custom program error: 0x1"])).toBe("0x1");
    expect(leashErrorOf(["fine"])).toBeNull();
  });
  it("sizeFromError reads buildPlantingTx's refusal only", () => {
    expect(sizeFromError("hSOL planting is 1301 bytes, over 1232")).toBe(1301);
    expect(sizeFromError("other")).toBeNull();
  });
  it("headroom names the worst size and lock count", () => {
    expect(headroom([
      { name: "a", status: "ok", line: "", sizeBytes: 1000, locks: 50, units: 1, jlLeftover: null },
      { name: "b", status: "ok", line: "", sizeBytes: 1200, locks: 30, units: 1, jlLeftover: null },
      { name: "c", status: "skipped", line: "", sizeBytes: null, locks: null, units: null, jlLeftover: null },
    ])).toBe("HEADROOM worst size b 1200/1232 B (32 B left); worst locks a 50/64 (14 left)");
    expect(headroom([])).toBe("HEADROOM none built");
  });
  it("accountLocks counts the static keys of a compiled message", () => {
    const payer = createNoopSigner(address(W));
    const tx = compileTransaction(pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 1n }, m),
      (m) => appendTransactionMessageInstructions([{ programAddress: address(P), accounts: [{ address: address(A), role: AccountRole.WRITABLE }] }], m)));
    expect(accountLocks(new Uint8Array(tx.messageBytes))).toBe(3);
  });
});

describe("--assume-alt", () => {
  it("implies size-only and labels the line as computed", async () => {
    const o = parseArgs([...base, "--assume-alt", "SOL_LEND:jupiter_lend"]);
    expect(o).toMatchObject({ assumeAlt: true, sizeOnly: true });
    const { d, calls } = deps();
    const r = await runLeg(o.legs[0], o, d);
    expect(r.line).toBe("LEG SOL_LEND:jupiter_lend unleashed size=1100 locks=40 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=123 jlLeftover=0");
    expect(calls.sim).toBe(0);
  });
});
