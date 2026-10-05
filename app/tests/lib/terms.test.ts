import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { TERMS_MD } from '@/lib/terms-text'
import { TERMS_VERSION, termsAction, termsBlocks, termsNeeded, termsSummary, withAccepted } from '@/lib/terms'

const FINAL = '/Users/lucasgarzoli/Documents/claude/seekerhackathon/docs/legal/2026-10-07-terms.md'

describe('Terms + Privacy (R283; R365, the text of 10-07)', () => {
  it.skipIf(!existsSync(FINAL))('is the final file, byte for byte (never paraphrased)', () => expect(TERMS_MD).toBe(readFileSync(FINAL, 'utf8')))
  it("the version is the page's own", () => {
    expect(TERMS_VERSION).toBe('2026-10-07')
    expect(TERMS_MD).toContain('Version 2026-10-07.')
  })
  it('the page: title, headings, paragraphs and bullets, without the "I agree" summary section', () => {
    const b = termsBlocks()
    expect(b[0]).toEqual({ kind: 'title', text: 'Sprouts: Terms of Use and Privacy' })
    expect(b.filter((x) => x.kind === 'heading').map((x) => x.text)).toEqual(['What Sprouts is', 'Sprouts is not a bank', 'Who can use Sprouts', 'Your money stays in your wallet', 'What linking a wallet authorises', 'Taking money out', 'The Yield Manager', 'Risks', 'Fees', 'Data we keep', 'If Sprouts shuts down', 'Liability and governing law', 'Changes to these terms', 'Contact'])
    expect(b.some((x) => x.text.includes('In three lines'))).toBe(false)
    expect(b.filter((x) => x.kind === 'bullet')).toHaveLength(7)
    expect(b.at(-1)).toEqual({ kind: 'para', text: 'Contact: hello@sprouts.money' })
  })
  it('the three lines for the acceptance screen', () => {
    const s = termsSummary()
    expect(s).toHaveLength(3)
    expect(s[0]).toBe('Your coins stay in your own wallet. Sprouts can pull up to $5 a day, and once your wallet is on the leash the program itself makes sure it can only go into your own savings. You can revoke the allowance any time.')
    expect(s[2]).toBe('Fees are 0.5% on coin plantings and zero on lending. We keep your public keys and plantings, never your private keys, and we never sell your data.')
  })
  it('asks only when the API says this version is not accepted; an API without terms never asks', () => {
    expect(termsNeeded(undefined)).toBe(false)
    expect(termsNeeded({})).toBe(false)
    expect(termsNeeded({ terms: { currentVersion: '2026-10-07', acceptedVersion: null } })).toBe(true)
    expect(termsNeeded({ terms: { currentVersion: '2026-10-07', acceptedVersion: '2026-09-01' } })).toBe(true)
    expect(termsNeeded({ terms: { currentVersion: '2026-10-07', acceptedVersion: '2026-10-07' } })).toBe(false)
  })
  it('offers "agree" only when the API asks for the bundled version; a newer one says update the app', () => {
    expect(termsAction(undefined)).toBe(null)
    expect(termsAction({ terms: { currentVersion: '2026-10-07', acceptedVersion: '2026-10-07' } })).toBe(null)
    expect(termsAction({ terms: { currentVersion: '2026-10-07', acceptedVersion: null } })).toBe('agree')
    expect(termsAction({ terms: { currentVersion: '2026-11-01', acceptedVersion: '2026-10-07' } })).toBe('update')
    expect(termsAction({ terms: { currentVersion: '2026-11-01', acceptedVersion: null } })).toBe('update')
  })
  it('the accepted version goes into the read at once, and the card drops', () => {
    const me = { terms: { currentVersion: '2026-10-07', acceptedVersion: null } }
    const after = withAccepted(me, '2026-10-07')
    expect(after.terms.acceptedVersion).toBe('2026-10-07')
    expect(termsNeeded(after)).toBe(false)
    expect(me.terms.acceptedVersion).toBe(null)
    expect(withAccepted({}, '2026-10-07')).toEqual({})
  })
})
