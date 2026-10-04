import { describe, it, expect, afterEach } from "vitest";
import { clientIp, rateLimited } from "@/lib/auth-guard";

// Security R207 #7: the limits key on the address the platform saw, never on a header prefix the client wrote.
describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/api/auth/nonce", { headers });
  const was = process.env.VERCEL;
  afterEach(() => {
    if (was === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = was;
  });

  it("on Vercel, reads x-real-ip, which the platform sets", () => {
    process.env.VERCEL = "1";
    expect(clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
  });

  it("on Vercel without x-real-ip, a forwarded list yields its LAST hop, never the client-written prefix", () => {
    process.env.VERCEL = "1";
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "7.7.7.7, 203.0.113.7" }))).toBe("203.0.113.7");   // a rotated prefix, same bucket
  });

  it("off Vercel no header is trusted: every caller shares one bucket", () => {
    delete process.env.VERCEL;
    expect(clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("local");
  });
});

describe("rateLimited", () => {
  it("lets `limit` calls through per window, then refuses, per key", () => {
    const key = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimited(key, 3)).toBe(false);
    expect(rateLimited(key, 3)).toBe(true);
    expect(rateLimited(`${key}:other`, 3)).toBe(false);
  });
});
