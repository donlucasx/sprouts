export type Config = {
  heliusApiKey: string;
  heliusRpcUrl: string;
  jupiterApiKey: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  pullerSecretKey: string;
  sessionSecret: string;
  cronSecret: string;
  heliusWebhookSecret: string;
  appOrigin: string;
};

const MAP: Record<keyof Config, string> = {
  heliusApiKey: "HELIUS_API_KEY",
  heliusRpcUrl: "HELIUS_RPC_URL",
  jupiterApiKey: "JUPITER_API_KEY",
  supabaseUrl: "SUPABASE_URL",
  supabaseServiceKey: "SUPABASE_SERVICE_KEY",
  pullerSecretKey: "PULLER_SECRET_KEY",
  sessionSecret: "SESSION_SECRET",
  cronSecret: "CRON_SECRET",
  heliusWebhookSecret: "HELIUS_WEBHOOK_SECRET",
  appOrigin: "APP_ORIGIN",
};

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const out = {} as Config;
  for (const key of Object.keys(MAP) as (keyof Config)[]) {
    const value = process.env[MAP[key]];
    if (!value) throw new Error(`Missing env: ${MAP[key]}`);
    out[key] = value;
  }
  cached = out;
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}
