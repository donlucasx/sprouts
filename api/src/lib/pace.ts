/**
 * A per-process rolling-window pace: at most `max` requests start in any window of `windowMs`, first come first served. The RPC pace
 * (rpc.ts createPace: 30 a second) and, since 11-27, the daily run's Jupiter pace (jupiter.ts: 40 a minute) are both this one queue.
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
