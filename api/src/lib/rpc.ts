import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { config } from "./config";

let cached: Rpc<SolanaRpcApi> | null = null;

export function rpc(): Rpc<SolanaRpcApi> {
  if (!cached) cached = createSolanaRpc(config().heliusRpcUrl);
  return cached;
}
