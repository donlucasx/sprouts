import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { opsTokenOk, opsPasswordOk, signOpsCookie, verifyOpsCookie, OPS_COOKIE, OPS_COOKIE_MAX_AGE_S } from "@/lib/ops/auth";

const saved = { t: process.env.OPS_TOKEN, p: process.env.OPS_PASSWORD, s: process.env.OPS_SECRET };
const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
beforeEach(() => {
  process.env.OPS_TOKEN = "tok-for-tests";
  process.env.OPS_PASSWORD = "pw-for-tests";
  process.env.OPS_SECRET = "secret-for-tests";
});
afterEach(() => {
  restore("OPS_TOKEN", saved.t);
  restore("OPS_PASSWORD", saved.p);
  restore("OPS_SECRET", saved.s);
});

describe("ops auth", () => {
  it("constants", () => {
    expect(OPS_COOKIE).toBe("sprouts_ops");
    expect(OPS_COOKIE_MAX_AGE_S).toBe(7 * 24 * 3600);
  });
  it("token: unset is false, right is true, wrong or wrong length or null is false", () => {
    expect(opsTokenOk("Bearer tok-for-tests")).toBe(true);
    expect(opsTokenOk("Bearer tok-for-testz")).toBe(false);
    expect(opsTokenOk("Bearer short")).toBe(false);
    expect(opsTokenOk(null)).toBe(false);
    delete process.env.OPS_TOKEN;
    expect(opsTokenOk("Bearer tok-for-tests")).toBe(false);
    expect(opsTokenOk("Bearer undefined")).toBe(false);
    expect(opsTokenOk("Bearer ")).toBe(false);
  });
  it("password", () => {
    expect(opsPasswordOk("pw-for-tests")).toBe(true);
    expect(opsPasswordOk("pw-for-testz")).toBe(false);
    expect(opsPasswordOk("")).toBe(false);
    delete process.env.OPS_PASSWORD;
    expect(opsPasswordOk("")).toBe(false);
    expect(opsPasswordOk("undefined")).toBe(false);
  });
  it("cookie round-trips, expires, rejects tampering", () => {
    const now = 1_000_000;
    const c = signOpsCookie(now + 5000);
    expect(c).toMatch(/^1005000\.[0-9a-f]{64}$/);
    expect(verifyOpsCookie(c, now)).toBe(true);
    expect(verifyOpsCookie(c, now + 5001)).toBe(false);
    const [exp, mac] = c.split(".");
    expect(verifyOpsCookie(`${Number(exp) + 1}.${mac}`, now)).toBe(false);
    expect(verifyOpsCookie(`${exp}.${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`, now)).toBe(false);
  });
  it("malformed cookies are false and never throw", () => {
    for (const v of [undefined, "", "nodot", "abc.def", "1005000.zz", "1005000." + "a".repeat(63), "1005000." + "a".repeat(65), ".", "..", "1005000.é", "NaN." + "a".repeat(64)]) {
      expect(verifyOpsCookie(v, 1)).toBe(false);
    }
  });
  it("a cookie signed under one password fails after the password changes; unset password verifies false", () => {
    const c = signOpsCookie(9_999_999);
    expect(verifyOpsCookie(c, 1)).toBe(true);
    process.env.OPS_PASSWORD = "another-password";
    expect(verifyOpsCookie(c, 1)).toBe(false);
    delete process.env.OPS_PASSWORD;
    expect(verifyOpsCookie(c, 1)).toBe(false);
  });

  it("unset OPS_SECRET: verify false, sign throws or yields nothing valid", () => {
    const c = signOpsCookie(9_999_999);
    delete process.env.OPS_SECRET;
    expect(verifyOpsCookie(c, 1)).toBe(false);
  });
});
