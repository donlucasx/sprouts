import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
import { t, writeLangChoice } from '@/i18n'
import { en } from '@/i18n/en'
import { es } from '@/i18n/es'
import { linkedTitle, phoneSolNote, phoneUsdcNote, setupLine, CAN_KEYS, CANT_KEYS, LINK_STEP_KEYS, SAFETY_HEADING } from '@/lib/safety-copy'
import { disclosureItems, RELINK, RelinkSent, WEB_LINK_TRUST } from '@/lib/relink'
import { REFUSED, REFUSED_COIN, SignRefused } from '@/lib/sign'
import { linkErrorView } from '@/lib/link-error'
import { DROPPED_NOTHING_SENT, droppedNothingSent, SIGN_IN_DID_NOT_FINISH } from '@/lib/wallet-errors'
import { SLOGAN_LINES } from '@/lib/slogan'

// 0.1.13 Spanish pass P5 (d): Link a wallet, the re-link card, sign-in and the signing lines. The English constants stay for the
// app/web drift tests; the same functions render Spanish when the language is Spanish.
afterEach(() => writeLangChoice('auto'))

describe('link area: English unchanged', () => {
  it('the frozen constants are the en lines', () => {
    expect(SAFETY_HEADING).toBe(en['link.safety.heading'])
    expect(WEB_LINK_TRUST).toBe(en['relink.trust'])
    expect(DROPPED_NOTHING_SENT).toBe(en['wallet.dropped'])
    expect(SIGN_IN_DID_NOT_FINISH).toBe(en['signin.didNotFinish'])
    expect(SLOGAN_LINES).toEqual([en['signin.slogan.1'], en['signin.slogan.2']])
    expect(REFUSED_COIN.price('SOL')).toBe(REFUSED.price)
  })
  it('the linked notice title: mine or a short address', () => {
    expect(linkedTitle(true, 'Abcd...wxyz')).toBe('Linked your Seed Vault wallet')
    expect(linkedTitle(false, 'Abcd...wxyz')).toBe('Linked Abcd...wxyz')
  })
})

describe('link area in Spanish', () => {
  it('every link.* line says billetera, never wallet', () => {
    for (const [k, v] of Object.entries(es)) if (k.startsWith('link.')) expect({ k, v: /\bwallet\b/i.test(v as string) }).toEqual({ k, v: false })
  })
  it('the screen keys all have Spanish', () => {
    for (const k of [...LINK_STEP_KEYS, ...CAN_KEYS, ...CANT_KEYS, 'link.title', 'link.safety.heading', 'link.approve', 'link.other.line'] as const) expect(es[k]).toBeTruthy()
  })
  it('notes, setup line (one / other, dollars / SOL) with Spanish numbers', () => {
    writeLangChoice('es')
    expect(phoneSolNote('0')).toBe('Esta billetera necesita alrededor de 0,01 SOL para aprobar. Cubre el depósito único (rent) y la comisión de red. Primero agrega un poco de SOL.')
    expect(phoneUsdcNote('0', 200)).toBe('Esta billetera no tiene USDC. Agrégale al menos $2,00 para que Sprouts pueda plantar.')
    expect(phoneUsdcNote('400000', 200)).toBe('Esta billetera tiene $0,40 en USDC. Agrégale al menos $1,60 para que Sprouts pueda plantar.')
    expect(setupLine(1, 147.11)).toBe('Incluye $0,30 de costo único por la apertura de 1 cuenta de moneda, que se paga en SOL. Es tuyo: lo recuperas si la vacías y la cierras.')
    expect(setupLine(3, 150)).toBe('Incluye $0,92 de costo único por la apertura de 3 cuentas de moneda, que se paga en SOL. Es tuyo: lo recuperas si las vacías y las cierras.')
    expect(setupLine(3, null)).toBe('Incluye alrededor de 0,0062 SOL por la apertura única de 3 cuentas de moneda. Es tuyo: lo recuperas si las vacías y las cierras.')
    expect(linkedTitle(true, 'x')).toBe('Vinculaste tu billetera Seed Vault')
    expect(linkedTitle(false, 'Abcd...wxyz')).toBe('Vinculaste Abcd...wxyz')
  })
  it('the re-link card and its disclosure read at use time', () => {
    writeLangChoice('es')
    expect(RELINK.button).toBe('Volver a vincular')
    expect(RELINK.body).toBe(es['promise.public'])
    expect(RELINK.webDone('A111...1111')).toBe('A111...1111 vinculada de nuevo.')
    const items = disclosureItems(['A1111111111111111'], { A1111111111111111: 'LEASH' }).map((i) => i.text)
    expect(items).toEqual([t('relink.web', { wallet: 'A111...1111' }), 'LEASH', `${es['relink.leashLine']} ${es['relink.compare']}`, es['relink.trust'], es['relink.exposed']])
    expect(new RelinkSent(new Error('x')).message).toBe(es['relink.sent'])
  })
  it('refusals, the dropped line and the link error view', () => {
    writeLangChoice('es')
    expect(REFUSED.plan).toBe('Esta transacción no coincide con lo que muestra la pantalla. No se firmó nada.')
    expect(REFUSED_COIN.overpriced('JUP')).toBe('Este swap pide más JUP de lo que vale el USDC ahora mismo. No se firmó nada.')
    expect(droppedNothingSent()).toBe('Tu billetera no firmó, así que no se envió nada. Inténtalo de nuevo.')
    expect(linkErrorView(new Error('java.util.concurrent.CancellationException'))).toEqual({ title: 'Seed Vault se cerró antes de aprobar', body: es['link.closed.body'], ask: true })
    expect(linkErrorView(new SignRefused(REFUSED.payer)).body).toBe(es['sign.refused.payer'])
  })
  it('sign-in: the agreement keeps one {terms} slot for the link', () => {
    for (const lang of ['en', 'es'] as const) expect(t('signin.agree', undefined, lang).split('{terms}')).toHaveLength(2)
    expect(t('signin.agree', { terms: t('home.terms.title', undefined, 'es') }, 'es')).toBe('Al iniciar sesión aceptas los Términos y privacidad.')
  })
})
