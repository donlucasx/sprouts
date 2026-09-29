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

export const SessionContext = createContext<{ session: Session | null; setSession: (s: Session | null) => Promise<void> }>({
  session: null,
  setSession: async () => {},
});

export const useSession = () => useContext(SessionContext);
