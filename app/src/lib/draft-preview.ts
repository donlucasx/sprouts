import { useSyncExternalStore } from "react";
import type { MeResponse } from "./api";

/**
 * DRAFT (10-26, his "go w 1": the next release drafted live on the phones before he approves it). DEV builds only: the dev menu puts
 * this phone's wallet into the states he has to review without touching money: paused for want of USDC, or low on it. Nothing here is
 * sent anywhere; the API and the wallet are never asked. Off by default and in release builds.
 */
export type DraftPreview = "off" | "paused" | "low";
let current: DraftPreview = "off";
const subs = new Set<() => void>();
export function setDraftPreview(p: DraftPreview) {
  current = p;
  subs.forEach((f) => f());
}
export const draftPreview = () => current;
export function useDraftPreview(): DraftPreview {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => current);
}

/** The USDC this phone's wallet is shown to hold while previewing "low" (cents). */
export const PREVIEW_LOW_CENTS = 120;
/** A daily round-up average for the preview when the account has too little history for a real one (cents a day). */
export const PREVIEW_AVG_CENTS = 35;

/** The read as the preview shows it: "paused" pauses this phone's wallet for want of USDC; "low" and "off" change nothing here. */
export function withDraftPreview(me: MeResponse, p: DraftPreview = current): MeResponse {
  if (p !== "paused") return me;
  const need = Math.max(me.nextPlanting.thresholdCents, me.nextPlanting.pendingCents);
  return {
    ...me,
    // shown as most users have it, one wallet: the phone's, paused (a second, still planting wallet keeps the garden "not paused")
    wallets: me.wallets
      .filter((w) => w.pubkey === me.user.pubkey)
      .map((w) => ({ ...w, status: "paused" as const, pause: { reason: "no_usdc" as const, needCents: need, resumeAtCents: me.nextPlanting.thresholdCents } })),
  };
}
