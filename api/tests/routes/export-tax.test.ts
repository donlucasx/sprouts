import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { GET as exportTax } from "@/app/api/export/tax/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

describe("GET /api/export/tax (R447)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  });
  const call = async (query = "", pubkey = U) =>
    exportTax(new Request(`http://x/api/export/tax${query}`, { headers: { authorization: `Bearer ${await issueSession(pubkey, "M")}` } }));
  const base = { userPubkey: U, walletPubkey: "W", usdcPulledCents: 1000, networkFeeCents: 0, status: "confirmed" as const, aiLine: null };
  const skrLeg = { asset: "SKR" as const, venue: null, usdcInCents: 1000, amountOutRaw: 545_123_456n, staked: true, feeAmountRaw: 0n, feeCents: 5, rateAtPlanting: null };

  it("refuses without a session", async () => {
    const res = await exportTax(new Request("http://x/api/export/tax"));
    expect(res.status).toBe(401);
    const bad = await exportTax(new Request("http://x/api/export/tax", { headers: { authorization: "Bearer nope" } }));
    expect(bad.status).toBe(401);
  });

  it("answers text/csv with a filename: header, then every event type, oldest first; another user's rows never appear", async () => {
    await repo.insertPlanting({ ...base, signature: "sigP", ts: new Date("2026-02-01T10:00:00Z") }, [skrLeg]);
    await repo.insertPlanting({ ...base, signature: "sigL", ts: new Date("2026-02-02T10:00:00Z") }, [{ asset: "USDC_LEND", venue: "kamino_klend", usdcInCents: 200, amountOutRaw: 1_661_072n, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: 1.2 }]);
    await repo.insertPlanting({ ...base, signature: "sigF", status: "failed", ts: new Date("2026-02-03T10:00:00Z") }, [skrLeg]);
    await repo.insertPlanting({ ...base, userPubkey: OTHER, signature: "sigOther", ts: new Date("2026-02-04T10:00:00Z") }, [skrLeg]);
    const w = await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "sprouts", unstakeSignature: "sigU", sharesUnstaked: 1n, amountRaw: 1_050_000_000n, principalRaw: 1_000_000_000n });
    w.unstakeTs = new Date("2026-03-01T12:00:00Z");
    await repo.setWithdrawalDone(w.id, "sigW", 1_050_000_000n);
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1661072", underlyingRaw: "2001591", signature: "sigR" } });
    (await repo.listEvents(U, ["lend_withdrawn"], 10))[0].ts = new Date("2026-04-01T00:00:00Z");

    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="sprouts-tax-all-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency,Tag,Description,TxHash");
    const hashes = lines.slice(1).map((l) => l.split(",").at(-1));
    expect(hashes).toEqual(["sigP", "sigL", "sigU", "sigW", "sigR"]);
    expect(lines.join("\n")).not.toContain("sigOther");
    expect(lines.join("\n")).not.toContain("sigF");
    expect(lines[3]).toContain(",reward,");
  });

  it("?year keeps one UTC year; a malformed year is a 400", async () => {
    await repo.insertPlanting({ ...base, signature: "s2025", ts: new Date("2025-12-31T23:59:59Z") }, [skrLeg]);
    await repo.insertPlanting({ ...base, signature: "s2026", ts: new Date("2026-01-01T00:00:00Z") }, [skrLeg]);
    const res = await call("?year=2026");
    expect(res.headers.get("content-disposition")).toContain('filename="sprouts-tax-2026-');
    const body = await res.text();
    expect(body).toContain("s2026");
    expect(body).not.toContain("s2025");
    expect((await call("?year=26")).status).toBe(400);
    expect((await call("?year=abcd")).status).toBe(400);
  });

  it("no history: just the header", async () => {
    const res = await call();
    expect((await res.text()).trimEnd().split("\r\n")).toHaveLength(1);
  });
});
