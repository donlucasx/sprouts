import { describe, it, expect } from 'vitest'
import { SPLASH, splashScene } from '@/lib/splash'
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
    expect(SPLASH.ms).toBe(1500)
    expect(SPLASH.fadeMs).toBeLessThanOrEqual(300)
  })
})
