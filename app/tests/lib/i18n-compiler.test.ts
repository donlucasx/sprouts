import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import * as i18n from '@/i18n'
import { stub } from '../stubs/expo-localization'
import { appRoot, compile, mount } from '../helpers/compiled'

/**
 * 11-27 (the tab-label bug's whole class): the React Compiler caches a line on the arguments of the call that makes it, so a
 * component that reads its words through t() or a text helper (TOPUP, plantCard, ...) without the language as an argument keeps
 * the first language it rendered in. Every component file that shows translated words either opts out of the compiler
 * ('use no memo' at the top of the file) or passes the language into every t() call and uses no text helper.
 */
const SRC = path.join(appRoot, 'src')
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const rel = (p: string) => path.relative(SRC, p)
const all = walk(SRC)
const screens = all.filter((p) => p.endsWith('.tsx') && !/\/dev-[^/]*\.tsx$/.test(p))

/** Value imports only (`import type` makes no words). */
const valueImports = (s: string) => [...s.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
const resolve = (spec: string): string | null => {
  if (!spec.startsWith('@/')) return null
  const b = path.join(SRC, spec.slice(2))
  for (const e of ['.ts', '.tsx', '/index.ts']) if (existsSync(b + e)) return b + e
  return null
}
/** .ts modules that read the language (they import @/i18n): the text helpers. */
const textModules = new Set(all.filter((p) => p.endsWith('.ts') && !p.includes(`${path.sep}i18n${path.sep}`) && valueImports(readFileSync(p, 'utf8')).some((s) => s.startsWith('@/i18n'))))
const NO_MEMO = /^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]use no memo['"]/
/** Files that import a text helper for something that is not words (reviewed 11-27). */
const WORDLESS: Record<string, string> = {
  [path.join('app', '_layout.tsx')]: 'lib/notify for the permission prompt and the channel, no words on screen',
  [path.join('components', 'ProBadge.tsx')]: "model/manager's PRO_BADGE, the constant \"Pro\"",
}

/** The code without its comments (a comment that says "t(k)" is not a call). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1')
/** Every call of `fn(` in `s` (comments left out), as the text between its parentheses. */
function calls(src: string, fn: string): string[] {
  const s = code(src)
  const out: string[] = []
  const re = new RegExp(`(?<![\\w.])${fn}\\(`, 'g')
  for (let m = re.exec(s); m; m = re.exec(s)) {
    let depth = 1, i = m.index + m[0].length
    for (; i < s.length && depth > 0; i++) depth += s[i] === '(' ? 1 : s[i] === ')' ? -1 : 0
    out.push(s.slice(m.index + m[0].length, i - 1))
  }
  return out
}

const files = screens.map((p) => {
  const s = readFileSync(p, 'utf8')
  const imps = valueImports(s)
  const direct = imps.some((x) => x.startsWith('@/i18n'))
  const helpers = imps.map(resolve).filter((r): r is string => r !== null && textModules.has(r)).map(rel)
  const alias = s.match(/^import\s*\{[^}]*\bt(?:\s+as\s+(\w+))?\s*[,}][^;]*from\s+['"]@\/i18n['"]/m)
  return { file: rel(p), s, noMemo: NO_MEMO.test(s), words: direct || helpers.length > 0, helpers, tName: alias ? (alias[1] ?? 't') : null }
})

describe('React Compiler: no component keeps the old language (11-27)', () => {
  it('finds the component files (the scan works)', () => {
    expect(files.length).toBeGreaterThan(40)
    expect(files.filter((f) => f.words).length).toBeGreaterThan(25)
    expect(files.find((f) => f.file === path.join('app', '(tabs)', 'home.tsx'))?.noMemo).toBe(true)
  })
  it('a bare useLang() (called only to re-render) is only in a file the compiler skips', () => {
    expect(files.filter((f) => /^\s*useLang\(\)/m.test(f.s) && !f.noMemo).map((f) => f.file)).toEqual([])
  })
  it("every file with words opts out, or passes the language into every t() and uses no text helper", () => {
    const bad: string[] = []
    for (const f of files.filter((x) => x.words && !x.noMemo && !(x.file in WORDLESS))) {
      if (f.helpers.length) bad.push(`${f.file}: text helpers ${f.helpers.join(', ')} need 'use no memo'`)
      if (!/const lang = useLang\(\)/.test(f.s)) bad.push(`${f.file}: no const lang = useLang()`)
      if (f.tName) for (const c of calls(f.s, f.tName)) if (!/,\s*lang\s*$/.test(c)) bad.push(`${f.file}: ${f.tName}(${c}) without lang`)
    }
    expect(bad).toEqual([])
  })
  it("'use no memo' is honoured: none of those files comes out of the compiler memoized", () => {
    const memoized = files.filter((f) => f.noMemo).filter((f) => compile(f.s, f.file).includes('react/compiler-runtime')).map((f) => f.file)
    expect(files.filter((f) => f.noMemo).length).toBeGreaterThan(20)
    expect(memoized).toEqual([])
  }, 60_000)
  it('the guard catches the bug: a bare useLang() + t(k) file without the opt-out fails the rule', () => {
    const s = "import { t } from '@/i18n'\nimport { useLang } from '@/i18n/useLang'\nexport function X() {\n  useLang()\n  return t('tabs.garden')\n}\n"
    expect(NO_MEMO.test(s)).toBe(false)
    expect(/^\s*useLang\(\)/m.test(s)).toBe(true)
    expect(calls(s, 't')).toEqual(["'tabs.garden'"])
    expect(NO_MEMO.test(`'use no memo' // why\n${s}`)).toBe(true)
  })
})

// ---- the switch, both ways, on real components compiled as Metro compiles them ----
const theme = { FONT: { label: 'label' }, radius: { md: 12, full: 999 }, spacing: { xs: 4, sm: 8, md: 12 }, switchColors: () => ({}), useTheme: () => ({ colors: {} }) }
const mods = { '@/i18n': i18n, '@/i18n/useLang': { useLang: () => i18n.currentLang() }, '@/theme': theme }
const read = (f: string) => readFileSync(path.join(SRC, f), 'utf8')
const optedIn = (s: string) => s.replace(NO_MEMO, (m) => m.replace(/['"]use no memo['"]/, ''))

describe('screens follow a language switch without a restart, both ways (11-27)', () => {
  beforeEach(() => { stub.languageCode = 'en'; i18n.writeLangChoice('auto') })
  const approval = read('components/ApprovalStep.tsx')
  const pause = read('components/PauseRow.tsx')
  const approvalProps = { busy: false, onContinue: () => {}, onBack: () => {} }
  const pauseProps = { on: true, line: 'x', detail: null, busy: true, error: null, onChange: () => {} }

  it('Link a wallet, the approval step: en -> es -> en', () => {
    const { render } = mount(approval, 'ApprovalStep', mods, approvalProps)
    i18n.writeLangChoice('en')
    expect(render()).toEqual(expect.arrayContaining(['One approval, then round-ups run on their own', 'Continue to wallet', 'Back']))
    i18n.writeLangChoice('es')
    expect(render()).toEqual(expect.arrayContaining(['Una aprobación y los redondeos van solos', 'Volver']))
    expect(render()).not.toContain('Back')
    i18n.writeLangChoice('en')
    expect(render()).toContain('Back')
  })
  it('Link a wallet, the approval step: es -> en -> es', () => {
    i18n.writeLangChoice('es')
    const { render } = mount(approval, 'ApprovalStep', mods, approvalProps)
    expect(render()).toContain('Volver')
    i18n.writeLangChoice('en')
    expect(render()).toContain('Back')
    i18n.writeLangChoice('es')
    expect(render()).toContain('Volver')
  })
  it("Rules, Sprouts' own switch while busy: en -> es -> en and es -> en -> es", () => {
    i18n.writeLangChoice('en')
    let { render } = mount(pause, 'PauseRow', mods, pauseProps)
    expect(render()).toContain('Waiting for your wallet.')
    i18n.writeLangChoice('es')
    expect(render()).toContain('Esperando a tu billetera.')
    i18n.writeLangChoice('en')
    expect(render()).toContain('Waiting for your wallet.')
    ;({ render } = mount(pause, 'PauseRow', mods, pauseProps))
    i18n.writeLangChoice('es')
    expect(render()).toContain('Esperando a tu billetera.')
    i18n.writeLangChoice('en')
    expect(render()).toContain('Waiting for your wallet.')
    i18n.writeLangChoice('es')
    expect(render()).toContain('Esperando a tu billetera.')
  })
  it('control: the same approval step left to the compiler keeps its first language (the bug this guards)', () => {
    const compiledAway = optedIn(approval)
    expect(compiledAway).not.toMatch(NO_MEMO)
    const m = mount(compiledAway, 'ApprovalStep', mods, approvalProps)
    expect(m.compiled).toContain('react/compiler-runtime')
    i18n.writeLangChoice('en')
    expect(m.render()).toContain('Back')
    i18n.writeLangChoice('es')
    expect(m.render()).toContain('Back')
  })
})
