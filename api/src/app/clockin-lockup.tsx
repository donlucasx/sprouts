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
export function ClockInLockup({ className = "", horizontal = false }: { className?: string; horizontal?: boolean }) {
  return (
    <div className={`ci-lock${horizontal ? " ci-h" : ""} ${className}`}>
      <style>{`
        .ci-lock { display: grid; justify-items: center; color: #2B2622; line-height: 1; }
        .ci-lock .ci-sp { display: flex; align-items: center; gap: .24em; font-size: 1em; font-weight: 600; letter-spacing: -0.03em; margin: 0; }
        .ci-lock .ci-sp img { height: .95em; width: auto; filter: brightness(0); opacity: .86; }
        .ci-lock .ci-rule { width: 4.46em; height: 1px; background: currentColor; opacity: .3; margin: .34em 0 .3em; }   /* R-D97: as wide as the Sprouts wordmark (4.46em measured), tighter */
        .ci-lock .ci-ci { display: grid; justify-items: center; font-size: .845em; }   /* R-D97: CLOCK IN as wide as Sprouts (5.28em of its own size = 4.46em) */
        .ci-lock .ci-ci b { font-weight: 800; letter-spacing: .06em; margin-right: -.06em; }
        .ci-lock .ci-ci small { font-size: .226em; font-weight: 400; letter-spacing: .32em; margin: .3em -.32em 0 0; white-space: nowrap; }
        /* R-D98 (deck cover, option D): Sprouts | CLOCK IN on one horizontal centre line; the sub-line hangs below CLOCK IN without
           moving it (absolute), so the two wordmarks share their optical centre. --ci-dy is the measured nudge. */
        .ci-lock.ci-h { display: flex; align-items: center; gap: .42em; width: max-content; --ci-dy: -0.11em; }   /* measured 10-12: C cap centre 14.5 px below S cap centre at 300 dpi (lockup 156 px) */
        .ci-lock.ci-h .ci-rule { width: 1px; height: 1.15em; margin: 0; flex: none; }
        .ci-lock.ci-h > * { flex: none; }
        .ci-lock.ci-h .ci-ci { font-size: .84em; position: relative; display: block; white-space: nowrap; transform: translateY(var(--ci-dy)); }
        .ci-lock.ci-h .ci-sp { white-space: nowrap; }
        .ci-lock.ci-h .ci-ci small { position: absolute; left: 0; top: 100%; margin: .26em 0 0; }
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
