import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { MeResponse } from '@/lib/api'

// 0.1.13 Spanish pass P7 (f): the widget, the notification channel, Add a widget and the loading line. English stays the source (the
// widget-layout tests assert it); these check the Spanish forms fit like the English and that a language change reaches the widget
// and the channel, which live outside React.
const w = vi.hoisted(() => ({ update: vi.fn(async (_: { widgetName: string; renderWidget: (i: { width: number; height: number }) => unknown }) => {}) }))
const n = vi.hoisted(() => ({ get: vi.fn(async (): Promise<object | null> => ({ id: 'plantings' })), set: vi.fn(async () => null) }))
vi.mock('react-native-android-widget', () => ({ FlexWidget: 'FlexWidget', OverlapWidget: 'OverlapWidget', TextWidget: 'TextWidget', SvgWidget: 'SvgWidget', requestWidgetUpdate: w.update }))
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(), AndroidImportance: { DEFAULT: 3 }, getNotificationChannelAsync: n.get, setNotificationChannelAsync: n.set,
  getPermissionsAsync: vi.fn(async () => ({ status: 'granted' })), requestPermissionsAsync: vi.fn(), scheduleNotificationAsync: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ api: vi.fn(), ApiError: class extends Error {} }))
const { t, writeLangChoice } = await import('@/i18n')
const { en } = await import('@/i18n/en')
const { es } = await import('@/i18n/es')
const { textWidth } = await import('@/garden/widget-layout')
const { WIDGET_FORM_KEYS, widgetHeadline, widgetStateLine } = await import('@/lib/widget-state')
await import('@/lib/me')
await import('@/lib/notify')

afterEach(() => writeLangChoice('auto'))
const forms = (line: string) => line.split('|')
const narrowest = (line: string) => Math.min(...forms(line).map((f) => textWidth(f, 10, true)))
// what each language fills the placeholders with (its own longest run phrase and clock)
const VARS = {
  en: { total: '$1,234.50', goal: '$2.00', amount: '$1.35', when: 'tomorrow afternoon', clock: '7:30 AM' },
  es: { total: '$1.234,50', goal: '$2,00', amount: '$1,35', when: 'mañana por la tarde', clock: '7:30' },
}
const saving = { nextPlanting: { pendingCents: 135, thresholdCents: 200, capLeftCents: 500, asset: 'SKR' }, wallets: [], history: { plantings: [] } } as unknown as MeResponse
const NOW = new Date('2026-10-02T20:00:00Z')

describe('widget forms: every Spanish text fits where the English does', () => {
  it('each text has a Spanish line, and its narrowest Spanish form is no wider than the narrowest English one', () => {
    for (const k of WIDGET_FORM_KEYS) {
      expect({ k, has: k in es }).toEqual({ k, has: true })
      const wEn = narrowest(t(k, VARS.en, 'en')), wEs = narrowest(t(k, VARS.es, 'es'))
      expect({ k, fits: wEs <= wEn }).toEqual({ k, fits: true })
    }
  })
  it('so at any room an English form fits, a Spanish form fits too (the pick never falls to an overflowing last form)', () => {
    for (const k of WIDGET_FORM_KEYS)
      for (let room = 20; room <= 300; room += 2) {
        const fitsEn = forms(t(k, VARS.en, 'en')).some((f) => textWidth(f, 10, true) <= room)
        const fitsEs = forms(t(k, VARS.es, 'es')).some((f) => textWidth(f, 10, true) <= room)
        if (fitsEn) expect({ k, room, fitsEs }).toEqual({ k, room, fitsEs: true })
      }
  })
  it('a form never ends empty, and English keeps its exact forms', () => {
    for (const k of WIDGET_FORM_KEYS) for (const f of [...forms(en[k]), ...forms(es[k] as string)]) expect(f.trim()).not.toBe('')
    expect(forms(en['widget.saving.label'])).toEqual(['rounds up from every swap', 'from your swaps', 'from swaps'])
  })
})

