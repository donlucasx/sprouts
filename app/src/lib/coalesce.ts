/**
 * Calls that overlap share one run. Android can hand the background task a backlog of runs at once (seen 10-05 07:12: nine
 * queued runs fired together, each read the same last /api/me, and each re-sent the same notices); sharing one run means
 * one read, one compare, one set of notices.
 */
export function coalesce<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => (running ??= fn().finally(() => { running = null; }));
}
