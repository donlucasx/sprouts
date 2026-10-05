import { createDefaultRpcTransport, createSolanaRpcFromTransport, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { config } from "./config";
import { redactError } from "./redact";

let cached: Rpc<SolanaRpcApi> | null = null;

/** K-M10: the default transport, with any error it throws redacted (the URL carries the Helius key) before a caller logs it. */
export function rpc(): Rpc<SolanaRpcApi> {
  if (!cached) {
    const transport = createDefaultRpcTransport({ url: config().heliusRpcUrl });
    const redacting = (async (req: Parameters<typeof transport>[0]) => {
      try {
        return await transport(req);
      } catch (e) {
        throw redactError(e);
      }
    }) as typeof transport;
    cached = createSolanaRpcFromTransport(redacting);
  }
  return cached;
}
