# Sprouts, the app

The Seeker app of the Sprouts repo. The root README describes the product.

## Commands

- `pnpm dev` starts Metro for the dev client (install a development build on the device first).
- `pnpm test` runs the Vitest suite.
- `pnpm exec tsc --noEmit` type-checks the app.

## Where things live

- `src/model`: pure models, tested in node.
- `src/garden`: the garden canvas and the home-screen widget.
- `src/app/(tabs)`: the screens.
- `src/lib`: the API client and the formatters.
