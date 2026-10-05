import { describe, it, expect } from 'vitest'
import { SPLASH, splashHoldMs, splashScene } from '@/lib/splash'
import { SLOGAN } from '@/lib/slogan'

describe("the splash (R282: one painted picture + one line, about 1.5 s, every launch)", () => {
  it("a grown garden of all six legs with nothing that asks for a tap: no stakes, seeds, swelling, rings or buds", () => {
    const s = splashScene()
    expect(s.parts.flatMap((p) => (p.kind === 'plant' ? [p.species] : [])).sort()).toEqual(['blueberry', 'mandarin', 'snake', 'spruce', 'succulent', 'sunflower'])
    expect(s.parts.some((p) => p.kind === 'sign' || p.kind === 'seed' || p.kind === 'swelling' || p.kind === 'ring')).toBe(false)
    expect(s.parts.some((p) => p.kind === 'sprout' && p.bud)).toBe(false)
    expect([s.unrevealed, s.canReady]).toEqual([0, false])
  })
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

describe("the hold counts from the picture being in; a picture that never comes is cut at the cap", () => {
  it("in at once: held 2.5 s from then", () => {
    expect(splashHoldMs(0, 0)).toBe(SPLASH.ms)
  })
  it("in late (2.2 s): held 2.5 s from then", () => {
    expect(splashHoldMs(2200, 2200)).toBe(SPLASH.ms)
    expect(splashHoldMs(2200, 3000)).toBe(SPLASH.ms - 800)
  })
  it("never in: fades at the cap, no further hold; one that lands after the cap changes nothing", () => {
    expect(splashHoldMs(null, 0)).toBe(SPLASH.capMs)
    expect(splashHoldMs(null, SPLASH.capMs)).toBe(0)
    expect(splashHoldMs(4200, 4200)).toBe(0)
  })
  it("the cap leaves room for the hold and the fade", () => {
    expect(SPLASH.capMs).toBeGreaterThanOrEqual(SPLASH.ms + SPLASH.fadeMs)
  })
})
