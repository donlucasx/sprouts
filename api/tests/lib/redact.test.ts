import { describe, it, expect, afterEach, vi } from "vitest";
import { redact, errorText } from "@/lib/redact";

// K-M10: HELIUS_RPC_URL carries the key as a query parameter. A fake URL (no real key anywhere in this file).
const FAKE = "https://rpc.example.test/?api-key=FAKEKEY-0000-1111";

describe("redact (K-M10): an error string that can carry HELIUS_RPC_URL never reaches a log or a body with the key", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
  it("removes any api-key= value, the configured URL itself, and keeps the rest of the message", () => {
    vi.stubEnv("HELIUS_RPC_URL", FAKE);
    expect(redact(`TypeError: Failed to parse URL from ${FAKE}`)).toBe("TypeError: Failed to parse URL from [rpc url]");
    expect(redact("GET https://other.example/v1?x=1&api-key=abc123&y=2 failed")).toBe("GET https://other.example/v1?x=1&api-key=[redacted]&y=2 failed");
    expect(redact(`wss://rpc.example.test/?api-key=FAKEKEY-0000-1111 closed`)).not.toContain("FAKEKEY");
    expect(redact("nothing secret here")).toBe("nothing secret here");
  });
  it("residual O3: the Helius webhook URL's api key (HELIUS_API_KEY) is redacted, in the URL and bare", () => {
    vi.stubEnv("HELIUS_API_KEY", "FAKEHOOKKEY-9999");
    expect(redact("PUT https://api.helius.xyz/v0/webhooks/hook-1?api-key=FAKEHOOKKEY-9999 failed")).toBe("PUT https://api.helius.xyz/v0/webhooks/hook-1?api-key=[redacted] failed");
    expect(redact("key FAKEHOOKKEY-9999 echoed")).toBe("key [redacted] echoed");
    expect(errorText(new Error("fetch failed", { cause: new Error("bad https://api.helius.xyz/v0/webhooks/x?api-key=FAKEHOOKKEY-9999") }))).not.toContain("FAKEHOOKKEY");
  });
  it("errorText: the message and its cause, both redacted", () => {
    vi.stubEnv("HELIUS_RPC_URL", FAKE);
    const e = new Error("fetch failed", { cause: new Error(`connect ECONNREFUSED ${FAKE}`) });
    expect(errorText(e)).toBe("fetch failed (connect ECONNREFUSED [rpc url])");
  });
  it("an RPC call whose fetch throws with the URL in its message rejects without the key (the transport redacts)", async () => {
    vi.stubEnv("HELIUS_RPC_URL", FAKE);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { throw new TypeError(`Failed to parse URL from ${url}`); }));
    const { rpc } = await import("@/lib/rpc");
    const err = await rpc().getSlot().send().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(errorText(err)).not.toContain("FAKEKEY");
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err as object))).not.toContain("FAKEKEY");
  });
});

describe("sendFailureText (11-01, Kimi MED: a refused link approval says why)", async () => {
  const { sendFailureText } = await import("@/lib/redact");
  it("reads the reason from a kit error's context, not its bare production message", () => {
    const e = Object.assign(new Error("Solana error #-32002; Decode this error by running ..."), {
      context: { err: { InstructionError: [2, { Custom: 1 }] }, logs: ["Program X invoke [1]", "Program log: Error: insufficient funds", "Program X failed"] },
    });
    expect(sendFailureText(e)).toBe('{"InstructionError":[2,{"Custom":1}]}; Program log: Error: insufficient funds');
  });
  it("names the transaction error kit puts on `cause` when the context has no err and no logs (11-23 carousel links)", () => {
    const cause = Object.assign(new Error("Solana error #7050003"), { context: { __code: 7050003 } });
    const e = Object.assign(new Error("Solana error #-32002; Decode this error by running ...", { cause }), {
      context: { __code: -32002, accounts: null, fee: null, logs: null },
    });
    expect(sendFailureText(e)).toBe("transaction error #7050003");
  });
  it("keeps the context's own err and logs first when they are there, and adds no cause line then", () => {
    const cause = Object.assign(new Error("x"), { context: { __code: 7050003 } });
    const e = Object.assign(new Error("Solana error #-32002", { cause }), {
      context: { err: "BlockhashNotFound", logs: ["Program log: hello"] },
    });
    expect(sendFailureText(e)).toBe("BlockhashNotFound; Program log: hello");
  });
  it("redacts a key and stays short", () => {
    const e = new Error(`fetch failed https://rpc.example/?api-key=SECRETSECRET ${"x".repeat(300)}`);
    const t = sendFailureText(e);
    expect(t).not.toContain("SECRETSECRET");
    expect(t.length).toBeLessThanOrEqual(140);
  });
});

describe("sendFailureDetail (11-23: the whole send failure for the log)", async () => {
  const { sendFailureDetail } = await import("@/lib/redact");
  it("walks the cause chain with each context, redacted and capped", () => {
    const cause = Object.assign(new Error("Solana error #7050003"), { context: { __code: 7050003 } });
    const e = Object.assign(new Error("Solana error #-32002 https://rpc.example/?api-key=SECRETSECRET", { cause }), {
      context: { __code: -32002, logs: ["Program log: x"], unitsConsumed: 10n },
    });
    const d = sendFailureDetail(e);
    expect(d).toContain('"logs":["Program log: x"]');
    expect(d).toContain('"unitsConsumed":"10"');
    expect(d).toContain("cause1:");
    expect(d).toContain('"__code":7050003');
    expect(d).not.toContain("SECRETSECRET");
    expect(sendFailureDetail(new Error("x".repeat(5000))).length).toBeLessThanOrEqual(2000);
  });
});

describe("sendFailureText puts the cause code after the log line (11-23 Kimi day review)", async () => {
  const { sendFailureText } = await import("@/lib/redact");
  it("log line first, then the transaction error code", () => {
    const cause = Object.assign(new Error("x"), { context: { __code: 7050003 } });
    const e = Object.assign(new Error("Solana error #-32002", { cause }), { context: { logs: ["Program log: Error: insufficient funds"] } });
    expect(sendFailureText(e)).toBe("Program log: Error: insufficient funds; transaction error #7050003");
  });
});
