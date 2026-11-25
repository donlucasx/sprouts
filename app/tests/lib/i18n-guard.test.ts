import { describe, it, expect } from 'vitest'
import { t } from '@/i18n'
import { en, type Key } from '@/i18n/en'
import { es } from '@/i18n/es'

// 0.1.13 Spanish pass P1: guards that keep the two dictionaries honest as parts P2 to P7 fill in Spanish.
const enKeys = Object.keys(en) as Key[]
const esKeys = Object.keys(es) as Key[]
const holes = (line: string) => [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const EM_DASH = '—'

describe('i18n guards', () => {
  it('every Spanish key exists in English (no orphan lines)', () => {
    expect(esKeys.filter((k) => !(k in en))).toEqual([])
  })
  it('a Spanish line has exactly the {placeholders} of its English line', () => {
    for (const k of esKeys) expect({ k, holes: holes(es[k] as string) }).toEqual({ k, holes: holes(en[k]) })
  })
  it('no em dash in any English or Spanish line', () => {
    for (const k of enKeys) expect({ k, dash: en[k].includes(EM_DASH) }).toEqual({ k, dash: false })
    for (const k of esKeys) expect({ k, dash: (es[k] as string).includes(EM_DASH) }).toEqual({ k, dash: false })
  })
  it("t(key, vars, 'es') never returns a key name or a blank, with or without a Spanish line", () => {
    for (const k of enKeys) {
      const vars = Object.fromEntries(holes(en[k]).map((h) => [h, 'x']))
      const out = t(k, vars, 'es')
      expect(out).not.toBe(k)
      expect(out.trim()).not.toBe('')
      expect(out).not.toMatch(/^[a-z]+(\.[A-Za-z0-9]+)+$/)
    }
  })
  it('every Spanish line is non-empty', () => {
    for (const k of esKeys) expect((es[k] as string).trim()).not.toBe('')
  })

  it('the release gate would catch a hole (it lists English keys with no Spanish line)', () => {
    const { [enKeys[0]]: _gone, ...rest } = es as Record<string, string>
    expect(enKeys.filter((k) => !(k in rest))).toEqual([enKeys[0]])
  })

  // Release gate: ON since 11-25 (P10 done): every English line has its Spanish line.
  // Until then English fills any hole (t() falls back), so the app is never blank; un-skipped today it lists what is missing.
  it('release gate: no English key is missing from Spanish', () => {
    expect(enKeys.filter((k) => !(k in es))).toEqual([])
  })
})
