// Signs in against a deployment with a fresh throwaway key and prints the gate's answer. No secrets, no env file: the key is made
// here and thrown away; it holds no Genesis Token, so the expected answer is the 403 and its copy tells which gate is live
// ("Seeker or a Saga" = R86). A nonce is consumed; no user row is created.
// Run from api/: pnpm tsx spikes/gate-probe.ts [origin, default https://sprouts-api-gamma.vercel.app]
import { generateKeyPairSigner, signBytes, getUtf8Encoder } from "@solana/kit";
import { renderSignInMessage, type SignInInput } from "../src/lib/siws";

const origin = process.argv[2] ?? "https://sprouts-api-gamma.vercel.app";
const key = await generateKeyPairSigner();
const nonceRes = await fetch(`${origin}/api/auth/nonce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: key.address }) });
const input = (await nonceRes.json()) as SignInInput;
if (!nonceRes.ok) { console.log("nonce:", nonceRes.status, JSON.stringify(input)); process.exit(1); }
const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
const signature = new Uint8Array(await signBytes(key.keyPair.privateKey, message));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const verifyRes = await fetch(`${origin}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, output: { address: key.address, signedMessage: b64(message), signature: b64(signature) }, device: "gate-probe" }) });
console.log(`verify: ${verifyRes.status} ${await verifyRes.text()}`);
