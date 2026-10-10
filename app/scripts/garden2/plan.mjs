// Garden2 preview, step 1: prints the layer plans that model/garden2.ts composeLayers makes (the SAME function Garden2.tsx draws),
// for the preview stage sets, as JSON on stdout. Node strips the TypeScript types itself; this hook only adds the `.ts` the app's
// extensionless imports leave out. Usage: node scripts/garden2/plan.mjs [viewWidth ...] > plan.json (preview.py runs it for you).
import { registerHooks } from 'node:module'
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const g = await import('../../src/model/garden2.ts')
// a sample saver ~5 weeks in: $2 plantings by the split, SKR leading (stagesFor on a synthetic history, R458's end of day applied)
const now = new Date(2026, 10, 15, 9)
const split = { SKR: 0.4, stORE: 0.15, hSOL: 0.15, USDC_LEND: 0.12, SOL_LEND: 0.1, cbBTC: 0.08 }
const plantings = []
for (let i = 0; i < 12; i++)
  for (const [asset, share] of Object.entries(split))
    plantings.push({ ts: new Date(2026, 9, 10 + i * 3), asset, usdcInCents: Math.round(200 * share * 2.4) })
const sets = {
  empty: g.allStages(0),
  first: g.allStages(1),
  mid: g.allStages(7),
  mature: g.allStages(14),
  mixed: g.stagesFor({ plantings, picks: [], skrPrincipalPickedRaw: 0n }),
}
const out = {}
const widths = process.argv.slice(2).map(Number) // view widths to scale the plan to (Garden2.tsx's scaleRect), px
for (const [name, stages] of Object.entries(sets)) {
  // R533: the trees' earned fruit/flowers at the ladder's cap (12) wherever a stage has spots; none on the bare sets
  const layers = g.composeLayers(stages, name === 'empty' || name === 'first' ? {} : { fruit: { mandarin: 12, store: 12 }, basket: name === 'mixed', stakes: true })
  out[name] = {
    stages,
    layers,
    scaled: Object.fromEntries(
      widths.map((w) => [w, { h: g.viewHeight(w), layers: layers.map((l) => g.scaleRect(l, w)) }]),
    ),
  }
}
process.stdout.write(JSON.stringify(out, null, 1))
