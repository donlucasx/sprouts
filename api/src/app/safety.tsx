import { CAN, CANT, LINK_INTRO } from "@/lib/link-safety-copy";

/** The leash program, for the OtterSec verified-build link. */
const PROGRAM = "GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7";

/**
 * What Sprouts can and can't do with a linked wallet, on /link (under the code box) and /faqs. His asks 10-28: the app's Link a wallet
 * copy and format (a line, then one card of checks and crosses), and "match it so the messaging is always the same", so the lines live
 * in lib/link-safety-copy.ts and the app's test checks they match. Was a longer box (his ask 10-22).
 */
export function Safety({ ink = "#2B2622", muted = "#7A746B", leaf = "#1E6B44", rule = "#E6DFD2" }: { ink?: string; muted?: string; leaf?: string; rule?: string }) {
  const a = { color: leaf };
  const mark = (ok: boolean, text: string) => (
    <li key={text} style={{ display: "flex", gap: 10 }}>
      <span aria-hidden="true" style={{ width: 18, flex: "none", color: ok ? leaf : "#9E4B3F" }}>{ok ? "\u2713" : "\u2715"}</span>
      <span>{text}</span>
    </li>
  );
  return (
    <section style={{ width: "100%", maxWidth: 440, textAlign: "left", fontSize: 15, lineHeight: 1.5, color: ink, display: "grid", gap: 14 }}>
      <p style={{ margin: 0 }}>{LINK_INTRO}</p>
      <ul style={{ listStyle: "none", margin: 0, border: `1.5px solid ${rule}`, borderRadius: 16, padding: "16px 18px", background: "#fff", display: "grid", gap: 10 }}>
        {CAN.map((l) => mark(true, l))}
        {CANT.map((l) => mark(false, l))}
      </ul>
      <p style={{ fontSize: 13, color: muted, margin: 0, textAlign: "center" }}>
        <a href="https://github.com/donlucasx/sprouts" style={a}>Open source</a> and{" "}
        <a href={`https://verify.osec.io/status/${PROGRAM}`} style={a}>verified by OtterSec</a>.
      </p>
    </section>
  );
}

/**
 * 10-27 (WAL-002 store rejection + his note "this is a scary permission that will turn off most people"): the wallet's "unlimited
 * USDC" warning, said right above the Approve buttons, before the wallet says it. Same words as app/src/lib/safety-copy.ts.
 */
export function ApprovalWarning({ ink, attention }: { ink: string; attention: string }) {
  return (
    <div style={{ border: `1.5px solid ${attention}`, borderRadius: 14, padding: "12px 16px", maxWidth: 420, margin: "0 auto 14px", textAlign: "left" }}>
      <p style={{ margin: 0, fontWeight: 600, color: attention }}>Your wallet will warn about &quot;unlimited USDC&quot;</p>
      <p style={{ margin: "4px 0 0", fontSize: 15, color: ink }}>
        That&apos;s expected. The approval goes to Sprouts&apos; on-chain program, which only lets Sprouts take up to $5 a day, into your own
        garden. Revoke any time.
      </p>
    </div>
  );
}
