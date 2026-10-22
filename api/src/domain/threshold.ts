/**
 * First planting (owner 10-22, "first planting right away"): a user who has never planted plants once their round-ups reach 50
 * cents, so a new user sees the garden grow on day one instead of after ~3 swaps and up to a day's wait. From their first planting
 * on, their own threshold (default $2) applies.
 *
 * Why 50 cents is safe: plantings of 10 and 20 cents have landed on mainnet (spikes/RESULTS.md, 09-28); the leash floor is a
 * percentage of the pull (98.5% on the coin legs), so it does not bind harder on a small pull; NETWORK_FEE_CENTS is 0 (Sprouts
 * pays the network fee); the puller's one-time token-account rent (~0.002 SOL per user per coin) is paid on a user's first planting
 * of a coin whatever its size, so a smaller first planting only brings it forward. 50 is also the app's own lowest "Plant at" step
 * (watcher.ts). A user whose own threshold is lower keeps theirs.
 */
export const FIRST_PLANTING_MIN_CENTS = 50;

/**
 * The one place the planting threshold is decided. `hasPlanted`: the user has a planting that is `sent` or `confirmed` (one in
 * flight counts: if it fails its round-ups are released and the user is first-time again).
 */
export function plantThresholdFor(a: { ruleCents: number; hasPlanted: boolean }): number {
  return a.hasPlanted ? a.ruleCents : Math.min(a.ruleCents, FIRST_PLANTING_MIN_CENTS);
}
