import { describe, it, expect } from "vitest";
import { checkGenesisAccounts, GENESIS } from "@/lib/genesis";

const G = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";

describe("checkGenesisAccounts", () => {
  it("uses Solana Mobile's group address", () => expect(GENESIS).toBe(G));

  it("frozen account is kept", () => {
    expect(checkGenesisAccounts([{ mint: "M1", amount: 1n, frozen: true, metadataPointer: G, group: G }])).toEqual({ mint: "M1" });
  });

  it("empty account is dropped", () => {
    expect(checkGenesisAccounts([{ mint: "M1", amount: 0n, frozen: true, metadataPointer: G, group: G }])).toBeNull();
  });

  it("one field only is rejected", () => {
    expect(checkGenesisAccounts([{ mint: "M1", amount: 1n, frozen: false, metadataPointer: G, group: "Other" }])).toBeNull();
    expect(checkGenesisAccounts([{ mint: "M1", amount: 1n, frozen: false, metadataPointer: null, group: G }])).toBeNull();
  });

  it("returns the first matching mint among many accounts", () => {
    expect(checkGenesisAccounts([
      { mint: "X", amount: 5n, frozen: false, metadataPointer: null, group: null },
      { mint: "M2", amount: 1n, frozen: true, metadataPointer: G, group: G },
    ])).toEqual({ mint: "M2" });
  });
});

// R86: the Saga Genesis Token (a classic Metaplex NFT in a verified collection, frozen and delegated) also opens the vault.
import { checkSagaAssets, parseSearchAssets, verifySagaHolder, verifyAnyGenesisHolder, SAGA_COLLECTION, type SagaAsset } from "@/lib/genesis";

const SAGA = "46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC";
const OWNER = "5gYrc4vuvPFhoxtppzQB9ehdUrVHoYiCTVdQ9VfwbJUB";
const saga = (o: Partial<SagaAsset> = {}): SagaAsset => ({ mint: "JEGg", owner: OWNER, frozen: true, burnt: false, collection: SAGA, ...o });

/** One real member of the collection as Helius DAS returned it on 2026-09-28, trimmed to the fields the check reads plus noise. */
const DAS_ITEM = {
  interface: "V1_NFT", id: "JEGgFk7rYUrVw9mffDpiXjjySDUVYoRGVJuTec7vGjmC",
  content: { metadata: { name: "Saga genesis token", token_standard: "NonFungible" } },
  grouping: [{ group_key: "collection", group_value: SAGA }],
  ownership: { frozen: true, delegated: true, delegate: "En54STTsmVrWA3Cd43SQNgiLrihRDG2iMJD6zWPHjYfW", ownership_model: "single", owner: OWNER },
  burnt: false, token_info: { supply: 1, decimals: 0, token_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
};

describe("checkSagaAssets", () => {
  it("uses Solana Mobile's verified collection address", () => expect(SAGA_COLLECTION).toBe(SAGA));
  it("a frozen, unburnt token of the collection owned by the wallet is the Genesis Token", () => expect(checkSagaAssets([saga()], OWNER)).toEqual({ mint: "JEGg" }));
  it("a burnt token is rejected", () => expect(checkSagaAssets([saga({ burnt: true })], OWNER)).toBeNull());
  it("a token owned by another wallet is rejected", () => expect(checkSagaAssets([saga({ owner: "someone" })], OWNER)).toBeNull());
  it("a token of another collection is rejected", () => expect(checkSagaAssets([saga({ collection: "Other" })], OWNER)).toBeNull());
  it("an unfrozen token is rejected (real ones are frozen)", () => expect(checkSagaAssets([saga({ frozen: false })], OWNER)).toBeNull());
  it("returns the first matching mint among many", () => expect(checkSagaAssets([saga({ mint: "A", burnt: true }), saga({ mint: "B" })], OWNER)).toEqual({ mint: "B" }));
});

describe("parseSearchAssets", () => {
  it("maps the DAS shape to the fields the check reads", () => {
    expect(parseSearchAssets({ total: 1, items: [DAS_ITEM] })).toEqual([{ mint: DAS_ITEM.id, owner: OWNER, frozen: true, burnt: false, collection: SAGA }]);
  });
  it("tolerates a bare item and an empty result", () => {
    expect(parseSearchAssets({ total: 1, items: [{ id: "X" }] })).toEqual([{ mint: "X", owner: null, frozen: false, burnt: false, collection: null }]);
    expect(parseSearchAssets({ total: 0, items: [] })).toEqual([]);
    expect(parseSearchAssets(null)).toEqual([]);
  });
});

describe("verifySagaHolder", () => {
  it("asks DAS searchAssets for the owner within the collection and applies the check", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { total: 1, items: [DAS_ITEM] } }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    expect(await verifySagaHolder("https://rpc.example/x", OWNER, fetchImpl)).toEqual({ mint: DAS_ITEM.id });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://rpc.example/x");
    expect(calls[0].body.method).toBe("searchAssets");
    expect(calls[0].body.params).toMatchObject({ ownerAddress: OWNER, grouping: ["collection", SAGA] });
  });
  it("answers null when the wallet holds none", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { total: 0, items: [] } }))) as typeof fetch;
    expect(await verifySagaHolder("https://rpc.example/x", OWNER, fetchImpl)).toBeNull();
  });
});

describe("verifyAnyGenesisHolder", () => {
  it("a Seeker token wins and the Saga check is never made", async () => {
    let sagaCalls = 0;
    const r = await verifyAnyGenesisHolder("u", OWNER, { seeker: async () => ({ mint: "SEEKER" }), saga: async () => { sagaCalls++; return { mint: "SAGA" }; } });
    expect(r).toEqual({ mint: "SEEKER", kind: "seeker" });
    expect(sagaCalls).toBe(0);
  });
  it("falls back to the Saga token", async () => {
    expect(await verifyAnyGenesisHolder("u", OWNER, { seeker: async () => null, saga: async () => ({ mint: "SAGA" }) })).toEqual({ mint: "SAGA", kind: "saga" });
  });
  it("neither means no token", async () => {
    expect(await verifyAnyGenesisHolder("u", OWNER, { seeker: async () => null, saga: async () => null })).toBeNull();
  });
});
