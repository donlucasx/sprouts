import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { POST as terms } from "@/app/api/terms/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
describe("POST /api/terms (R283)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => { process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret"; repo = new MemoryRepo(); setRepoForTests(repo); await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null }); });
  const post = async (body: unknown) => terms(new Request("http://x/api/terms", { method: "POST", headers: { authorization: `Bearer ${await issueSession(U, "M")}` }, body: JSON.stringify(body) }));
  it("records the current version and an event", async () => {
    const res = await post({ version: "2026-10-07" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acceptedVersion).toBe("2026-10-07");
    expect(Object.keys(body).sort()).toEqual(["acceptedAt", "acceptedVersion"]);
    expect(new Date(body.acceptedAt).toISOString()).toBe(body.acceptedAt);
    expect((await repo.getUser(U))!.termsVersion).toBe("2026-10-07");
    expect(repo.events.map((e) => e.kind)).toContain("terms_accepted");
  });
  it("a second acceptance keeps the first time and adds no event (M2)", async () => {
    const first = await (await post({ version: "2026-10-07" })).json();
    await new Promise((r) => setTimeout(r, 5));
    const again = await (await post({ version: "2026-10-07" })).json();
    expect(again.acceptedAt).toBe(first.acceptedAt);
    expect((await repo.getUser(U))!.termsAcceptedAt!.toISOString()).toBe(first.acceptedAt);
    expect(repo.events.filter((e) => e.kind === "terms_accepted")).toHaveLength(1);
  });
  it("R365: a user who accepted the old version is asked again, accepts the new one once, and the old one is refused", async () => {
    await repo.setTermsAccepted(U, "2026-10-06", new Date("2026-10-06T10:00:00Z"));
    expect((await post({ version: "2026-10-06" })).status).toBe(400);
    const res = await post({ version: "2026-10-07" });
    expect(res.status).toBe(200);
    expect((await res.json()).acceptedVersion).toBe("2026-10-07");
    expect((await repo.getUser(U))!.termsVersion).toBe("2026-10-07");
    expect(repo.events.filter((e) => e.kind === "terms_accepted")).toHaveLength(1);
  });
  it("refuses another version, and a bad body", async () => {
    expect((await post({ version: "2026-01-01" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await repo.getUser(U))!.termsVersion).toBeNull();
  });
  it("401 without a session", async () => {
    expect((await terms(new Request("http://x/api/terms", { method: "POST", body: JSON.stringify({ version: "2026-10-07" }) }))).status).toBe(401);
  });
});
