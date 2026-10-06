// Read-only: which Wormhole program holds the guardian set that signed a recorded Hermes update, and how many keys it has.
// Usage: pnpm tsx --env-file=.env.local spikes/pyth-guardian-check.ts [fixture name, default skr]
import { readFileSync } from "node:fs";
import path from "node:path";
import { address } from "@solana/kit";
import { getGuardianSetPda, DEFAULT_WORMHOLE_PROGRAM_ID, PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID } from "@pythnetwork/pyth-solana-receiver/address";
import { rpc } from "../src/lib/rpc";

const name = process.argv[2] ?? "skr";
const body = JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../tests/fixtures/hermes-${name}-update.json`), "utf8"));
// Accumulator update: "PNAU", major, minor, trailing header size + header, update type, u16 BE VAA length, the VAA.
const acc = Buffer.from(body.binary.data[0], "base64");
const at = 7 + acc[6] + 1;
const u = { vaa: acc.subarray(at + 2, at + 2 + acc.readUInt16BE(at)) };
const gsi = u.vaa.readUInt32BE(1);
console.log(`vaa ${u.vaa.length} B, signatures ${u.vaa[5]}, guardian set ${gsi}`);
for (const [label, prog] of [["default", DEFAULT_WORMHOLE_PROGRAM_ID], ["pro-compatible", PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID]] as const) {
  for (const idx of [gsi]) {
    const pda = getGuardianSetPda(idx, prog).toBase58();
    const info = await rpc().getAccountInfo(address(pda), { encoding: "base64" }).send();
    const data = info.value ? Buffer.from(info.value.data[0], "base64") : null;
    // GuardianSet (anchor): disc 8, index u32, keys vec<[u8;20]> (u32 len + 20 each), creation_time, expiration_time
    console.log(`${label} wormhole ${prog.toBase58()} guardian set ${idx} ${pda}: ${data ? `exists, ${data.length} B, keys ${data.readUInt32LE(12)}, owner ${info.value!.owner}` : "MISSING"}`);
  }
}
