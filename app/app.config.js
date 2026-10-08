// app.json stays the config; this only adds the dev-only icon test (R454) when ICON_TEST=1 (eas.json development profile).
module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), ...(process.env.ICON_TEST === '1' ? ['./plugins/icon-test'] : [])],
})
