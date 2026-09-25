import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

vi.mock("@/lib/subscriptions", async (orig) => ({
  ...(await orig<object>()),
  readDelegation: vi.fn(async () => ({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n })),
  delegationPda: vi.fn(async () => "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"),
}));
vi.mock("@/lib/helius", () => ({ heliusAddAddress: vi.fn(async () => undefined) }));
vi.mock("@/lib/puller", () => ({ pullerSigner: vi.fn(async () => ({ address: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1" })) }));
vi.mock("@/lib/rpc", () => ({
  rpc: () => ({ getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }) }),
}));

import { POST as newCode } from "@/app/api/link/new/route";
import { GET as getTx } from "@/app/api/link/[code]/route";
import { POST as confirm } from "@/app/api/link/confirm/route";

const WALLET = "9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm";
const OTHER = "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6";

beforeAll(() => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  process.env.HELIUS_WEBHOOK_ID ??= "hook-1";
});

async function mintCode(repo: MemoryRepo) {
  const token = await issueSession("U");
  const res = await newCode(new Request("http://x/api/link/new", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  return (await res.json()) as { code: string; expiresAt: string };
}

describe("link flow", () => {
  let repo: MemoryRepo;

  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: "lucas.skr" });
  });

  it("issues a code, returns an unsigned transaction, links on confirm", async () => {
    const c = await mintCode(repo);
    expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
    expect(typeof t.transaction).toBe("string");
    expect(t.cap).toBe(500);
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET }) }));
    expect(await r.json()).toEqual({ linked: true, skrName: "lucas.skr" });
    expect((await repo.getWallet(WALLET))?.userPubkey).toBe("U");
    expect((await repo.getWallet(WALLET))?.delegationPda).toBe("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");
  });

  it("binds the code to the first wallet that fetches it", async () => {
    const c = await mintCode(repo);
    await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    const second = await getTx(new Request(`http://x/api/link/${c.code}?wallet=${OTHER}`), { params: Promise.resolve({ code: c.code }) });
    expect(second.status).toBe(409);
  });

  it("does not burn the code when the delegation is not on chain yet", async () => {
    const { readDelegation } = await import("@/lib/subscriptions");
    (readDelegation as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n });
    const c = await mintCode(repo);
    await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET, waitMs: 0 }) }));
    expect(r.status).toBe(409);
    expect(await repo.peekLinkCode(c.code)).not.toBeNull();
    (readDelegation as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n });
  });

  it("refuses an unknown or used code", async () => {
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: "ZZZZZZ", wallet: WALLET }) }));
    expect(r.status).toBe(404);
  });

  it("requires a session to mint a code", async () => {
    expect((await newCode(new Request("http://x/api/link/new", { method: "POST" }))).status).toBe(401);
  });
});
