/** The one-time note from Lucas, shown once per phone (the app remembers the id). Copy: submission/release-0.1.9-copy.md. */
export type InAppMessage = { id: string; heading: string; body: string; action: "message_us" };

export const CURRENT_MESSAGE: InAppMessage = {
  id: "lucas-2026-11",
  heading: "From Lucas",
  body: "You're one of the first people using Sprouts. If you have any questions, ideas or feedback, please reach out!",
  action: "message_us",
};
