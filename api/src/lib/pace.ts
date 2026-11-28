/**
 * A per-process rolling-window pace: at most `max` requests start in any window of `windowMs`, first come first served. The RPC pace
 * (rpc.ts createPace: 30 a second) is this queue. (11-27 to 11-28 the daily run's Jupiter pace was too, at 40 a minute; it is now
 * createTokenLane below: the window let 40 calls start in one burst.)
 * Kept in its own module (no config, no rpc import) so route tests that mock "@/lib/rpc" or "@/lib/jupiter" still load it.
 *
 * `notAfterMs` (11-27): a caller with a deadline. When its turn would only come after that time, the call rejects at once with
 * PaceRefused (no slot is taken, no wait happens) instead of waiting past it; the requests queued behind it keep their turns.
 */
export class PaceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaceRefused";
  }
}

export type WindowPaceOptions = {
  max: number;
  windowMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (s: string) => void;
  /** The log line's name ("rpc pace", "jupiter pace"). */
  label?: string;
  /** A wait longer than this is logged, so the pace can be tuned. Default 1 s. */
  logOverMs?: number;
};

export type Pace = (o?: { notAfterMs?: number }) => Promise<void>;

export function createWindowPace(opts: WindowPaceOptions): Pace {
  const { max, windowMs } = opts;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((s: string) => console.log(s));
  const label = opts.label ?? "pace";
  const logOverMs = opts.logOverMs ?? 1000;
  const starts: number[] = [];
  let queue: Promise<void> = Promise.resolve();
  if (max <= 0) return async () => {};   // no pace
  return (o = {}) => {
    const asked = now();
    const turn = queue.then(async () => {
      for (;;) {
        const t = now();
        while (starts.length && starts[0] <= t - windowMs) starts.shift();
        if (starts.length < max) { starts.push(t); break; }
        const wake = starts[0] + windowMs;
        if (o.notAfterMs !== undefined && wake > o.notAfterMs) throw new PaceRefused(`${label}: the next turn (in ${wake - t} ms) is past the caller's deadline`);
        await sleep(wake - t);
      }
      const waited = now() - asked;
      if (waited > logOverMs) log(`${label}: a request waited ${waited} ms for its turn`);
    });
    queue = turn.catch(() => {});
    return turn;
  };
}

export type LanePriority = "user" | "run";
export type Lane = (o?: { notAfterMs?: number; priority?: LanePriority }) => Promise<void>;

export type TokenLaneOptions = {
  /** One start per this many ms, never two closer together (a bucket of one token, refilled every intervalMs: no bursts). */
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (s: string) => void;
  label?: string;
  logOverMs?: number;
};

/**
 * 11-28 (Kimi Jupiter re-assessment fix 2): ONE lane per process for every Jupiter call. A token bucket of size one: a start at most
 * every `intervalMs`, so a queue drains evenly instead of in a 40-call burst (the old 40/min window let 40 go at once). Priority: a
 * waiting "user" call (a price, a top-up) always goes before a waiting "run" call (the planting run), first come first served inside a
 * priority; nothing bypasses the lane. `notAfterMs` keeps the window pace's PaceRefused semantics: when the caller's earliest possible
 * turn (given everyone ordered before it) is past its deadline, it rejects at once and takes no turn. That is re-judged whenever the
 * queue changes, so a run call pushed past its deadline by a user call arriving is refused then, not sent late.
 */
export function createTokenLane(opts: TokenLaneOptions): Lane {
  const interval = opts.intervalMs;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((s: string) => console.log(s));
  const label = opts.label ?? "lane";
  const logOverMs = opts.logOverMs ?? 1000;
  if (interval <= 0) return async () => {};   // no lane
  type Waiter = { seq: number; rank: number; notAfterMs?: number; asked: number; resolve: () => void; reject: (e: Error) => void };
  const waiting: Waiter[] = [];
  let seq = 0;
  let nextAt = Number.NEGATIVE_INFINITY;
  let pumping = false;
  const order = () => waiting.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  /** Refuses every waiter whose earliest turn is past its deadline (each one before it takes one interval). */
  const prune = () => {
    order();
    let slot = Math.max(now(), nextAt);
    for (let i = 0; i < waiting.length; ) {
      const w = waiting[i];
      if (w.notAfterMs !== undefined && slot > w.notAfterMs) {
        waiting.splice(i, 1);
        w.reject(new PaceRefused(`${label}: the next turn (in ${Math.round(slot - now())} ms) is past the caller's deadline`));
        continue;
      }
      slot += interval;
      i++;
    }
  };
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        prune();
        if (!waiting.length) return;
        const t = now();
        if (t < nextAt) { await sleep(nextAt - t); continue; }   // re-judged after the wait: a user call may have arrived
        const w = waiting.shift() as Waiter;
        nextAt = t + interval;
        const waited = t - w.asked;
        if (waited > logOverMs) log(`${label}: a ${w.rank === 0 ? "user" : "run"} request waited ${waited} ms for its turn`);
        w.resolve();
      }
    } finally {
      pumping = false;
    }
  };
  return (o = {}) => new Promise<void>((resolve, reject) => {
    waiting.push({ seq: seq++, rank: o.priority === "run" ? 1 : 0, ...(o.notAfterMs !== undefined ? { notAfterMs: o.notAfterMs } : {}), asked: now(), resolve, reject });
    if (pumping) prune();   // judged at once, also while the pump sleeps (a late arrival can push a run call past its deadline)
    void pump();
  });
}
