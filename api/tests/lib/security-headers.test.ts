import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

// Security R207 #11: the signing pages carry a CSP sized to what they load, and no page may be framed.
describe("security headers (next.config)", () => {
  const rules = async () => (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
  /** The headers Next would send for one path: every matching rule in order, a later key overriding an earlier one. */
  const forPath = async (path: string) => {
    const out: Record<string, string> = {};
    for (const r of await rules()) {
      if (r.source === path || r.source === "/:path*") for (const h of r.headers) out[h.key] = h.value;
    }
    return out;
  };

  for (const page of ["/link", "/revoke"]) {
    it(`${page}: a CSP with frame-ancestors 'none', no third-party origin, nosniff and no referrer`, async () => {
      const h = await forPath(page);
      const csp = h["Content-Security-Policy"];
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("img-src 'self' data:");      // wallet icons are data: URIs
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toMatch(/https?:|\*/);               // no outside origin anywhere
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["Referrer-Policy"]).toBe("no-referrer");
      expect(h["X-Frame-Options"]).toBe("DENY");
    });
  }

  it("every other path: nosniff, a strict referrer policy, no framing", async () => {
    const h = await forPath("/");
    expect(h).toEqual({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" });
  });
});
