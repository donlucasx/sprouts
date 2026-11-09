import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "./api";
import { store } from "./store";
import { QUESTIONS, type Question } from "./feedback";

/** 11-01: Settings > Message us. The topics as the API knows them (api/src/app/api/support/route.ts), in the order they show. */
export const SUPPORT_TOPICS = [
  { value: "link", label: "Linking a wallet" },
  { value: "planting", label: "Plantings" },
  { value: "withdraw", label: "Withdrawing" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number]["value"];
export const MESSAGE_MAX = 2000;

const EMAIL_KEY = "support.email";
/** The address from the last message sent, kept on this phone only, so it is typed once. */
export const readSupportEmail = (): string => store.getString(EMAIL_KEY) ?? "";
export const writeSupportEmail = (email: string) => store.set(EMAIL_KEY, email.trim());

/** Close to what the API accepts; the API has the last word (a 400 shows its own message). */
export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const canSend = (message: string, email: string) => message.trim().length > 0 && message.length <= MESSAGE_MAX && looksLikeEmail(email);

export const isTopic = (v: unknown): v is SupportTopic => SUPPORT_TOPICS.some((t) => t.value === v);

/** What is attached beside the message (the server adds the wallets and the recent failures it already holds). */
export function appLine(): { version: string; device: string } {
  const model = (Platform.constants as { Model?: string }).Model;
  return { version: Constants.expoConfig?.version ?? "?", device: model ?? Platform.OS };
}

/** Sends one message; answers its reference (11-01, his ruling A: shown on the sent screen, quoted in the founder's reply). */
export async function sendSupport(m: { topic: SupportTopic | null; message: string; email: string }): Promise<string | null> {
  const r = await api<{ ref?: string }>("/api/support", { method: "POST", body: { topic: m.topic, message: m.message.trim(), email: m.email.trim(), app: appLine() } });
  writeSupportEmail(m.email);
  return typeof r.ref === "string" ? r.ref : null;
}

/** One row of the user's own log (his ruling B): reference, time, topic, the start of the text. */
/** 11-08: an answer to a question (topic = the question, choice = the picked option) can be a row too. */
export type SupportLogEntry = { ref: string | null; ts: string; topic: string | null; preview: string; choice?: string | null };

const asQuestion = (t: string | null): (typeof QUESTIONS)[Question] | null =>
  t !== null && Object.prototype.hasOwnProperty.call(QUESTIONS, t) ? QUESTIONS[t as Question] : null;
export const SUPPORT_LOG_KEY = ["support-log"] as const;
export async function fetchSupportLog(): Promise<SupportLogEntry[]> {
  return (await api<{ messages?: SupportLogEntry[] }>("/api/support")).messages ?? [];
}

/** "S-7K3Q · Nov 1 · Linking a wallet": the log row's first line. */
export function logLine(e: SupportLogEntry): string {
  const day = new Date(e.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const topic = SUPPORT_TOPICS.find((t) => t.value === e.topic)?.label ?? asQuestion(e.topic)?.title;
  return [e.ref, day, topic].filter(Boolean).join(" \u00b7 ");
}

/** The row's text: the message, or for an answer its picked option, then the note if one was written. */
export function previewOf(e: SupportLogEntry): string {
  const picked = asQuestion(e.topic)?.options.find((o) => o.value === e.choice)?.label;
  if (!picked) return e.preview;
  return e.preview ? `${picked}: ${e.preview}` : picked;
}
