/**
 * A short server-side memo for reads that are the same for every user (the share price, coin prices, the snapshot rows), kept per
 * function instance (safe on Fluid Compute: a stale entry only lives SHARED_TTL_MS). An in-flight read is shared; a rejection, or a
 * value `keep` refuses (a null price), is never cached. No imports, so a test setup can clear it without loading the readers.
 */
export const SHARED_TTL_MS = 120_000;
/**
 * Task 7 review (security): some keys carry a mint a caller chose, so the memo holds at most this many entries; past it the oldest
 * goes first (a Map iterates in insertion order, and a refreshed key is re-inserted at the end).
 */
export const MEMO_MAX_ENTRIES = 500;
const memo = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

/**
 * `ttlMs` may depend on the value read (Task 7: a coin's positive answer kept a day, a negative one minutes); until the read settles
 * the entry keeps a fixed ttl, or SHARED_TTL_MS for a ttl that depends on the value, so callers in flight share it.
 */
export function cached<T>(key: string, read: () => Promise<T>, keep: (v: T) => boolean = () => true, ttlMs: number | ((v: T) => number) = SHARED_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value as Promise<T>;
  const value = read();
  const entry = { at: now, ttl: typeof ttlMs === "number" ? ttlMs : SHARED_TTL_MS, value };
  memo.delete(key);
  memo.set(key, entry);
  while (memo.size > MEMO_MAX_ENTRIES) memo.delete(memo.keys().next().value as string);
  value.then(
    (v) => {
      if (!keep(v)) { if (memo.get(key) === entry) memo.delete(key); return; }
      if (typeof ttlMs === "function") entry.ttl = ttlMs(v);
    },
    () => { if (memo.get(key) === entry) memo.delete(key); },
  );
  return value;
}

/** Tests: every test starts from fresh reads. */
export function clearSharedReads(): void { memo.clear(); }