describe('the headline and state line in Spanish', () => {
  it('a wide widget gets the long forms, a narrow one the short', () => {
    writeLangChoice('es')
    const wide = widgetHeadline(saving, { parts: [] }, NOW, '$14,98', true)
    expect([wide.big, wide.label, wide.line]).toEqual(['$1,35 de $2,00', 'redondea cada swap', '$14,98 en tu jardín'])
    const narrow = widgetHeadline(saving, { parts: [] }, NOW, '$14,98', true, { big: (x) => x.length <= 6, label: (x) => x.length <= 12, line: (x) => x.length <= 16 })
    expect([narrow.big, narrow.label, narrow.line]).toEqual(['$1,35', 'de tus swaps', '$14,98 en jardín'])
  })
  it('nothing yet, a paused garden and a wallet out of USDC', () => {
    writeLangChoice('es')
    const none = widgetHeadline({ ...saving, nextPlanting: { ...saving.nextPlanting, pendingCents: 0 } } as MeResponse, { parts: [] }, NOW, '$0,00', false)
    expect([none.big, none.label, none.line]).toEqual(['Tu jardín', 'Esperando tu primer swap', 'Tus redondeos se plantan al llegar a $2,00'])
    const wallets = [{ pubkey: 'W', status: 'paused', pause: { reason: 'no_usdc' } }]
    const paused = widgetHeadline({ ...saving, wallets } as unknown as MeResponse, { parts: [] }, NOW, '$14,98', true)
    expect([paused.big, paused.label]).toEqual(['En pausa: falta USDC', 'Abre Sprouts para agregar USDC a tu billetera'])
    expect(widgetStateLine({ ...saving, wallets } as unknown as MeResponse, { parts: [], unrevealed: 0 }, NOW).text).toBe('Falta USDC en tu billetera')
    expect(widgetStateLine(saving, { parts: [], unrevealed: 0 }, NOW).text).toBe('+$1,35 en espera')
  })
})

describe('a language change reaches what lives outside React', () => {
  type El = ReactElement<{ text?: string; children?: unknown }>
  const textsOf = (e: El): string[] => [...(e.props.text ? [e.props.text] : []), ...([] as unknown[]).concat(e.props.children ?? []).flat().filter(Boolean).flatMap((c) => textsOf(c as El))]
  it('writeLangChoice redraws both placed widgets, in the new language', async () => {
    w.update.mockClear()
    writeLangChoice('es')
    await Promise.resolve()
    expect(w.update.mock.calls.map((c) => c[0].widgetName)).toEqual(['Sprouts', 'SproutsEnso'])
    const drawn = w.update.mock.calls[0][0].renderWidget({ width: 206, height: 205 }) as El
    const inner = (drawn.type as (p: object) => El)(drawn.props)
    expect(textsOf(inner)).toContain('Abre Sprouts para iniciar sesión')
  })
  it('the channel keeps its id and takes the Spanish name; a channel not made yet is not created', async () => {
    n.set.mockClear()
    writeLangChoice('es')
    await vi.waitFor(() => expect(n.set).toHaveBeenCalledWith('plantings', { name: 'Plantaciones', importance: 3 }))
    n.set.mockClear(); n.get.mockResolvedValueOnce(null)
    writeLangChoice('en')
    await new Promise((r) => setTimeout(r, 0))
    expect(n.set).not.toHaveBeenCalled()
  })
})

describe('Add a widget and the loading line', () => {
  it('Spanish lines for the row, the styles and the hints', () => {
    expect(t('addWidget.add', { name: t('addWidget.bamboo', undefined, 'es') }, 'es')).toBe('Agregar el widget Bambú')
    expect(t('addWidget.resize', undefined, 'es')).toBe('Mantén presionado un widget para cambiar su tamaño.')
    expect(t('splash.loading', undefined, 'es')).toBe('Cargando tu jardín...')
    expect(t('notify.channel', undefined, 'en')).toBe('Plantings')
  })
})
