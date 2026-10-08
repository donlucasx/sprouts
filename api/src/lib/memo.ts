/**
 * A short server-side memo for reads that are the same for every user (the share price, coin prices, the snapshot rows), kept per
 * function instance (safe on Fluid Compute: a stale entry only lives SHARED_TTL_MS). An in-flight read is shared; a rejection, or a
 * value `keep` refuses (a null price), is never cached. No imports, so a test setup can clear it without loading the readers.
 */
export const SHARED_TTL_MS = 120_000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

export function cached<T>(key: string, read: () => Promise<T>, keep: (v: T) => boolean = () => true, ttlMs = SHARED_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = read();
  const entry = { at: now, value };
  memo.set(key, entry);
  value.then((v) => { if (!keep(v) && memo.get(key) === entry) memo.delete(key); }, () => { if (memo.get(key) === entry) memo.delete(key); });
  return value;
}

/** Tests: every test starts from fresh reads. */
export function clearSharedReads(): void { memo.clear(); }

