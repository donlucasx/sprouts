import { DEFAULT_RULES } from "@/domain/roundup";
import type { Repo } from "@/db/repo";
import type { RulesRow } from "@/db/types";

/** The defaults a first getRules would write, built in memory only (memory.ts builds its default row the same way). */
export const defaultRules = (userPubkey: string): RulesRow => ({ ...DEFAULT_RULES, pins: {}, allocation: { ...DEFAULT_RULES.allocation }, prevAllocation: null, allocationDay: null, pinsByUndo: false, userPubkey, updatedAt: new Date() });

/**
 * 11-25 (server queue): a user's rules for a READ path. getRules inserts the defaults row on a first read, so a GET that called it
 * wrote to the database; this reads the row or builds the same defaults in memory, writing nothing.
 */
export async function readRules(repo: Repo, userPubkey: string): Promise<RulesRow> {
  return (await repo.findRules(userPubkey)) ?? defaultRules(userPubkey);
}
