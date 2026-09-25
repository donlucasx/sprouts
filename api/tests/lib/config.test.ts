import { describe, it, expect, beforeEach } from "vitest";
import { config, resetConfigForTests } from "@/lib/config";

const ALL = {
  HELIUS_API_KEY: "h",
  HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=h",
  JUPITER_API_KEY: "j",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_KEY: "s",
  PULLER_SECRET_KEY: "[1,2,3]",
  SESSION_SECRET: "sess",
  CRON_SECRET: "cron",
  HELIUS_WEBHOOK_SECRET: "wh",
  APP_ORIGIN: "https://sprouts.money",
  FEE_WALLET: "ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD",
};

describe("config", () => {
  beforeEach(() => {
    resetConfigForTests();
    for (const k of Object.keys(ALL)) delete process.env[k];
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

  it("reads a present variable even while another is missing", () => {
    Object.assign(process.env, ALL);
    delete process.env.CRON_SECRET;
    expect(config().jupiterApiKey).toBe("j");
  });
});
