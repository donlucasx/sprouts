// Creates the one Helius webhook for SWAP transactions, pointing at APP_ORIGIN/api/webhooks/helius, and prints its id.
// Run once after the first deploy, from api/: pnpm tsx --env-file=.env.local scripts/helius-webhook.ts <first wallet address>
// (Helius needs at least one address at creation; later wallets are added by the link flow.) Then put the id into HELIUS_WEBHOOK_ID (env file and Vercel).
import { heliusCreateWebhook } from "../src/lib/helius";
import { config } from "../src/lib/config";

const seed = process.argv.slice(2);
if (seed.length === 0) { console.log("usage: helius-webhook.ts <first wallet address> [more...]"); process.exit(1); }
const webhookUrl = `${config().appOrigin}/api/webhooks/helius`;
const { webhookID } = await heliusCreateWebhook({ webhookUrl, authHeader: `Bearer ${config().heliusWebhookSecret}`, accountAddresses: seed });
console.log(`webhook created for ${webhookUrl}`);
console.log(`HELIUS_WEBHOOK_ID=${webhookID}`);
