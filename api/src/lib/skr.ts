import { Connection, PublicKey } from "@solana/web3.js";
import { TldParser } from "@onsol/tldparser";

const SUFFIX = ".skr";

/**
 * The name to show for a key: its main domain when one is set, else the alphabetically first of its .skr names
 * (a Seeker that never set a main domain still owns its name), else null.
 */
export function pickSkrName(main: { domain: string; tld: string } | null, skrDomains: string[]): string | null {
  if (main?.domain && main.tld) return `${main.domain}.${String(main.tld).replace(/^\./, "")}`;
  const names = skrDomains
    .map((d) => d.trim().toLowerCase().replace(/\.skr$/, ""))
    .filter((d) => d.length > 0)
    .sort();
  return names.length ? `${names[0]}${SUFFIX}` : null;
}

/** The wallet's .skr name (AllDomains, always mainnet), as "name.skr", or null when it has none. */
export async function skrNameOf(rpcUrl: string, owner: string): Promise<string | null> {
  try {
    const parser = new TldParser(new Connection(rpcUrl, "confirmed"));
    const key = new PublicKey(owner);
    const main = (await parser.getMainDomain(key).catch(() => null)) as { domain?: string; tld?: string } | null;
    if (main?.domain && main.tld) return pickSkrName({ domain: main.domain, tld: main.tld }, []);
    const listed = (await parser.getParsedAllUserDomainsFromTld(key, "skr")) as { domain: string }[];
    return pickSkrName(null, listed.map((d) => d.domain));
  } catch {
    return null;
  }
}
