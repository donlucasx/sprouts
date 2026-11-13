// Ops dashboard: every READ the dashboard needs, behind one interface. No writes anywhere (no table writes, no webhook PUT, no send).
// Each method throws on failure; the caller (Task 5) wraps them with timeouts and a cache and turns a throw into "unknown".
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { getRepo, remainderKindsOf } from "@/db/repo";
import { heliusWebhookAddresses } from "@/lib/helius";
import { readPriceAccount, fetchHermesUpdate } from "@/lib/pyth";
import { readLeashConfig, LEG_SPEC, LEASH_LEG } from "@/lib/leash";
import { rpc } from "@/lib/rpc";
import { APP_REASONS } from "@/lib/founder-alert";
import { PYTH_ACCOUNT, PYTH_FEED } from "@/lib/venues/addresses";
import type { CronRunInput, FailureInput, AddUpRow } from "./lights";

const DAY_MS = 24 * 3_600_000;
const PAGE = 1000;   // PostgREST's default row cap: every unbounded read pages past it
const RECENT = 10;

/** The leg `expected` map for the Program light. Read all 8 enabled on mainnet 11-12; update deliberately when a leg is turned off. */
export const EXPECTED_LEGS_ENABLED: readonly boolean[] = [true, true, true, true, true, true, true, true];

