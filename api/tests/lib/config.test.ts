import { describe, it, expect, beforeEach } from "vitest";
import { config, resetConfigForTests } from "@/lib/config";

const ALL = {
  HELIUS_API_KEY: "h",
  HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=h",
  JUPITER_API_KEY: "j",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "s",
  PULLER_SECRET_KEY: "[1,2,3]",
  SESSION_SECRET: "sess",   // still set here: proves a stray env var never leaks through config()
  CRON_SECRET: "cron",
  HELIUS_WEBHOOK_SECRET: "wh",
  APP_ORIGIN: "https://sprouts.money",
  FEE_WALLET: "ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD",
  HELIUS_WEBHOOK_ID: "hook-1",
};

describe("config", () => {
  beforeEach(() => {
    resetConfigForTests();
    for (const k of Object.keys(ALL)) delete process.env[k];
  });

  // Review M11: a stray console.log(config()) or a spread must never print a secret.
  it("serializes and spreads without any value", () => {
    Object.assign(process.env, ALL);
    const c = config();
    expect(JSON.stringify(c)).not.toContain("sess");
    expect(JSON.stringify(c)).not.toContain("cron");
    expect(Object.keys({ ...c })).toEqual([]);
    expect(c.cronSecret).toBe("cron");
  });

  it("K-M9: SESSION_SECRET is not a setting (sessions are random tokens hashed at rest; nothing reads a secret for them)", () => {
    Object.assign(process.env, ALL);
    delete process.env.SESSION_SECRET;
    const c = config() as unknown as Record<string, unknown>;
    expect("sessionSecret" in c).toBe(false);
    expect(config().cronSecret).toBe("cron");
  });

  it("reads every variable", () => {
    Object.assign(process.env, ALL);
    expect(config().jupiterApiKey).toBe("j");
    expect(config().appOrigin).toBe("https://sprouts.money");
    expect(config().feeWallet).toBe("ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD");
  });

  it("names the missing variable when it is read", () => {
    Object.assign(process.env, ALL);
    delete process.env.CRON_SECRET;
    expect(() => config().cronSecret).toThrow("Missing env: CRON_SECRET");
  });

  it("PYTH_API_KEY is optional (R324): absent reads undefined, no throw; present reads the value", () => {
    Object.assign(process.env, ALL);
    delete process.env.PYTH_API_KEY;
    expect(() => config()).not.toThrow();
    expect(config().pythApiKey).toBeUndefined();
    expect(config().jupiterApiKey).toBe("j");
    process.env.PYTH_API_KEY = "pk";
    expect(config().pythApiKey).toBe("pk");
    delete process.env.PYTH_API_KEY;
  });

  it("reads a present variable even while another is missing", () => {
    Object.assign(process.env, ALL);
    delete process.env.CRON_SECRET;
    expect(config().jupiterApiKey).toBe("j");
  });
});
