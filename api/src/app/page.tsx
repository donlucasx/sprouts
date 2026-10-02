import { pullerSigner } from "@/lib/puller";
import { SKR_STAKING_PROGRAM, SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";

/** The front door: what Sprouts is, exactly which programs it touches, the limits, and where the code is. The app lives on the phone. */
export default async function Home() {
  // The puller's public address, read from the key the server holds; omitted where no key is configured (a local build).
  let puller: string | null = null;
  try {
    puller = (await pullerSigner()).address;
  } catch {
    puller = null;
  }
  const mono = { fontFamily: "ui-monospace, monospace", fontSize: 13, wordBreak: "break-all" as const };
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "8vh auto", padding: "0 24px", lineHeight: 1.55 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Sprouts</h1>
      <p>Round-ups into SKR that your Seeker keeps and a yield manager grows.</p>
      <p>
        An Android app for the Solana Seeker, built for the CLOCK IN hackathon. You approve once per trading wallet; after that a daily
        job pulls at most your daily limit in USDC, swaps it to SKR through Jupiter and stakes it to your Seed Vault key, in one
        transaction. Only your Seed Vault key can unstake. Nothing here holds user funds.
      </p>
      <h2 style={{ fontSize: 18, marginTop: 28 }}>What the approval does</h2>
      <p>
        It uses the Solana Foundation&apos;s Subscriptions program (audited by Cantina). The program becomes the delegate on your USDC
        account; each pull must also fit a recurring delegation capped at your daily limit, $5 by default, which the program enforces
        on chain. Revoke it at any time from the app or from this site with the wallet that approved.
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li>Subscriptions program: <span style={mono}>{SUBSCRIPTIONS_PROGRAM}</span></li>
        <li>SKR staking program (Solana Mobile): <span style={mono}>{SKR_STAKING_PROGRAM}</span></li>
        {puller ? <li>The puller, the only key that can pull within the limit: <span style={mono}>{puller}</span></li> : null}
      </ul>
      <p>
        <a href="/link">Link a wallet</a> with a code from the app. <a href="/revoke">Revoke</a> with the wallet that approved.
      </p>
      <p>
        Source code, the safety story and how to report a problem: <a href="https://github.com/donlucasx/sprouts">github.com/donlucasx/sprouts</a>
      </p>
    </main>
  );
}
