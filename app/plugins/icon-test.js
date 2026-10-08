// R454 (10-08): icons 2 and 3 side by side on the home screen, DEV BUILDS ONLY (app.config.js adds this plugin when ICON_TEST=1).
// Two extra launcher entries, "Sprouts 2" and "Sprouts 3", open the same app with each candidate icon as an adaptive icon.
const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')

const VARIANTS = ['v2', 'v3']

function withIconFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res')
      const src = path.join(cfg.modRequest.projectRoot, 'assets/icon-test')
      fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true })
      fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true })
      for (const v of VARIANTS) {
        fs.copyFileSync(path.join(src, `${v}-foreground.png`), path.join(res, 'drawable-nodpi', `icontest_${v}_fg.png`))
        fs.copyFileSync(path.join(src, `${v}-background.png`), path.join(res, 'drawable-nodpi', `icontest_${v}_bg.png`))
        fs.writeFileSync(
          path.join(res, 'mipmap-anydpi-v26', `icontest_${v}.xml`),
          `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@drawable/icontest_${v}_bg"/>\n  <foreground android:drawable="@drawable/icontest_${v}_fg"/>\n</adaptive-icon>\n`,
        )
      }
      return cfg
    },
  ])
}

function withAliases(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0]
    app['activity-alias'] = app['activity-alias'] || []
    for (const v of VARIANTS) {
      app['activity-alias'].push({
        $: {
          'android:name': `.IconTest${v.toUpperCase()}`,
          'android:targetActivity': '.MainActivity',
          'android:icon': `@mipmap/icontest_${v}`,
          'android:roundIcon': `@mipmap/icontest_${v}`,
          'android:label': `Sprouts ${v.slice(1)}`,
          'android:exported': 'true',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }],
      })
    }
    return cfg
  })
}

module.exports = (config) => withAliases(withIconFiles(config))
