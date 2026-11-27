import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as i18n from '@/i18n'
import { stub } from '../stubs/expo-localization'
import { appRoot, mount } from '../helpers/compiled'

/**
 * 11-27 tab-label bug (his device test on build 3: the app in English, the tab names still Jardín/Reglas/Actividad/Ajustes). The
 * cause: the React Compiler (app.json experiments.reactCompiler) caches `t(k)` on its arguments; `useLang()` called only for its
 * re-render is not one of them, so every re-render handed back the first render's name. This compiles the real TabLabel with the
 * same compiler Metro runs, renders it on ONE memo cache (the same mounted label) and switches the language in between.
 */
const mods = {
  'react-native': { Text: 'Text' },
  '@/theme': { FONT: { label: 'label' } },
  '@/i18n': i18n,
  '@/i18n/useLang': { useLang: () => i18n.currentLang() }, // what useSyncExternalStore hands the render
}
const label = (src: string) => {
  const m = mount(src, 'TabLabel', mods, { k: 'tabs.garden', color: '#000' })
  expect(m.compiled).toContain('react/compiler-runtime') // the compiler did compile it (a bail-out would hide the bug)
  return () => m.render()[0]
}

describe('tab labels follow a language switch without a restart (11-27)', () => {
  beforeEach(() => { stub.languageCode = 'es'; i18n.writeLangChoice('auto') })
  const src = readFileSync(path.join(appRoot, 'src/components/TabLabel.tsx'), 'utf8')

  it('es -> en -> es on the same mounted label', () => {
    const render = label(src)
    expect(render()).toBe('Jardín')
    i18n.writeLangChoice('en')
    expect(render()).toBe('Garden')
    i18n.writeLangChoice('es')
    expect(render()).toBe('Jardín')
  })
  it('en -> es -> en on the same mounted label', () => {
    i18n.writeLangChoice('en')
    const render = label(src)
    expect(render()).toBe('Garden')
    i18n.writeLangChoice('es')
    expect(render()).toBe('Jardín')
    i18n.writeLangChoice('en')
    expect(render()).toBe('Garden')
  })
  it("build 3's label (useLang() unused, t(k)) is the bug: the compiled label keeps its first name", () => {
    const build3 = src.replace('const lang = useLang()', 'useLang()').replace('t(k, undefined, lang)', 't(k)')
    expect(build3).not.toBe(src)
    const render = label(build3)
    expect(render()).toBe('Jardín')
    i18n.writeLangChoice('en')
    expect(render()).toBe('Jardín')
  })
  it('the tab bar uses this label for all four tabs, and the titles get the language too', () => {
    const layout = readFileSync(path.join(appRoot, 'src/app/(tabs)/_layout.tsx'), 'utf8')
    expect(layout).toContain("from '@/components/TabLabel'")
    for (const k of ['garden', 'rules', 'activity', 'settings']) {
      expect(layout).toContain(`tabBarLabel: label('tabs.${k}')`)
      expect(layout).toContain(`title: t('tabs.${k}', undefined, lang)`)
    }
  })
})
