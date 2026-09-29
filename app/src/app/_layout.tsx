import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createSolanaMainnet, MobileWalletProvider, type AppIdentity } from "@wallet-ui/react-native-kit";
import { loadSession, saveSession, SessionContext, type Session } from "@/lib/session";

const identity: AppIdentity = { name: "Sprouts", uri: "https://sprouts-api-gamma.vercel.app" };
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
    });
  }, []);
  const setSession = async (s: Session | null) => {
    await saveSession(s);
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
