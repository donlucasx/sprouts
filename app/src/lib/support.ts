import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "./api";
import { store } from "./store";

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

export async function sendSupport(m: { topic: SupportTopic | null; message: string; email: string }): Promise<void> {
  await api("/api/support", { method: "POST", body: { topic: m.topic, message: m.message.trim(), email: m.email.trim(), app: appLine() } });
  writeSupportEmail(m.email);
}
