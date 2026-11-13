import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST, DELETE } from "@/app/api/ops/login/route";
import { verifyOpsCookie } from "@/lib/ops/auth";

const PW = "pw-for-tests";
const SECRET = "secret-for-tests";
const saved = { pw: process.env.OPS_PASSWORD, secret: process.env.OPS_SECRET, vercel: process.env.VERCEL };
let n = 0;
let ip = "";

const post = (body: unknown, raw = false) =>
  POST(new Request("http://x/api/ops/login", { method: "POST", headers: { "x-real-ip": ip, "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }));

beforeEach(() => {
  process.env.OPS_PASSWORD = PW;
  process.env.OPS_SECRET = SECRET;
  process.env.VERCEL = "1"; // so clientIp reads x-real-ip and each test gets its own rate-limit bucket
  ip = `10.0.0.${++n}`;
});
afterEach(() => {
  for (const [k, v] of [["OPS_PASSWORD", saved.pw], ["OPS_SECRET", saved.secret], ["VERCEL", saved.vercel]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("POST /api/ops/login", () => {
  it("404 when OPS_PASSWORD or OPS_SECRET is unset", async () => {
    for (const k of ["OPS_PASSWORD", "OPS_SECRET"]) {
      const was = process.env[k];
      delete process.env[k];
      const r = await post({ password: PW });
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "Not found." });
      process.env[k] = was;
    }
  });

  it("400 on an unparseable body", async () => {
    const r = await post("not json", true);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Bad request." });
    expect((await post({ nope: 1 })).status).toBe(401);
  });

  it("401 on a wrong password, with no cookie", async () => {
    const r = await post({ password: "wrong" });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Wrong password." });
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("204 and a signed HttpOnly cookie on the right password", async () => {
    const r = await post({ password: PW });
    expect(r.status).toBe(204);
    const c = r.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/^sprouts_ops=\d+\.[0-9a-f]{64};/);
    for (const a of ["HttpOnly", "Secure", "SameSite=strict", "Path=/", "Max-Age=2592000"]) expect(c.toLowerCase()).toContain(a.toLowerCase());
    expect(c).not.toMatch(/domain=/i);
    const value = c.split(";")[0].slice("sprouts_ops=".length);
    expect(verifyOpsCookie(value, Date.now())).toBe(true);
  });

  it("429 on the 6th attempt within an hour", async () => {
    for (let i = 0; i < 5; i++) expect((await post({ password: "wrong" })).status).toBe(401);
    const r = await post({ password: PW });
    expect(r.status).toBe(429);
  });
});

describe("DELETE /api/ops/login", () => {
  it("clears the cookie with Max-Age=0", async () => {
    const r = await DELETE();
    expect(r.status).toBe(204);
    const c = r.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/^sprouts_ops=;/);
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Path=/");
    expect(c).not.toMatch(/domain=/i);
  });
});
