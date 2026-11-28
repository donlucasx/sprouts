import { getRepo } from "@/db/repo";

/*
 * 11-28 (Kimi Jupiter re-assessment fix 4): a cross-instance cache in the database (table shared_cache, migration 0015), in front of
 * reads that are the same for every user and cost Jupiter calls: the shared display prices (PRICE_CACHE_TTL_MS) and the top-up's
 * per-mint probe and token info (topup.ts). memo.ts stays in front of it per instance. Never a money-safety read: the top-up build's
 * price bound, its quote and swap, and every planting read stay fresh.
 *
 * Fail open: no table yet, a slow or failed read, a failed write, an entry that does not decode: each is a miss and the read runs as
 * before. A read waits at most CROSS_READ_TIMEOUT_MS. The write is not awaited by the caller.
 */
export const PRICE_CACHE_TTL_MS = 45_000;
export const CROSS_READ_TIMEOUT_MS = 300;
/** About one write in this many also deletes rows that expired over a day ago (the key set is small: a few per coin). */
export const PRUNE_EVERY = 50;
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

/** Off under vitest (route tests swap mocks and repos between reads); its own tests turn it on. */
let crossOn = !process.env.VITEST;
export function setSharedCacheForTests(on: boolean): void { crossOn = on; }
const writes = new Set<Promise<void>>();
/** Tests: wait for the writes started so far. */
export async function settleSharedCacheWrites(): Promise<void> { await Promise.all([...writes]); }

export type CrossCacheOptions<T> = {
  /** Kept at all (default: every value). */
  keep?: (v: T) => boolean;
  /** Its life in the cache (ms). */
  ttlMs: number | ((v: T) => number);
  /** To JSON and back. `decode` answers undefined for a stored value it does not accept (a miss). Default: as is. */
  encode?: (v: T) => unknown;
  decode?: (x: unknown) => T | undefined;
  now?: () => number;
};

/** The entry's remaining life when the last crossCached call hit or wrote it (ms); memo.ts uses it so an instance never outlives the row. */
export type CrossResult<T> = { value: T; ttlLeftMs: number; from: "cache" | "read" };

const timeoutNull = <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<null>((r) => { t = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(t));
};

export async function crossCachedWithAge<T>(key: string, read: () => Promise<T>, o: CrossCacheOptions<T>): Promise<CrossResult<T>> {
  const now = o.now ?? Date.now;
  const ttl = (v: T) => (typeof o.ttlMs === "number" ? o.ttlMs : o.ttlMs(v));
  if (!crossOn) { const value = await read(); return { value, ttlLeftMs: ttl(value), from: "read" }; }
  const repo = await getRepo().catch(() => null);
  if (repo) {
    const hit = await timeoutNull(repo.getSharedCache(key), CROSS_READ_TIMEOUT_MS).catch(() => null);
    const left = hit ? hit.expiresAt.getTime() - now() : 0;
    if (hit && left > 0 && hit.value && typeof hit.value === "object" && "v" in hit.value) {
      const raw = (hit.value as { v: unknown }).v;
      const value = o.decode ? o.decode(raw) : (raw as T);
      if (value !== undefined) return { value, ttlLeftMs: left, from: "cache" };
    }
  }
  const value = await read();
  const life = ttl(value);
  if (repo && life > 0 && (o.keep ?? (() => true))(value)) {
    const t = now();
    const w = repo.putSharedCache(key, { v: o.encode ? o.encode(value) : value }, new Date(t + life), Math.random() < 1 / PRUNE_EVERY ? new Date(t - PRUNE_AGE_MS) : undefined)
      .catch((e) => console.error(`shared cache: write of ${key} failed (${e instanceof Error ? e.message : String(e)})`));
    writes.add(w);
    void w.finally(() => writes.delete(w));
  }
  return { value, ttlLeftMs: life, from: "read" };
}

export async function crossCached<T>(key: string, read: () => Promise<T>, o: CrossCacheOptions<T>): Promise<T> {
  return (await crossCachedWithAge(key, read, o)).value;
}
