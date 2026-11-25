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

/**
 * 11-25 (carousel load: Helius credits ~5k/day -> ~100k/day, nearly all GET /api/me and /api/me/usdc, Kimi hotfix scope): one
 * owner's chain reads for the Home GETs, kept OWNER_TTL_MS per function instance. Its own map (Kimi #4), so per-user keys never evict
 * the shared price and snapshot reads above. Keys are `owner:<pubkey>:<reader>`; forgetOwnerReads clears one owner after a write they
 * made on this instance (other instances may show chain state up to the TTL old). Only the GET call sites use it, never a reader
 * itself (Kimi #1: readDelegation also backs the link confirm's poll) and never a money path (top-up build reads fresh, Kimi #3).
 * In-flight reads are shared; a rejection is never kept.
 */
export const OWNER_TTL_MS = 15_000;
export const OWNER_MAX_ENTRIES = 5_000;
const owners = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();
export function ownerCached<T>(owner: string, reader: string, read: () => Promise<T>, ttlMs = OWNER_TTL_MS): Promise<T> {
  const key = `owner:${owner}:${reader}`;
  const now = Date.now();
  const hit = owners.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value as Promise<T>;
  const value = read();
  const entry = { at: now, ttl: ttlMs, value };
  owners.delete(key);
  owners.set(key, entry);
  while (owners.size > OWNER_MAX_ENTRIES) owners.delete(owners.keys().next().value as string);
  value.catch(() => { if (owners.get(key) === entry) owners.delete(key); });
  return value;
}
/** After a write `owner` made (a top-up, withdrawal, link, re-link, revoke, move): this instance reads their chain state fresh. */
export function forgetOwnerReads(owner: string): void {
  const prefix = `owner:${owner}:`;
  for (const k of [...owners.keys()]) if (k.startsWith(prefix)) owners.delete(k);
  for (const k of [...answers.keys()]) if (k.startsWith(prefix)) answers.delete(k);
}

/**
 * 11-25 (Home refresh loop on ~9 phones, ~1.5 reads/s each; Kimi loop scope): the last successful (HTTP 200) answer of a Home GET (/api/me,
 * /api/me/usdc) per owner, route, query and app caps, kept REPEAT_MS per instance. A repeat inside the window gets that body with no
 * DB or Helius work. Read only after the session check (never across a 401). Any non-GET request the owner makes clears it
 * (auth-guard requireSession -> forgetOwnerReads), so a save, a watering, a Terms acceptance or a confirm is never hidden.
 */
export const REPEAT_MS = 5_000;   // 5 s (Kimi guard #6): another instance can show a pre-write body this long
/** Off under vitest (route tests change the DB between reads, like the RPC pace); its own test turns it on. */
let repeatMs = process.env.VITEST ? 0 : REPEAT_MS;
export function setRepeatMsForTests(ms: number): void { repeatMs = ms; }
/** 11-25: the per-user Home read cap (auth-guard rateLimited in the /api/me GETs) is off under vitest unless a test turns it on. */
let homeCap = !process.env.VITEST;
export const homeReadCapOn = (): boolean => homeCap;
export function setHomeReadCapForTests(on: boolean): void { homeCap = on; }
const answers = new Map<string, { at: number; body: unknown }>();
export function repeatAnswer(owner: string, key: string): unknown | undefined {
  const hit = answers.get(`owner:${owner}:${key}`);
  return hit && Date.now() - hit.at < repeatMs ? hit.body : undefined;
}
export function rememberAnswer(owner: string, key: string, body: unknown): void {
  const k = `owner:${owner}:${key}`;
  answers.delete(k);
  answers.set(k, { at: Date.now(), body });
  while (answers.size > OWNER_MAX_ENTRIES) answers.delete(answers.keys().next().value as string);
}

/** Tests: every test starts from fresh reads. */
export function clearSharedReads(): void { memo.clear(); owners.clear(); answers.clear(); }

