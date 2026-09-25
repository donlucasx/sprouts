// Resolves a .skr name to its owner (the Seed Vault key), checks the owner holds a Seeker Genesis Token, and reads the reverse name.
// This is Task 11's manual Genesis check. Run from api/: pnpm tsx --env-file=.env.local spikes/resolve-seeker.ts <name.skr>
import { Connection } from "@solana/web3.js";
import { TldParser } from "@onsol/tldparser";
import { config } from "../src/lib/config";
import { verifyGenesisHolder } from "../src/lib/genesis";
import { skrNameOf } from "../src/lib/skr";
import { readPosition } from "../src/lib/staking";
import { address } from "@solana/kit";

const name = (process.argv[2] ?? "").toLowerCase();
if (!name.endsWith(".skr")) { console.log("usage: resolve-seeker.ts <name.skr>"); process.exit(1); }
const rpcUrl = config().heliusRpcUrl;
const parser = new TldParser(new Connection(rpcUrl, "confirmed"));
const owner = await parser.getOwnerFromDomainTld(name);
if (!owner) { console.log(`${name}: no owner found`); process.exit(1); }
const ownerStr = typeof owner === "string" ? owner : owner.toBase58();
console.log(`${name} -> ${ownerStr}`);
console.log(`reverse (main .skr of that key): ${await skrNameOf(rpcUrl, ownerStr)}`);
const genesis = await verifyGenesisHolder(rpcUrl, ownerStr);
console.log(genesis ? `GENESIS OK, mint ${genesis.mint}` : "GENESIS MISSING: this key holds no Seeker Genesis Token");
const pos = await readPosition(address(ownerStr));
console.log(`SKR position: ${pos.stakedRaw} raw staked`);
