/**
 * His ask 10-22 ("simple yet informative", a short take on the app's About Sprouts questions): what Sprouts can and can't do with a
 * linked wallet, shown before anyone signs. Facts from app/src/lib/settings-copy.ts (PRECISE_GUARANTEE, ADMIN_KEY_LINE), relink.ts
 * (PUBLIC_GUARANTEE) and the README's verified-build line; change them there first. Used on the front page and on /link.
 */
const PROGRAM = "GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7";

export function Safety({ id, ink = "#2B2622", muted = "#7A746B", leaf = "#1E6B44", rule = "#E6DFD2" }: { id?: string; ink?: string; muted?: string; leaf?: string; rule?: string }) {
  const h = { fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: leaf, margin: "0 0 6px" };
  const ul = { margin: 0, paddingLeft: 18, display: "grid", gap: 6 };
  const a = { color: leaf };
  return (
    <section id={id} style={{ width: "100%", maxWidth: 440, textAlign: "left", fontSize: 15, lineHeight: 1.5, color: ink, display: "grid", gap: 18 }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", margin: 0, textAlign: "center" }}>What Sprouts can and can&apos;t do</h2>
      <div style={{ border: `1.5px solid ${rule}`, borderRadius: 16, padding: "16px 18px", background: "#fff", display: "grid", gap: 14 }}>
        <div>
          <p style={h}>Sprouts can</p>
          <ul style={ul}>
            <li>Take up to $5 of USDC a day from a wallet you link. You can set a lower limit.</li>
            <li>Put it into your own savings: staked SKR, stORE, hSOL, cbBTC, or USDC and SOL lending.</li>
          </ul>
        </div>
        <div>
          <p style={h}>Sprouts can&apos;t</p>
          <ul style={ul}>
            <li>Send your money anywhere else. Our on-chain program cancels any pull that doesn&apos;t land in your own savings.</li>
            <li>Take more than your daily limit, even if our server is hacked.</li>
            <li>Touch any token besides USDC, or sell or withdraw what&apos;s in your garden.</li>
          </ul>
        </div>
      </div>
      <div>
        <p style={h}>Before you link</p>
        <ul style={ul}>
          <li>Keep a few dollars of USDC in the wallet. Your round-ups are paid from it.</li>
          <li>Linking needs a little SOL for rent (under $1), refunded when you revoke.</li>
          <li>Your wallet will show an unlimited USDC approval. The $5 limit and the savings-only rule are enforced on chain by the programs it names.</li>
          <li>Stop any time: turn Sprouts off in Rules, or revoke in Settings or at <a href="/revoke" style={a}>sprouts.money/revoke</a>.</li>
        </ul>
      </div>
      <p style={{ fontSize: 13, color: muted, margin: 0 }}>
        The program is <a href="https://github.com/donlucasx/sprouts" style={a}>open source</a> and its build is{" "}
        <a href={`https://verify.osec.io/status/${PROGRAM}`} style={a}>verified by OtterSec</a>. Its admin key lives on the founder&apos;s
        laptop, not our server. It can update the program but can&apos;t raise anyone&apos;s limit. A multisig comes after the hackathon.
      </p>
    </section>
  );
}
