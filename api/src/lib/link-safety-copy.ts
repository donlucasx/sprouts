/**
 * His ask 10-28 ("can we use the same copy / format for the disclosure that appears under the code box on the /link website page?"):
 * the app's Link a wallet lines, said the same way under the code box on /link (safety.tsx LinkSafety). The app keeps its own copy in
 * app/src/lib/safety-copy.ts; app/tests/lib/safety-copy.test.ts fails if the two drift.
 */
export const LINK_INTRO = "Every swap rounds up. Once a day, Sprouts plants the change using USDC in your wallet.";

export const CAN: readonly string[] = ["Plants up to $5 of USDC a day, only into your own savings"];

export const CANT: readonly string[] = [
  "Can't send your money anywhere else, even if our server is hacked",
  "Can't touch other tokens or sell your garden",
];