/** `first4…last3`: the only form a wallet takes in any ops response. */
export function shortWallet(pubkey: string): string {
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-3)}`;
}

/** OPS_EXCLUDE_WALLETS: comma-separated wallet and seed-vault keys (test devices) left out of every count and list. */
export function excludedWallets(env: string | undefined): Set<string> {
  return new Set((env ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export type OpsNumbers = {
  /** Current-state figures, not per window. */
  now: { linkedNow: number; active7d: number };
  funnel: Record<"d1" | "d7" | "all", { signIns: number; triedLink: number; linkedEver: number }>;
  /** Sign-in failures (events `signin_failed`) in the last 24 hours; a count only, never the text. */
  signInFailures24h: number;
  linkFailures7d: Record<string, number>;
  activity7d: { swaps: number; unpriced7d: number; usdSwappedCents: number; roundupCents: number; feeCents: number; byCoin: Record<string, { plantings: number; usdCents: number }> };
  recentSwaps: { at: string; wallet: string; usdCents: number | null; status: string }[];
  recentPlantings: { at: string; wallet: string; coin: string; usdCents: number; status: string }[];
};

export interface OpsSources {
  cronLatest(): Promise<CronRunInput | null>;
  firstPlantingLast(): Promise<{ at: Date; reasons: Record<string, number> } | null>;
  failures(sinceIso: string): Promise<FailureInput[]>;
  oldestPendingWithdrawalAt(): Promise<Date | null>;
  linkedWallets(): Promise<string[]>;
  webhookAddresses(): Promise<string[]>;
  swapStats(sinceIso: string): Promise<{ lastSwapAt: Date | null; unpriced: number }>;
  feeds(): Promise<{ name: "SOL" | "cbBTC" | "ORE"; publishTime: Date; maxAgeS: number }[]>;
  skrPrice(): Promise<"ok" | "failed" | "no-key">;
  pullerLamports(): Promise<bigint>;
  legsEnabled(): Promise<boolean[]>;
  /** Money-route server errors (`app_error` events) since the time: the route step only, never the error text. */
  appErrors(sinceIso: string): Promise<{ step: string }[]>;
  /** Confirmed plantings since the time, each with what it claimed, pulled and recorded in legs (cents); short ids only. */
  amountsAddUp(sinceIso: string): Promise<AddUpRow[]>;
  support(sinceIso: string): Promise<{ count: number; newestAt: Date | null }>;
  numbers(nowIso: string): Promise<OpsNumbers>;
}

type Row = Record<string, unknown>;
type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type CountResult = PromiseLike<{ count: number | null; error: { message: string } | null }>;

async function rows(q: Result): Promise<Row[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Row[] | null) ?? [];
}

/** Every row of an ordered query, PAGE at a time (a single read stops at the server's row cap). */
async function allRows(page: (from: number, to: number) => Result): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const got = await rows(page(from, from + PAGE - 1));
    out.push(...got);
    if (got.length < PAGE) return out;
  }
}

async function countOf(q: CountResult): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const date = (v: unknown): Date | null => (v == null ? null : new Date(String(v)));
/** Excluded when either key on the row is a test key (a null key never matches). */
const isExcluded = (ex: Set<string>, ...keys: unknown[]) => keys.some((k) => typeof k === "string" && ex.has(k));
/** `(a,b)` for PostgREST's `not.in` (base58 has no commas or parentheses). Only on NOT NULL columns: `not in` drops nulls. */
const inList = (ex: Set<string>) => `(${[...ex].join(",")})`;
const distinct = (rs: Row[], col: string, ex: Set<string>) => new Set(rs.map((r) => str(r[col])).filter((k): k is string => !!k && !ex.has(k))).size;

/** The leash leg whose maxAgeS judges each sponsored feed: SOL (leg 4, SOL_LEND), cbBTC (leg 7), ORE (leg 1, stORE). */
const FEEDS = [
  { name: "SOL", account: PYTH_ACCOUNT.SOL, leg: LEASH_LEG["SOL_LEND:kamino_klend"] },
  { name: "cbBTC", account: PYTH_ACCOUNT.CBBTC, leg: LEASH_LEG.cbBTC },
  { name: "ORE", account: PYTH_ACCOUNT.ORE, leg: LEASH_LEG.stORE },
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type RemainderSeen = { skrRecorded: Set<string>; carryRecorded: Set<string>; legsOf: Map<string, string[]> };

/**
 * Audit F1: a `remainder_unrecorded` event is resolved once its planting's surplus is set: SKR on the planting row, WSOL/USDC on
 * its carry row. A `legs` event (the booking never learnt which) is resolved when every remainder the legs owe is set, or none is owed.
 */
export function remainderResolved(e: { plantingId: string | null; kind: string }, s: RemainderSeen): boolean {
  if (!e.plantingId) return false;
  const done = (k: string) => (k === "SKR" ? s.skrRecorded.has(e.plantingId!) : s.carryRecorded.has(`${e.plantingId}:${k}`));
  if (e.kind === "SKR" || e.kind === "WSOL" || e.kind === "USDC") return done(e.kind);
  const legs = s.legsOf.get(e.plantingId);
  if (e.kind === "legs") return !!legs && remainderKindsOf(legs.map((asset) => ({ asset }))).every(done);
  return false;
}

type AddUpInput = {
  plantings: Row[];
  /** swaps claimed by those plantings (planting_id, signature, roundup_cents). */
  swaps: Row[];
  /** swap_parts of those plantings AND of any sent or confirmed planting on the claimed swaps (planting_id, signature, cents). */
  parts: Row[];
  /** planting_legs of those plantings (planting_id, usdc_in_cents). */
  legs: Row[];
};

/**
 * Per planting: claimed = its claimed swaps' round-ups, less what OTHER plantings already pulled of them as parts (the planting that
 * takes the rest owes only the rest), plus its own parts on swaps it did not claim (a part leaves the swap unclaimed); pulled = pulled
 * minus the network fee; legs = sum of the legs' USDC in. Test wallets (OPS_EXCLUDE_WALLETS) are left out.
 */
export function addUpRows(i: AddUpInput, skip: Set<string>): AddUpRow[] {
  const num = (v: unknown) => Number(v ?? 0);
  // A part of an in-window planting arrives in both reads: one part is counted once (planting + swap is its key).
  const parts = [...new Map(i.parts.map((x) => [`${x.planting_id}|${x.signature}`, x])).values()];
  return i.plantings.filter((p) => !isExcluded(skip, p.user_pubkey, p.wallet_pubkey)).map((p) => {
    const id = String(p.id);
    const mine = i.swaps.filter((s) => s.planting_id === id);
    const claimedSigs = new Set(mine.map((s) => String(s.signature)));
    let claimed = 0;
    for (const s of mine) claimed += num(s.roundup_cents) - parts.filter((x) => x.signature === s.signature && x.planting_id !== id).reduce((t, x) => t + num(x.cents), 0);
    for (const x of parts) if (x.planting_id === id && !claimedSigs.has(String(x.signature))) claimed += num(x.cents);
    const legs = i.legs.filter((l) => l.planting_id === id);
    return { id: shortWallet(id), claimedCents: claimed, pulledCents: num(p.usdc_pulled_cents) - num(p.network_fee_cents), legsCents: legs.reduce((t, l) => t + num(l.usdc_in_cents), 0), legCount: legs.length };
  });
}

export function realOpsSources(): OpsSources {
  let client: SupabaseClient | null = null;
  // Built like SupabaseRepo's constructor (service key, no session); one client, safe for concurrent reads.
  const db = () => (client ??= createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } }));
  const ex = () => excludedWallets(config().opsExcludeWallets);

  async function linkedWallets(): Promise<string[]> {
    const repo = await getRepo();
    const [active, paused] = await Promise.all([repo.listActiveWallets(), repo.listPausedWallets()]);
    const skip = ex();
    return [...new Set([...active, ...paused].filter((w) => !isExcluded(skip, w.pubkey, w.userPubkey)).map((w) => w.pubkey))];
  }

  /** Distinct users with an event of `kind` since `cutoff` (null = ever). */
  async function distinctUsersWithEvent(kind: string, cutoff: string | null, skip: Set<string>): Promise<number> {
    const rs = await allRows((a, b) => {
      let q = db().from("events").select("id, user_pubkey").eq("kind", kind);
      if (cutoff) q = q.gte("ts", cutoff);
      return q.order("id").range(a, b);
    });
    return distinct(rs, "user_pubkey", skip);
  }

  async function signIns(cutoff: string | null, skip: Set<string>): Promise<number> {
    const rs = await allRows((a, b) => {
      let q = db().from("users").select("seed_vault_pubkey");
      if (cutoff) q = q.gte("created_at", cutoff);
      return q.order("seed_vault_pubkey").range(a, b);
    });
    return distinct(rs, "seed_vault_pubkey", skip);
  }

  return {
    async cronLatest() {
      const [r] = await rows(db().from("cron_runs").select("day, started_at, finished_at, ok, summary").order("day", { ascending: false }).limit(1));
      if (!r) return null;
      const summary = r.summary !== null && typeof r.summary === "object" && !Array.isArray(r.summary) ? (r.summary as Record<string, unknown>) : null;
      return { day: String(r.day), startedAt: new Date(String(r.started_at)), finishedAt: date(r.finished_at), ok: typeof r.ok === "boolean" ? r.ok : null, summary };
    },

    async firstPlantingLast() {
      const [r] = await rows(db().from("events").select("ts, reasons:detail->reasons").eq("kind", "first_planting_run").order("ts", { ascending: false }).limit(1));
      const at = r ? date(r.ts) : null;
      if (!r || !at) return null;
      const raw = r.reasons;
      const reasons: Record<string, number> = {};
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, n] of Object.entries(raw as Record<string, unknown>)) if (typeof n === "number" && Number.isFinite(n)) reasons[k] = n;
      }
      return { at, reasons };
    },

    async failures(sinceIso) {
      const skip = ex();
      // One query for the candidate events (all five kinds), then one per resolution check: never one query per event.
      const events = (await allRows((a, b) => db().from("events")
        // Only enum or id fields from detail (the withdrawal id; a remainder's planting id and kind), never err text.
        .select("id, ts, kind, user_pubkey, wallet_pubkey, withdrawal:detail->>withdrawal, planting:detail->>plantingId, rkind:detail->>kind")
        .in("kind", ["pull_failed", "withdraw_failed", "move_failed", "run_stopped", "remainder_unrecorded"]).gte("ts", sinceIso).order("id").range(a, b)))
        .filter((e) => !isExcluded(skip, e.user_pubkey, e.wallet_pubkey));
      // Kimi M3: remainder events older than the window are read too; the resolution check below drops the resolved ones, so an
      // unrecorded remainder never ages out of the Money-ops light.
      const olderRemainders = (await allRows((a, b) => db().from("events")
        .select("id, ts, kind, user_pubkey, wallet_pubkey, withdrawal:detail->>withdrawal, planting:detail->>plantingId, rkind:detail->>kind")
        .eq("kind", "remainder_unrecorded").lt("ts", sinceIso).order("id").range(a, b)))
        // Only an event naming a real planting can ever resolve; one without keeps the plain 14-day window (so it is not read here).
        .filter((e) => !isExcluded(skip, e.user_pubkey, e.wallet_pubkey) && UUID.test(str(e.planting) ?? ""));
      const older = new Set(olderRemainders.map((e) => e.id));
      events.push(...olderRemainders);
      const of = (k: string) => events.filter((e) => e.kind === k);
      const pulls = of("pull_failed");
      const withdraws = of("withdraw_failed");
      const moves = of("move_failed");
      const stops = of("run_stopped");

      // pull_failed: resolved by a confirmed planting for the same wallet after the event.
      const pullWallets = [...new Set(pulls.map((e) => str(e.wallet_pubkey)).filter((w): w is string => !!w))];
      const plantedAt = new Map<string, number>();   // newest confirmed planting per wallet since the window opened
      if (pullWallets.length) {
        for (const p of await allRows((a, b) => db().from("plantings").select("id, wallet_pubkey, ts").eq("status", "confirmed").in("wallet_pubkey", pullWallets).gte("ts", sinceIso).order("id").range(a, b))) {
          const w = String(p.wallet_pubkey), t = new Date(String(p.ts)).getTime();
          if (t > (plantedAt.get(w) ?? -Infinity)) plantedAt.set(w, t);
        }
      }

      // withdraw_failed: resolved when its withdrawal row is closed (withdrawn, cancelled or skipped).
      const wIds = [...new Set(withdraws.map((e) => str(e.withdrawal)).filter((x): x is string => !!x))];
      const closed = new Set<string>();
      if (wIds.length) {
        for (const w of await rows(db().from("withdrawals").select("id, withdraw_signature, cancel_signature, skipped_at").in("id", wIds))) {
          if (w.withdraw_signature != null || w.cancel_signature != null || w.skipped_at != null) closed.add(String(w.id));
        }
      }

      // move_failed: resolved by a later move_done for the same user (both events carry wallet_pubkey null; moves.ts writes the user only).
      const moveUsers = [...new Set(moves.map((e) => str(e.user_pubkey)).filter((u): u is string => !!u))];
      const movedAt = new Map<string, number>();
      if (moveUsers.length) {
        for (const d of await allRows((a, b) => db().from("events").select("id, user_pubkey, ts").eq("kind", "move_done").in("user_pubkey", moveUsers).gte("ts", sinceIso).order("id").range(a, b))) {
          const u = String(d.user_pubkey), t = new Date(String(d.ts)).getTime();
          if (t > (movedAt.get(u) ?? -Infinity)) movedAt.set(u, t);
        }
      }

      // remainder_unrecorded (audit F1): resolved when that planting's surplus is no longer NULL (one read of those plantings).
      const remainders = of("remainder_unrecorded");
      const rIds = [...new Set(remainders.map((e) => str(e.planting)).filter((x): x is string => !!x && UUID.test(x)))];
      const seen: RemainderSeen = { skrRecorded: new Set(), carryRecorded: new Set(), legsOf: new Map() };
      for (let i = 0; i < rIds.length; i += 100) {
        for (const p of await rows(db().from("plantings").select("id, skr_surplus_raw, planting_legs(asset), carry(kind, surplus_raw)").in("id", rIds.slice(i, i + 100)))) {
          const id = String(p.id);
          if (p.skr_surplus_raw != null) seen.skrRecorded.add(id);
          for (const c of (p.carry as Row[] | null) ?? []) if (c.surplus_raw != null) seen.carryRecorded.add(`${id}:${String(c.kind)}`);
          seen.legsOf.set(id, ((p.planting_legs as Row[] | null) ?? []).map((l) => String(l.asset)));
        }
      }

      // run_stopped: resolved when a daily run finished ok after it.
      let lastOkRun = -Infinity;
      if (stops.length) {
        const [r] = await rows(db().from("cron_runs").select("finished_at").eq("ok", true).not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1));
        if (r) lastOkRun = new Date(String(r.finished_at)).getTime();
      }

      return events.flatMap((e): FailureInput[] => {
        const kind = e.kind as FailureInput["kind"];
        const ts = new Date(String(e.ts));
        const t = ts.getTime();
        const resolved =
          kind === "pull_failed" ? (plantedAt.get(String(e.wallet_pubkey)) ?? -Infinity) > t
          : kind === "withdraw_failed" ? closed.has(String(e.withdrawal))
          : kind === "move_failed" ? (movedAt.get(String(e.user_pubkey)) ?? -Infinity) > t
          : kind === "remainder_unrecorded" ? remainderResolved({ plantingId: str(e.planting), kind: String(e.rkind) }, seen)
          : lastOkRun > t;
        // An older remainder is kept only while it is still open.
        return older.has(e.id) && resolved ? [] : [{ kind, ts, resolved }];
      });
    },

    async oldestPendingWithdrawalAt() {
      const skip = ex();
      // Open = the same three nulls SupabaseRepo.openWithdrawals uses.
      let q = db().from("withdrawals").select("unstake_ts").is("withdraw_signature", null).is("cancel_signature", null).is("skipped_at", null);
      if (skip.size) q = q.not("user_pubkey", "in", inList(skip));
      const [r] = await rows(q.order("unstake_ts", { ascending: true }).limit(1));
      return r ? date(r.unstake_ts) : null;
    },

    linkedWallets,

    async webhookAddresses() {
      return heliusWebhookAddresses(config().heliusWebhookId);
    },

    async swapStats(sinceIso) {
      const skip = ex();
      let last = db().from("swaps").select("ts");
      let unpriced = db().from("swaps").select("signature", { count: "exact", head: true }).is("usd_size_cents", null).gte("ts", sinceIso);
      if (skip.size) {
        last = last.not("wallet_pubkey", "in", inList(skip));
        unpriced = unpriced.not("wallet_pubkey", "in", inList(skip));
      }
      const [[r], n] = await Promise.all([rows(last.order("ts", { ascending: false }).limit(1)), countOf(unpriced)]);
      return { lastSwapAt: r ? date(r.ts) : null, unpriced: n };
    },

    async feeds() {
      return Promise.all(FEEDS.map(async (f) => {
        const p = await readPriceAccount(f.account);
        if (!p) throw new Error(`${f.name} price account is missing or not the Pyth receiver's`);
        return { name: f.name, publishTime: new Date(Number(p.publishTime) * 1000), maxAgeS: LEG_SPEC[f.leg].maxAgeS };
      }));
    },

    async skrPrice() {
      if (!config().pythApiKey) return "no-key";
      // One Hermes GET for the SKR feed with the bearer header pyth.ts already sends. The outcome IS the value here, so a throw is "failed".
      try {
        const { price } = await fetchHermesUpdate(PYTH_FEED.SKR);
        return price.price > 0n ? "ok" : "failed";
      } catch {
        return "failed";
      }
    },

    async pullerLamports() {
      const { puller } = await readLeashConfig();
      return (await rpc().getBalance(puller, { commitment: "confirmed" }).send()).value;
    },

    async legsEnabled() {
      return (await readLeashConfig()).legs.map((l) => l.enabled);
    },

    async appErrors(sinceIso) {
      const skip = ex();
      // Only the step: the error text stays in the table.
      const rs = await allRows((a, b) => db().from("events").select("id, user_pubkey, wallet_pubkey, step:detail->>step").eq("kind", "app_error").gte("ts", sinceIso).order("id").range(a, b));
      return rs.filter((r) => !isExcluded(skip, r.user_pubkey, r.wallet_pubkey)).map((r) => ({ step: str(r.step) ?? "?" }));
    },

    async amountsAddUp(sinceIso) {
      const skip = ex();
      const plantings = await allRows((a, b) => db().from("plantings").select("id, user_pubkey, wallet_pubkey, usdc_pulled_cents, network_fee_cents").eq("status", "confirmed").gte("ts", sinceIso).order("ts").order("id").range(a, b));
      const ids = plantings.filter((p) => !isExcluded(skip, p.user_pubkey, p.wallet_pubkey)).map((p) => String(p.id));
      const chunk = (xs: string[]) => Array.from({ length: Math.ceil(xs.length / 100) }, (_, k) => xs.slice(k * 100, k * 100 + 100));
      // Every chunk is read page by page (a single read stops at the server's row cap), in a stable order.
      const many = async (table: string, cols: string, by: string, ids: string[], order: string[], status = false): Promise<Row[]> =>
        (await Promise.all(chunk(ids).map((c) => allRows((x, y) => {
          let q = db().from(table).select(cols).in(by, c);
          if (status) q = q.in("plantings.status", ["sent", "confirmed"]);
          for (const o of order) q = q.order(o);
          return q.range(x, y);
        })))).flat();
      const [swaps, ownParts, legs] = await Promise.all([
        many("swaps", "planting_id, signature, roundup_cents", "planting_id", ids, ["signature"]),
        many("swap_parts", "planting_id, signature, cents", "planting_id", ids, ["planting_id", "signature"]),
        many("planting_legs", "planting_id, usdc_in_cents", "planting_id", ids, ["planting_id", "asset"]),
      ]);
      // Parts other plantings (sent or confirmed; a failed one gives its cents back) pulled of the swaps these plantings claimed.
      const otherParts = await many("swap_parts", "planting_id, signature, cents, plantings!inner(status)", "signature", [...new Set(swaps.map((s) => String(s.signature)))], ["planting_id", "signature"], true);
      return addUpRows({ plantings, swaps, parts: [...ownParts, ...otherParts], legs }, skip);
    },

    async support(sinceIso) {
      const skip = ex();
      // Never `detail`: the message text stays in the table.
      const rs = (await allRows((a, b) => db().from("events").select("id, user_pubkey, ts").eq("kind", "support_message").gte("ts", sinceIso).order("id").range(a, b)))
        .filter((r) => !isExcluded(skip, r.user_pubkey));
      const newest = rs.reduce<Date | null>((m, r) => { const d = new Date(String(r.ts)); return m && m >= d ? m : d; }, null);
      return { count: rs.length, newestAt: newest };
    },

    async numbers(nowIso) {
      const skip = ex();
      const now = new Date(nowIso).getTime();
      const d1 = new Date(now - DAY_MS).toISOString();
      const d7 = new Date(now - 7 * DAY_MS).toISOString();

      const [linkedNow, active7d] = await Promise.all([
        linkedWallets().then((w) => w.length),
        allRows((a, b) => db().from("plantings").select("id, wallet_pubkey, user_pubkey").eq("status", "confirmed").gte("ts", d7).order("id").range(a, b))
          .then((rs) => distinct(rs.filter((r) => !isExcluded(skip, r.user_pubkey)), "wallet_pubkey", skip)),
      ]);
      const window = async (cutoff: string | null) => {
        const [s, t, l] = await Promise.all([signIns(cutoff, skip), distinctUsersWithEvent("link_started", cutoff, skip), distinctUsersWithEvent("wallet_linked", cutoff, skip)]);
        return { signIns: s, triedLink: t, linkedEver: l };
      };
      const [fd1, fd7, fall] = await Promise.all([window(d1), window(d7), window(null)]);

      const sf = await allRows((a, b) => db().from("events").select("id, user_pubkey, wallet_pubkey").eq("kind", "signin_failed").gte("ts", d1).order("id").range(a, b));
      const signInFailures24h = sf.filter((r) => !isExcluded(skip, r.user_pubkey, r.wallet_pubkey)).length;

      // Link failures: allow-listed app reasons, else the server step. Only the enum fields are read from detail, never error text.
      const linkFailures7d: Record<string, number> = {};
      const lf = await allRows((a, b) => db().from("events").select("id, user_pubkey, wallet_pubkey, from:detail->>from, reason:detail->>reason, step:detail->>step")
        .eq("kind", "link_failed").gte("ts", d7).order("id").range(a, b));
      for (const r of lf.filter((r) => !isExcluded(skip, r.user_pubkey, r.wallet_pubkey))) {
        const key = r.from === "app" ? `app:${APP_REASONS.has(String(r.reason)) ? String(r.reason) : "?"}` : `server:${str(r.step) ?? "?"}`;
        linkFailures7d[key] = (linkFailures7d[key] ?? 0) + 1;
      }

      // Activity: swaps in 7 d (by swap time), then confirmed plantings' legs in 7 d grouped by coin.
      const swaps = (await allRows((a, b) => db().from("swaps").select("signature, wallet_pubkey, usd_size_cents, roundup_cents").gte("ts", d7).order("signature").range(a, b)))
        .filter((r) => !isExcluded(skip, r.wallet_pubkey));
      const legs = (await allRows((a, b) => db().from("planting_legs")
        .select("planting_id, asset, usdc_in_cents, fee_cents, plantings!inner(wallet_pubkey, user_pubkey, status, ts)")
        .eq("plantings.status", "confirmed").gte("plantings.ts", d7).order("planting_id").order("asset").range(a, b)))
        .filter((r) => { const p = r.plantings as Row; return !isExcluded(skip, p.wallet_pubkey, p.user_pubkey); });
      const byCoin: Record<string, { plantings: number; usdCents: number }> = {};
      for (const l of legs) {
        const c = (byCoin[String(l.asset)] ??= { plantings: 0, usdCents: 0 });
        c.plantings += 1;   // one leg per (planting, asset): a leg count is a planting count per coin
        c.usdCents += Number(l.usdc_in_cents);
      }
      const activity7d = {
        swaps: swaps.length,
        unpriced7d: swaps.filter((r) => r.usd_size_cents == null).length,
        usdSwappedCents: swaps.reduce((s, r) => s + (r.usd_size_cents == null ? 0 : Number(r.usd_size_cents)), 0),
        roundupCents: swaps.reduce((s, r) => s + Number(r.roundup_cents ?? 0), 0),
        // fee_cents, not fee_amount_raw: fee_cents is the 0.5% fee in USDC cents (types.ts PlantingLegRow, R105, set by plant-run.ts);
        // fee_amount_raw is the OUTPUT coin's raw units on old legs and 0 on every leg since R139, so it is not a USDC amount.
        feeCents: legs.reduce((s, l) => s + Number(l.fee_cents ?? 0), 0),
        byCoin,
      };

      // Recent lists: newest 10 each, excluded keys filtered IN the query so the list still holds 10.
      let rs = db().from("swaps").select("ts, wallet_pubkey, usd_size_cents, planting_id");
      // Plantings top-level (ordering by an embedded column would order the embed, not the rows), legs embedded for the coin.
      let rp = db().from("plantings").select("ts, wallet_pubkey, usdc_pulled_cents, status, planting_legs(asset)");
      if (skip.size) {
        rs = rs.not("wallet_pubkey", "in", inList(skip));
        rp = rp.not("wallet_pubkey", "in", inList(skip)).not("user_pubkey", "in", inList(skip));
      }
      const [swapRows, plantRows] = await Promise.all([
        rows(rs.order("ts", { ascending: false }).limit(RECENT)),
        rows(rp.order("ts", { ascending: false }).limit(RECENT)),
      ]);
      const recentSwaps = swapRows.map((r) => ({ at: String(r.ts), wallet: shortWallet(String(r.wallet_pubkey)), usdCents: r.usd_size_cents == null ? null : Number(r.usd_size_cents), status: r.planting_id ? "planted" : "saved at next daily run" }));
      // usdCents = what the planting pulled; coin = its legs' assets ("?" for a planting with no legs, e.g. one that failed early).
      const recentPlantings = plantRows.map((r) => {
        const coins = ((r.planting_legs as Row[] | null) ?? []).map((l) => String(l.asset));
        return { at: String(r.ts), wallet: shortWallet(String(r.wallet_pubkey)), coin: coins.length ? coins.join("+") : "?", usdCents: Number(r.usdc_pulled_cents), status: String(r.status) };
      });

      return { now: { linkedNow, active7d }, funnel: { d1: fd1, d7: fd7, all: fall }, signInFailures24h, linkFailures7d, activity7d, recentSwaps, recentPlantings };
    },
  };
}
