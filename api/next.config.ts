import type { NextConfig } from "next";

/**
 * Security headers (security R207 #11). The /link and /revoke pages ask a wallet to sign, so they get a CSP sized to exactly what
 * they load, and no page of this site may be framed (a framed /link is the clickjacking shape).
 *
 * What the CSP allows, and why:
 * - script-src 'self' 'unsafe-inline': Next's App Router writes its hydration data as inline <script> tags; a nonce would need
 *   middleware and dynamic rendering on every page. No third-party script is allowed. Wallet extensions (Phantom, Solflare,
 *   Backpack) inject their Wallet Standard provider from the extension, which a page CSP does not govern; the page only calls
 *   getWallets(), which needs nothing. 'unsafe-eval' only under `next dev` (its refresh runtime evals).
 * - style-src 'self' 'unsafe-inline': the pages style with React `style` props, which are inline style attributes.
 * - img-src 'self' data:: the wallet buttons show each wallet's icon, which Wallet Standard requires to be a data: URI.
 * - font-src 'self': next/font self-hosts Geist at build time; nothing is fetched from Google at run time.
 * - connect-src 'self': the pages fetch only this site's /api; the wallet talks to its own extension, not through the page.
 * - frame-ancestors 'none', base-uri 'none', form-action 'self', object-src 'none'.
 */
const dev = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const EVERY_PAGE = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: EVERY_PAGE },
      // The signing pages: no referrer at all (a code in a query string never leaves), and the CSP above.
      ...["/link", "/revoke"].map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: CSP }, { key: "Referrer-Policy", value: "no-referrer" }],
      })),
    ];
  },
};

export default nextConfig;
