import { useState } from "react";
import { Text } from "react-native";
import { Redirect } from "expo-router";
import { useMobileWallet } from "@wallet-ui/react-native-kit";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { useSession } from "@/lib/session";
import { signInWithSeeker } from "@/lib/signin";
import { ApiError } from "@/lib/api";

function isCanceled(e: unknown) {
  const code = e !== null && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  const m = e instanceof Error ? e.message : "";
  return code === "ERROR_ASSOCIATION_CANCELLED" || m.includes("CancellationException") || m.includes("cancelled by user");
}

export default function Welcome() {
  const { session, setSession } = useSession();
  const { signIn } = useMobileWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (session) return <Redirect href="/home" />;
  return (
    <Screen>
      <Text style={{ fontSize: 34, fontStyle: "italic", fontFamily: "serif", color: "#2F5D3A", marginTop: 60 }}>Sprouts</Text>
      <Text style={{ fontSize: 20, lineHeight: 28, color: "#2B2B2B" }}>A Yield Manager that rounds up your swaps and grows the change while you trade. SKR first, locked to your Seeker.</Text>
      <Button
        title={busy ? "Waiting for your Seeker" : "Sign in with your Seeker"}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await setSession(await signInWithSeeker(signIn));
          } catch (e) {
            if (!isCanceled(e)) setError(e instanceof ApiError ? e.message : "Sign-in did not go through. Try again.");
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
