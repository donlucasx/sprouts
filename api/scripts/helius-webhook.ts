// Creates the one Helius webhook for SWAP transactions, pointing at APP_ORIGIN/api/webhooks/helius, and prints its id.
// Run once after the first deploy, from api/: pnpm tsx --env-file=.env.local scripts/helius-webhook.ts
// Then put the id into HELIUS_WEBHOOK_ID (env file and Vercel).
import { heliusCreateWebhook } from "../src/lib/helius";
import { config } from "../src/lib/config";

const webhookUrl = `${config().appOrigin}/api/webhooks/helius`;
const { webhookID } = await heliusCreateWebhook({ webhookUrl, authHeader: `Bearer ${config().heliusWebhookSecret}` });
console.log(`webhook created for ${webhookUrl}`);
console.log(`HELIUS_WEBHOOK_ID=${webhookID}`);
