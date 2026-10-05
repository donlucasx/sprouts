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
