import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createSolanaMainnet, MobileWalletProvider } from "@wallet-ui/react-native-kit";
import { identity } from "@/lib/identity";
import { loadSession, saveSession, SessionContext, type Session } from "@/lib/session";
import { registerBackgroundRefresh } from "@/lib/background"; // the task itself is defined from index.js (headless starts)
import { askNotificationPermissionOnce } from "@/lib/notify";

// Only Mobile Wallet Adapter's plumbing touches this endpoint; every read the app shows comes from the API.
const cluster = createSolanaMainnet({ url: "https://api.mainnet-beta.solana.com" });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });

export default function Layout() {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadSession().then((s) => {
      setSessionState(s);
      setReady(true);
      if (s) {
        registerBackgroundRefresh().catch(() => {});
        askNotificationPermissionOnce().catch(() => {});
      }
    });
  }, []);
  const setSession = async (s: Session | null) => {
    await saveSession(s);
    // Every read cached under the old session goes with it (09-29: after sign-out, Home's last read was a 401; signing back in
    // found that 401 still cached, took the new session for dead and threw it away, so sign-in bounced back to Welcome).
    queryClient.clear();
    setSessionState(s);
  };
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <MobileWalletProvider cluster={cluster} identity={identity}>
        <SessionContext.Provider value={{ session, setSession }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F4EEDF" } }} />
        </SessionContext.Provider>
      </MobileWalletProvider>
    </QueryClientProvider>
  );
}
