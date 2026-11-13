import { describe, it, expect } from "vitest";
import { appErrorsLight } from "@/lib/ops/lights";

const e = (...steps: string[]) => steps.map((step) => ({ step }));

describe("appErrorsLight", () => {
  it("green with no errors", () => {
    const l = appErrorsLight({ errors: [] });
    expect(l).toMatchObject({ key: "appErrors", label: "App errors", state: "green" });
    expect(l.action).toBeUndefined();
  });
  it("amber for 1 and 2 on non-withdraw routes, plain-English fact", () => {
    expect(appErrorsLight({ errors: e("topup/confirm") })).toMatchObject({ state: "amber", fact: "1 app error in the last 24 hours (topup confirm)", action: "Ask Claude to check them today." });
    expect(appErrorsLight({ errors: e("pause", "pause") })).toMatchObject({ state: "amber", fact: "2 app errors in the last 24 hours (pause)" });
  });
  it("red for 3 or more", () => {
    expect(appErrorsLight({ errors: e("pause", "rules", "moves/build") })).toMatchObject({ state: "red", fact: "3 app errors in the last 24 hours (pause, rules, moves build)" });
  });
  it("red for any single error on a withdraw route, including cancel and lend withdraw", () => {
    expect(appErrorsLight({ errors: e("withdraw/confirm") })).toMatchObject({ state: "red", fact: "1 app error in the last 24 hours (withdraw confirm)" });
    expect(appErrorsLight({ errors: e("withdraw/cancel/build") }).state).toBe("red");
    expect(appErrorsLight({ errors: e("lend/withdraw/build") }).state).toBe("red");
  });
  it("lists at most 3 route names", () => {
    expect(appErrorsLight({ errors: e("pause", "rules", "rules/undo", "relink/build") }).fact).toBe("4 app errors in the last 24 hours (pause, rules, rules undo, and 1 more)");
  });
  it("never prints a raw step it does not know as anything but words", () => {
    expect(appErrorsLight({ errors: e("revoke/[wallet]") }).fact).toContain("(revoke)");
  });
});
