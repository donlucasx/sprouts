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
  feeWallet: string;
  heliusWebhookId: string;
  anthropicApiKey: string;
  /** Optional since R324 (10-04 s20): nothing posts a Pyth price, so nothing reads it but the deferred Hermes path (lib/pyth.ts). */
  pythApiKey: string | undefined;
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
  feeWallet: "FEE_WALLET",
  heliusWebhookId: "HELIUS_WEBHOOK_ID",
  anthropicApiKey: "ANTHROPIC_API_KEY",
  pythApiKey: "PYTH_API_KEY",
};

/** Settings that may be absent: reading one returns undefined instead of throwing. */
const OPTIONAL: ReadonlySet<keyof Config> = new Set(["pythApiKey"]);

let cached: Config | null = null;

/** Each setting is validated when it is first read, so a script that needs only the RPC URL runs without the rest. */
export function config(): Config {
  if (cached) return cached;
  // Non-enumerable getters and a redacting toJSON: a stray console.log(config()) or a spread never prints a secret (review M11).
  const out = {} as Config;
  for (const key of Object.keys(MAP) as (keyof Config)[]) {
    Object.defineProperty(out, key, {
      enumerable: false,
      get() {
        const value = process.env[MAP[key]];
        if (!value) {
          if (OPTIONAL.has(key)) return undefined;
          throw new Error(`Missing env: ${MAP[key]}`);
        }
        return value;
      },
    });
  }
  Object.defineProperty(out, "toJSON", { enumerable: false, value: () => "[config: values redacted]" });
  cached = out;
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}
