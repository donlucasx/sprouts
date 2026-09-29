import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The React Compiler is on for the whole app (app.json experiments.reactCompiler). It rewrites components to call a caching hook,
// but react-native-android-widget calls the widget component as a plain function outside React, so that hook call throws
// "Invalid Hook Call detected in SproutsWidget" (the Saga, 2026-09-29). The library's fix: opt the widget file out of the compiler.
describe("the widget file opts out of the React Compiler", () => {
  it("starts with the \"use no memo\" directive", () => {
    const src = readFileSync(path.join(__dirname, "../../src/garden/Widget.tsx"), "utf8");
    const firstStatement = src.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "").split("\n")[0].trim();
    expect(firstStatement).toBe('"use no memo";');
  });
});
