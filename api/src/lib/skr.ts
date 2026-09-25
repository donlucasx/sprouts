import { Connection, PublicKey } from "@solana/web3.js";
import { TldParser } from "@onsol/tldparser";

/** The wallet's main .skr name (AllDomains, always mainnet), as "name.skr", or null when it has none. */
export async function skrNameOf(rpcUrl: string, owner: string): Promise<string | null> {
  try {
    const parser = new TldParser(new Connection(rpcUrl, "confirmed"));
    const main = await parser.getMainDomain(new PublicKey(owner));
    if (!main?.domain || !main.tld) return null;
    const tld = String(main.tld).replace(/^\./, "");
    return `${main.domain}.${tld}`;
  } catch {
    return null;
  }
}
