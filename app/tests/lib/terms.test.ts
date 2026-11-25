import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { TERMS_MD } from '@/lib/terms-text'
import { TERMS_MD_ES } from '@/lib/terms-text-es'
import { TERMS_VERSION, termsAction, termsBlocks, termsNeeded, termsSummary, termsText, termsPage, withAccepted, stampSignIn, agreedLine } from '@/lib/terms'
import { currentLang, t, writeLangChoice } from '@/i18n'

const FINAL = new URL('../../../../../docs/legal/2026-11-23-terms.md', import.meta.url) // the project's docs/legal, outside the repo

describe('Terms + Privacy (R283; R365, the text of 10-07)', () => {
  // P10 (his ruling 11-25): the "To be completed" line was removed from the final file too (same version), so this stays byte for byte.
  it.skipIf(!existsSync(FINAL))('is the final file, byte for byte (never paraphrased)', () => {
    expect(TERMS_MD).toBe(readFileSync(FINAL, 'utf8'))
  })
  it('P10: the "To be completed" line is gone and the version is unchanged', () => {
    expect(TERMS_MD).not.toContain('To be completed')
    expect(TERMS_MD).toContain('## Liability and governing law\n\nThese Terms are governed by')
    expect(TERMS_VERSION).toBe('2026-11-23')
  })
  it("the version is the page's own", () => {
    expect(TERMS_VERSION).toBe('2026-11-23')
    expect(TERMS_MD).toContain('Version 2026-11-23.')
    expect(TERMS_MD).toContain('(99.4% for USDC lending)')
    expect(TERMS_MD).not.toContain('99.9%')
    expect(TERMS_MD).toContain('Coins join your garden as it grows')
    expect(TERMS_MD).toContain('before the deposit for USDC or SOL lending.')
    expect(TERMS_MD).not.toContain('for now')
    expect(TERMS_MD).toContain('from SOL or another coin in your wallet')
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
    expect(s[2]).toBe('Sprouts takes 0.5% of each planting and nothing on interest or withdrawals. We keep your public keys and plantings, never your private keys, and we never sell your data.')
  })
  it('asks only when the API says this version is not accepted; an API without terms never asks', () => {
    expect(termsNeeded(undefined)).toBe(false)
    expect(termsNeeded({})).toBe(false)
    expect(termsNeeded({ terms: { currentVersion: '2026-10-23', acceptedVersion: null } })).toBe(true)
    expect(termsNeeded({ terms: { currentVersion: '2026-10-23', acceptedVersion: '2026-09-01' } })).toBe(true)
    expect(termsNeeded({ terms: { currentVersion: '2026-10-23', acceptedVersion: '2026-10-23' } })).toBe(false)
  })
  it('offers "agree" when the API asks for the bundled version or an older one; only a newer one says update the app', () => {
    expect(termsAction(undefined)).toBe(null)
    expect(termsAction({ terms: { currentVersion: '2026-11-23', acceptedVersion: '2026-11-23' } })).toBe(null)
    expect(termsAction({ terms: { currentVersion: '2026-11-23', acceptedVersion: null } })).toBe('agree')
    expect(termsAction({ terms: { currentVersion: '2026-11-15', acceptedVersion: null } })).toBe('agree')
    expect(termsAction({ terms: { currentVersion: '2026-11-01', acceptedVersion: null } })).toBe('agree')
    expect(termsAction({ terms: { currentVersion: '2026-12-01', acceptedVersion: '2026-11-23' } })).toBe('update')
    expect(termsAction({ terms: { currentVersion: '2026-12-01', acceptedVersion: null } })).toBe('update')
  })
  it('the accepted version goes into the read at once, and the card drops', () => {
    const me = { terms: { currentVersion: '2026-10-23', acceptedVersion: null } }
    const after = withAccepted(me, '2026-10-23')
    expect(after.terms.acceptedVersion).toBe('2026-10-23')
    expect(termsNeeded(after)).toBe(false)
    expect(me.terms.acceptedVersion).toBe(null)
    expect(withAccepted({}, '2026-10-23')).toEqual({})
  })
})

