import { JetBrains_Mono, Outfit } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"], weight: ["600"] });
/** The hackathon's CRT wordmark is heavy system monospace (weight 900, tracking .06em; sub-line ~.21em, tracking .32em);
 *  JetBrains Mono 800 so it reads the same on every device. */
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "800"] });

/**
 * His notes 10-12 (R-D88, R-D93): the monochrome co-brand lockup, STACKED: [mark] Sprouts over a short rule over CLOCK IN and
 * 'A SOLANA MOBILE HACKATHON'. Side by side, CLOCK IN read high against Sprouts' descender. Everything is in em, so the parent's
 * font-size sets the size: the splash under the art, and the deck cover small at the bottom.
 */
export function ClockInLockup({ className = "" }: { className?: string }) {
  return (
    <div className={`ci-lock ${className}`}>
      <style>{`
        .ci-lock { display: grid; justify-items: center; color: #2B2622; line-height: 1; }
        .ci-lock .ci-sp { display: flex; align-items: center; gap: .24em; font-size: 1em; font-weight: 600; letter-spacing: -0.03em; margin: 0; }
        .ci-lock .ci-sp img { height: .95em; width: auto; filter: brightness(0); opacity: .86; }
        .ci-lock .ci-rule { width: 1.1em; height: 1px; background: currentColor; opacity: .35; margin: .42em 0 .4em; }
        .ci-lock .ci-ci { display: grid; justify-items: center; font-size: .5em; }
        .ci-lock .ci-ci b { font-weight: 800; letter-spacing: .06em; margin-right: -.06em; }
        .ci-lock .ci-ci small { font-size: .226em; font-weight: 400; letter-spacing: .32em; margin: .3em -.32em 0 0; white-space: nowrap; }
      `}</style>
      <h1 className={`ci-sp ${outfit.className}`}><img src="/deck/mark.svg" alt="" />Sprouts</h1>
      <span className="ci-rule" aria-hidden="true" />
      <div className={`ci-ci ${mono.className}`} aria-label="CLOCK IN, a Solana Mobile hackathon">
        <b>CLOCK IN</b>
        <small>A SOLANA MOBILE HACKATHON</small>
      </div>
    </div>
  );
}
