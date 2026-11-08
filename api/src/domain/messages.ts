/** The one-time note from Lucas, shown once per phone (the app remembers the id). Copy: submission/release-0.1.9-copy.md. */
export type InAppMessage = { id: string; heading: string; body: string; action: "message_us" };

export const CURRENT_MESSAGE: InAppMessage = {
  id: "lucas-2026-11",
  heading: "From Lucas",
  body: "Thanks for trying Sprouts. If anything didn't work or felt confusing, tell me. I read every message.",
  action: "message_us",
};