describe('after sign-in (0.1.9, 11-07: no stale Terms card)', () => {
  const owed = (pubkey: string) => ({ user: { pubkey }, terms: { currentVersion: '2026-11-23', acceptedVersion: null as string | null, acceptedAt: null as string | null } }) as never
  it('same user: the saved read is stamped accepted now', () => {
    const out = stampSignIn(owed('A'), 'A') as unknown as { terms: { currentVersion: string; acceptedVersion: string; acceptedAt: string } }
    expect(termsNeeded(out)).toBe(false)
    expect(out.terms.acceptedVersion).toBe(TERMS_VERSION)
    expect(Math.abs(Date.now() - Date.parse(out.terms.acceptedAt))).toBeLessThan(5000)
  })
  it('another user, or no saved read: null', () => {
    expect(stampSignIn(owed('A'), 'B')).toBeNull()
    expect(stampSignIn(null, 'A')).toBeNull()
  })
  it('a read without terms (older API) is returned as is for the same user', () => {
    const last = { user: { pubkey: 'A' } } as never
    expect(stampSignIn(last, 'A')).toBe(last)
  })
  const accepted = { terms: { currentVersion: '2026-11-23', acceptedVersion: '2026-11-23', acceptedAt: '2026-11-08T02:35:03Z' } }
  it('the agreed line, in the phone zone given', () => {
    expect(agreedLine(accepted, 'America/Los_Angeles')).toBe('You agreed to these Terms on Nov 7, 2026.')
    expect(agreedLine(accepted, 'UTC')).toBe('You agreed to these Terms on Nov 8, 2026.')
  })
  it('no line when owed, when acceptedAt is missing, or without terms', () => {
    expect(agreedLine({ terms: { ...accepted.terms, acceptedVersion: null } }, 'UTC')).toBeNull()
    expect(agreedLine({ terms: { ...accepted.terms, acceptedAt: null } }, 'UTC')).toBeNull()
    expect(agreedLine({ terms: { currentVersion: 'x', acceptedVersion: 'x' } }, 'UTC')).toBeNull()
    expect(agreedLine(null, 'UTC')).toBeNull()
  })
})

describe('P10: the Spanish courtesy translation', () => {
  const heads = (md: string) => md.split('\n').filter((l) => l.startsWith('## '))
  afterEach(() => writeLangChoice('auto'))
  it('opens with the courtesy line, keeps the version, the marker and the section count, and drops the reviewer notes', () => {
    expect(TERMS_MD_ES.split('\n')[0]).toBe('Esta es una traducción de cortesía. Si hay cualquier diferencia entre esta versión y la versión en inglés, la versión en inglés es la vinculante.')
    expect(TERMS_MD_ES).toContain('Versión 2026-11-23.')
    expect(TERMS_MD_ES).toContain('\n## In three lines (for the "I agree" screen)\n')
    expect(heads(TERMS_MD_ES)).toHaveLength(heads(TERMS_MD).length)
    for (const bad of ['<!--', 'Para revisar', 'Pendiente de completar', 'corchetes', '---', '—']) expect(TERMS_MD_ES).not.toContain(bad)
  })
  it('the headings in the same order as the English (the section each one translates)', () => {
    expect(termsPage(TERMS_MD_ES).body.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(['Qué es Sprouts', 'Sprouts no es un banco', 'Quién puede usar Sprouts', 'Tu dinero se queda en tu billetera', 'Qué autoriza vincular una billetera', 'Sacar dinero', 'El Gestor IA', 'Riesgos', 'Comisiones', 'Datos que guardamos', 'Si Sprouts cierra', 'Responsabilidad y ley aplicable', 'Cambios a estos términos', 'Contacto'])
    expect(termsBlocks(TERMS_MD_ES).filter((b) => b.kind === 'bullet')).toHaveLength(termsBlocks().filter((b) => b.kind === 'bullet').length)
  })
  it('the Spanish page: its title found after the courtesy line; its summary is the es Home lines word for word', () => {
    const p = termsPage(TERMS_MD_ES)
    expect(p.title).toBe('Sprouts: Términos de uso y privacidad')
    expect(p.body[0]).toEqual({ kind: 'para', text: TERMS_MD_ES.split('\n')[0] })
    expect(termsSummary(TERMS_MD_ES)).toEqual([1, 2, 3].map((n) => t(`terms.summary.${n}` as 'terms.summary.1', undefined, 'es')))
  })
  it('the English page is unchanged by termsPage: blocks[0] as the title, the rest as the body', () => {
    const p = termsPage()
    expect(p.title).toBe(termsBlocks()[0].text)
    expect(p.body).toEqual(termsBlocks().slice(1))
  })
  it('the app shows Spanish under es (one tap from the binding English) and English under en', () => {
    writeLangChoice('es')
    expect(termsText(currentLang())).toBe(TERMS_MD_ES)
    expect(termsText(currentLang(), true)).toBe(TERMS_MD)
    expect(t('terms.readEnglish')).toBe('Leer la versión en inglés (vinculante)')
    writeLangChoice('en')
    expect(termsText(currentLang())).toBe(TERMS_MD)
    expect(termsText(currentLang(), true)).toBe(TERMS_MD)
    expect(t('terms.readEnglish')).toBe('Read the binding English')
  })
})
