import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * 11-27: a component compiled the way Metro compiles it (babel-plugin-react-compiler, app.json experiments.reactCompiler), run as ONE
 * mounted instance: its memo cache is kept across renders, so a line the compiler cached shows up as a stale line here too.
 * Modules it imports come from `mods`; any other import is a stand-in whose members are host-component names.
 */
export const appRoot = path.resolve(__dirname, '../..')
const fromExpo = createRequire(createRequire(path.join(appRoot, 'package.json')).resolve('expo/package.json'))
const fromPreset = createRequire(fromExpo.resolve('babel-preset-expo/package.json'))
const babel = fromPreset('@babel/core') as { transformSync: (code: string, opts: object) => { code?: string | null } | null }
const SENTINEL = Symbol.for('react.memo_cache_sentinel')

export function compile(source: string, filename = 'Component.tsx'): string {
  const out = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [[fromPreset.resolve('@babel/preset-typescript'), { isTSX: true, allExtensions: true }]],
    plugins: [
      [fromPreset.resolve('babel-plugin-react-compiler'), {}],
      [fromPreset.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }],
      fromPreset.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  })
  return out?.code ?? ''
}

type El = { type: unknown; props: Record<string, unknown> }
const standIn = (name: string) => new Proxy({}, { get: (_t, k) => (k === '__esModule' ? false : typeof k === 'string' ? `${name}.${k}` : undefined) })

/** Every string a rendered tree shows or speaks (children, title, accessibilityLabel). */
export function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(texts)
  if (node && typeof node === 'object' && 'props' in node) {
    const p = (node as El).props
    return [...['title', 'accessibilityLabel'].flatMap((k) => (typeof p[k] === 'string' ? [p[k] as string] : [])), ...texts(p.children)]
  }
  return []
}

/** Mounts `exportName` from the compiled source; each call of the result is one re-render of the same instance. */
export function mount<P>(source: string, exportName: string, mods: Record<string, unknown>, props: P): { render: () => string[]; compiled: string } {
  const compiled = compile(source)
  let cache: unknown[] | null = null
  const all: Record<string, unknown> = {
    'react/compiler-runtime': { c: (n: number) => (cache ??= new Array(n).fill(SENTINEL)) },
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }), Fragment: 'Fragment' },
    react: { useState: <T,>(v: T | (() => T)) => [typeof v === 'function' ? (v as () => T)() : v, () => {}] },
    ...mods,
  }
  const exports: Record<string, unknown> = {}
  // the source is this repo's own component file, compiled above
  new Function('require', 'exports', compiled)((m: string) => (m in all ? all[m] : standIn(m)), exports)
  const C = exports[exportName] as (p: P) => unknown
  return { render: () => texts(C(props)), compiled }
}
