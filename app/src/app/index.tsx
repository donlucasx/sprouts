import { useState } from "react";
import { Text } from "react-native";
import { Redirect } from "expo-router";
import { freshWalletSignIn } from "@/lib/reauth";
import { identity } from "@/lib/identity";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { useSession } from "@/lib/session";
import { signInWithSeeker } from "@/lib/signin";
import { ApiError } from "@/lib/api";

function isCanceled(e: unknown) {
  const code = e !== null && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  const m = e instanceof Error ? e.message : "";
  // -1 is the Mobile Wallet Adapter's ERROR_AUTHORIZATION_FAILED: the wallet declined the request (10-01: Solflare on the Saga answered it for sprouts.money).
  return code === "ERROR_ASSOCIATION_CANCELLED" || code === "-1" || m.includes("authorization request failed") || m.includes("CancellationException") || m.includes("cancelled by user");
}

export default function Welcome() {
  const { session, setSession } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (session) return <Redirect href="/home" />;
  return (
    <Screen>
      <Text style={{ fontSize: 34, fontStyle: "italic", fontFamily: "serif", color: "#2F5D3A", marginTop: 60 }}>Sprouts</Text>
      <Text style={{ fontSize: 20, lineHeight: 28, color: "#2B2B2B" }}>Round-ups into SKR that your Seeker keeps and a yield manager grows.</Text>
      <Button
        title={busy ? "Waiting for your Seeker" : "Sign in with your Seeker"}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            // The token-free authorize (reauth.ts): the kit's own signIn sends its saved token, which Solflare declines once it is stale (-1; the Saga, 10-01 after a sign-out).
            await setSession(await signInWithSeeker(freshWalletSignIn(identity)));
          } catch (e) {
            // Dev builds only: the raw error for Metro's terminal (10-01: the Saga showed the generic line and nothing else).
            if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[signin] failed: ${e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e)}`, e);
            // A wallet that declines (a scam-screen block reports as a cancel) gets its own line instead of silence (10-01 device check).
            setError(isCanceled(e) ? "Your wallet did not sign. Try again, or sign in with another wallet app that holds your Seeker's seed." : e instanceof ApiError ? e.message : "Sign-in did not go through. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <Text style={{ color: "#8C2F2F", fontSize: 15 }}>{error}</Text> : null}
      <Text style={{ fontSize: 14, color: "#6B6558" }}>No transaction, no fee. The vault needs a Seeker or a Saga with its Genesis Token.</Text>
    </Screen>
  );
}
