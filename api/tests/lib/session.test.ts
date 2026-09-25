import { describe, it, expect, beforeAll } from "vitest";
import { issueSession, readSession } from "@/lib/session";

beforeAll(() => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
});

describe("sessions", () => {
  it("issue then read returns the pubkey", async () => {
    const token = await issueSession("PUBKEY1");
    expect(await readSession(token)).toBe("PUBKEY1");
  });

  it("a tampered token reads null", async () => {
    const token = await issueSession("PUBKEY1");
    expect(await readSession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await readSession("not-a-token")).toBeNull();
  });
});
