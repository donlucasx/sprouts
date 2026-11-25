import { safetyCopy } from "@/lib/link-safety-copy";
import type { Lang } from "@/lib/i18n";

/** The leash program, for the OtterSec verified-build link. */
const PROGRAM = "GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7";

/**
 * What Sprouts can and can't do with a linked wallet, on /link (under the code box) and /faqs. His asks 10-28: the app's Link a wallet
 * copy and format (a line, then one card of checks and crosses), and "match it so the messaging is always the same", so the lines live
 * in lib/link-safety-copy.ts and the app's test checks they match. Was a longer box (his ask 10-22).
 * P9: `lang` "es" says the app's Spanish lines (same test); English is unchanged.
 */
export function Safety({ ink = "#2B2622", muted = "#7A746B", leaf = "#1E6B44", rule = "#E6DFD2", intro = true, heading, lang = "en" }: { ink?: string; muted?: string; leaf?: string; rule?: string; intro?: boolean; heading?: string; lang?: Lang }) {
  const copy = safetyCopy(lang);
  const a = { color: leaf };
  const mark = (ok: boolean, text: string) => (
    <li key={text} style={{ display: "flex", gap: 10 }}>
      <span aria-hidden="true" style={{ width: 18, flex: "none", color: ok ? leaf : "#9E4B3F" }}>{ok ? "✓" : "✕"}</span>
      <span>{text}</span>
    </li>
  );
  return (
    <section style={{ width: "100%", maxWidth: 440, textAlign: "left", fontSize: 15, lineHeight: 1.5, color: ink, display: "grid", gap: 14 }}>
      {/* off inside the /faqs permissions answer, where "How does it work?" already says it */}
      {/* 11-12 (his note): /link says what the card is with a heading instead of the intro line */}
      {heading ? <p style={{ margin: 0, fontWeight: 600, textAlign: "center" }}>{heading}</p> : null}
      {intro ? <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>{copy.steps.map((l) => <li key={l}>{l}</li>)}</ol> : null}
      <ul style={{ listStyle: "none", margin: 0, border: `1.5px solid ${rule}`, borderRadius: 16, padding: "16px 18px", background: "#fff", display: "grid", gap: 10 }}>
        {copy.can.map((l) => mark(true, l))}
        {copy.cant.map((l) => mark(false, l))}
      </ul>
      {lang === "es" ? (
        <p style={{ fontSize: 13, color: muted, margin: 0, textAlign: "center" }}>
          <a href="https://github.com/donlucasx/sprouts" style={a}>Código abierto</a> y{" "}
          <a href={`https://verify.osec.io/status/${PROGRAM}`} style={a}>verificado por OtterSec</a>.
        </p>
      ) : (
        <p style={{ fontSize: 13, color: muted, margin: 0, textAlign: "center" }}>
          <a href="https://github.com/donlucasx/sprouts" style={a}>Open source</a> and{" "}
          <a href={`https://verify.osec.io/status/${PROGRAM}`} style={a}>verified by OtterSec</a>.
        </p>
      )}
    </section>
  );
}

/**
 * 10-27 (WAL-002 store rejection + his note "this is a scary permission that will turn off most people"): the wallet's "unlimited
 * USDC" warning, said right above the Approve buttons, before the wallet says it. Same words as app/src/lib/safety-copy.ts.
 */
export function ApprovalWarning({ ink, attention, lang = "en" }: { ink: string; attention: string; lang?: Lang }) {
  const copy = safetyCopy(lang);
  return (
    <div style={{ border: `1.5px solid ${attention}`, borderRadius: 14, padding: "12px 16px", maxWidth: 420, margin: "0 auto 14px", textAlign: "left" }}>
      <p style={{ margin: 0, fontWeight: 600, color: attention }}>{copy.warnTitle}</p>
      <p style={{ margin: "4px 0 0", fontSize: 15, color: ink }}>{copy.warnBody}</p>
    </div>
  );
}
