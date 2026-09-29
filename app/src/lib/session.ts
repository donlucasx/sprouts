import * as SecureStore from "expo-secure-store";
import { createContext, useContext } from "react";

/** What the phone keeps: the opaque session token (R84, seven days, revocable), the Seeker's key and its .skr name. */
export type Session = { token: string; pubkey: string; skrName: string | null };
const KEY = "sprouts.session";

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session | null): Promise<void> {
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(KEY);
}

const DEVICE_KEY = "sprouts.device";

/** This installation's id, made once at random (R84: one live session per wallet per device); never the Genesis mint, which every client of one Seeker shares. */
export async function installationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const id = `phone-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  await SecureStore.setItemAsync(DEVICE_KEY, id);
  return id;
}

export const SessionContext = createContext<{ session: Session | null; setSession: (s: Session | null) => Promise<void> }>({
  session: null,
  setSession: async () => {},
});

export const useSession = () => useContext(SessionContext);
