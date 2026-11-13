// Pure view helpers for the ops page (no React, no I/O) so the ordering and wording rules are testable.
import type { Light, LightState } from "./lights";

const ORDER: Record<string, number> = { red: 0, amber: 1, unknown: 2 };

/** Lights that need the founder: red first, then amber, then unknown (stable within a state). Green and info never appear. */
export function needsAttention(lights: Light[]): Light[] {
  return lights.filter((l) => l.state in ORDER).map((l, i) => ({ l, i })).sort((a, b) => ORDER[a.l.state] - ORDER[b.l.state] || a.i - b.i).map((x) => x.l);
}

export type Verdict = { attention: Light[]; fine: Light[]; headline: string };

export function verdict(lights: Light[]): Verdict {
  const attention = needsAttention(lights);
  return {
    attention,
    fine: lights.filter((l) => l.state === "green"),
    headline: attention.length === 0 ? "All good. Nothing needs you." : `Needs attention: ${attention.length}`,
  };
}

export const STATE_WORD: Record<LightState, string> = { green: "Green", amber: "Amber", red: "Red", unknown: "Unknown", info: "Info" };

/** "4 min ago", "3 h ago", "2 d ago"; "just now" under a minute or for a clock slightly ahead. */
export function relativeAgo(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 48 * 3_600_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}

export const hhmmUtc = (iso: string) => `${iso.slice(11, 16)} UTC`;

const LINK_FAILURE_NAMES: Record<string, string> = {
  "app:declined": "declined in the app",
  "app:dropped": "wallet connection dropped",
  "app:refused": "blocked by Sprouts' safety check",
  "app:other": "other problem in the app",
  "app:?": "unknown problem in the app",
  "server:approval": "approval step failed",
  "server:confirm": "confirmation failed",
  "server:?": "unknown step failed",
};

/** Plain name for a link-failure key; an unmapped key is shown as the generic text, never the raw key. */
export const linkFailureName = (key: string): string => LINK_FAILURE_NAMES[key] ?? (key.startsWith("app:") ? "other problem in the app" : "other step failed");

export const savedIntoCoinsCents = (byCoin: Record<string, { usdCents: number }>): number => Object.values(byCoin).reduce((s, c) => s + c.usdCents, 0);
