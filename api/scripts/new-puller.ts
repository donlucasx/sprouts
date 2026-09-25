// Generates the puller keypair and writes its private key straight into .env.local (PULLER_SECRET_KEY, 32 random bytes as base64url).
// Prints only the public address. Run once from api/: pnpm tsx scripts/new-puller.ts
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const envPath = path.join(import.meta.dirname, "../.env.local");
let env = readFileSync(envPath, "utf8");
if (/^PULLER_SECRET_KEY=\S/m.test(env)) {
  console.log("PULLER_SECRET_KEY is already set in .env.local; refusing to overwrite.");
  process.exit(1);
}
const bytes = randomBytes(32);
const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(bytes));
env = env.replace(/^PULLER_SECRET_KEY=.*$/m, `PULLER_SECRET_KEY=${bytes.toString("base64url")}`);
writeFileSync(envPath, env, { mode: 0o600 });
console.log(`PULLER_ADDRESS=${signer.address}`);
console.log("Private key written to .env.local. Fund this address with 0.05 SOL, 2 SKR and 0.10 USDC.");
