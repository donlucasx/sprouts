import { describe, it, expect } from 'vitest'
import { fadeAfterGrownMs, GROWN_HOLD_MS, SPLASH, SPLASH_CAP_MS } from '@/lib/splash'
import { SLOGAN } from '@/lib/slogan'

describe("the splash (R282: one painted picture + one line, about 1.5 s, every launch)", () => {
  it("one plain line (the slogan, R319), short, no dashes; on screen about a second and a half", () => {
    expect(SPLASH.line).toBe(SLOGAN)
    expect(SPLASH.line.length).toBeLessThanOrEqual(70)
    expect(SPLASH.line).not.toMatch(/[–—]/)
    expect(SPLASH.ms).toBe(2500)   // his note 10-05
    expect(SPLASH.fadeMs).toBeLessThanOrEqual(300)
  })
  it("the R319 slogan, pinned once (the one literal copy outside slogan.ts)", () => {
    expect(SLOGAN).toBe("Round-ups into SKR that your Seeker keeps and a yield manager grows.")
  })
})

describe("the re-open loading screen's timing (R574)", () => {
  it("fades a short hold after the tree has grown; under reduced motion (the grown tree at once) R282's 2.5 s", () => {
    expect(fadeAfterGrownMs(false)).toBe(GROWN_HOLD_MS)
    expect(fadeAfterGrownMs(true)).toBe(SPLASH.ms)
  })
  it("the cap is a backstop only: later than either fade (s6 review C4: it used to replace the reduced-motion one)", () => {
    expect(SPLASH_CAP_MS).toBeGreaterThan(fadeAfterGrownMs(true) + SPLASH.fadeMs)
    expect(SPLASH_CAP_MS).toBeGreaterThan(3500 + GROWN_HOLD_MS)   // GrowSplash GROW_MS + the hold
  })
})
