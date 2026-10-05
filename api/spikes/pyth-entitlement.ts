// Spike S4, step 1 (contracts 9): can PYTH_API_KEY read the four feeds the leash prices? Prints status and age per feed, never the key.
// Run: cd api && pnpm tsx --env-file=.env.local spikes/pyth-entitlement.ts
export {};
const FEEDS: Record<string, string> = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  CBBTC: "2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97",
  ORE: "142b804c658e14ff60886783e46e5a51bdf398b4871d9d8f7c28aa1585cad504",
  SKR: "38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf9",
};
const key = process.env.PYTH_API_KEY;
if (!key) throw new Error("PYTH_API_KEY is not set in .env.local");
let entitled = 0;
for (const [name, id] of Object.entries(FEEDS)) {
  const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}&encoding=base64&parsed=true`, { headers: { authorization: `Bearer ${key}` } });
  const text = await res.text();
  if (!res.ok) {
    console.log(`${name} ${res.status} ${text.slice(0, 110)}`);
    continue;
  }
  const body = JSON.parse(text) as { parsed?: { price: { price: string; expo: number; publish_time: number } }[]; binary?: { data: string[] } };
  const p = body.parsed?.[0]?.price;
  const age = p ? Math.round(Date.now() / 1000 - p.publish_time) : null;
  console.log(`${name} 200 price ${p?.price}e${p?.expo} age ${age}s vaa ${body.binary?.data?.[0]?.length ?? 0} b64 chars`);
  entitled++;
}
console.log(`entitled ${entitled}/4`);
