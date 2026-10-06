// Records one Hermes latest update (base64 accumulator + parsed price) for a feed into tests/fixtures/, for the posting tests.
// Read-only (one GET); prints the status, the VAA size and the age, never the key. Usage: pnpm tsx --env-file=.env.local spikes/hermes-fixture.ts [SKR|SOL|CBBTC|ORE]
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PYTH_FEED } from "../src/lib/venues/addresses";

const name = (process.argv[2] ?? "SKR") as keyof typeof PYTH_FEED;
const feed = PYTH_FEED[name];
const key = process.env.PYTH_API_KEY;
if (!key) throw new Error("PYTH_API_KEY is not set in the env file");
const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feed}&encoding=base64&parsed=true`, { headers: { authorization: `Bearer ${key}` } });
console.log(`status ${res.status}`);
if (!res.ok) process.exit(1);
const body = (await res.json()) as { binary: { data: string[] }; parsed: { price: { publish_time: number } }[] };
const out = path.resolve(import.meta.dirname, `../tests/fixtures/hermes-${name.toLowerCase()}-update.json`);
writeFileSync(out, JSON.stringify(body, null, 2) + "\n");
console.log(`updates ${body.binary.data.length}, bytes ${body.binary.data.map((d) => Buffer.from(d, "base64").length).join(",")}, age ${Math.floor(Date.now() / 1000) - body.parsed[0].price.publish_time} s -> ${out}`);
