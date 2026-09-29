// Read-only look at the Saga Genesis Token on mainnet through Helius DAS (the key comes from the env file via config(); nothing secret is
// printed). With no argument: the collection's own asset and two members (to see the shape and find holders). With a wallet: the
// documented holder check, searchAssets by owner and collection, printing each hit's fields. Used to confirm a Saga's address before sign-in.
// Run from api/: pnpm tsx --env-file=.env.local spikes/saga-genesis.ts [wallet]
import { config } from "../src/lib/config";

const COLLECTION = "46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC";

async function das(method: string, params: Record<string, unknown>) {
  const res = await fetch(config().heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "saga", method, params }) });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as Record<string, unknown>;
}

function brief(a: Record<string, unknown>) {
  const own = (a.ownership ?? {}) as Record<string, unknown>;
  const grouping = (a.grouping ?? []) as { group_key: string; group_value: string }[];
  return { id: a.id, interface: a.interface, token_program: (a as { token_info?: { token_program?: string } }).token_info?.token_program ?? null, burnt: a.burnt, frozen: own.frozen, delegated: own.delegated, owner: own.owner, grouping };
}

const wallet = process.argv[2];
if (!wallet) {
  const col = await das("getAsset", { id: COLLECTION });
  console.log("collection:", JSON.stringify({ id: col.id, interface: col.interface, name: (col.content as { metadata?: { name?: string } })?.metadata?.name }));
  const members = await das("getAssetsByGroup", { groupKey: "collection", groupValue: COLLECTION, page: 1, limit: 2 });
  console.log("total in collection:", members.total);
  for (const it of members.items as Record<string, unknown>[]) console.log("member:", JSON.stringify(brief(it)));
  console.log("\nraw first member (for the test fixture):");
  console.log(JSON.stringify((members.items as unknown[])[0], null, 1).slice(0, 4000));
} else {
  const r = await das("searchAssets", { ownerAddress: wallet, grouping: ["collection", COLLECTION], page: 1, limit: 50 });
  console.log(`searchAssets for ${wallet}: total ${r.total}`);
  for (const it of r.items as Record<string, unknown>[]) console.log("hit:", JSON.stringify(brief(it)));
  if (!(r.items as unknown[]).length) console.log("no Saga Genesis Token in this wallet");
}
