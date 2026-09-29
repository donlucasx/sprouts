import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useMobileWallet } from "@wallet-ui/react-native-kit";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { api, ApiError } from "@/lib/api";
import { makeSigner } from "@/lib/sign";
import { useInvalidateMe } from "@/lib/me";
import { useSession } from "@/lib/session";

/**
 * Confirms the link; when the delegation is late on chain the API answers 409 and the same code is confirmed again (no new signature,
 * no new code), so a late approval never leaves a stray delegation behind a fresh one (review I7).
 */
async function confirmWithRetries(code: string, wallet: string, signedTransaction: string) {
  let body: Record<string, string> = { code, wallet, signedTransaction };
  for (let attempt = 0; ; attempt++) {
    try {
      await api("/api/link/confirm", { method: "POST", body });
      return;
    } catch (e) {
      const late = e instanceof ApiError && e.status === 409 && e.message.includes("No delegation found");
      if (!late || attempt >= 4) throw e;
      body = { code, wallet }; // the approval was sent; only the delegation read is pending
      await new Promise((r) => setTimeout(r, 4_000));
    }
  }
}

export default function Connect() {
  const { session } = useSession();
  const { signTransaction } = useMobileWallet();
  const invalidate = useInvalidateMe();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** This phone's wallet is the trading wallet: the Seed Vault key approves the delegation for itself. */
  async function linkThisPhone() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { code } = await api<{ code: string }>("/api/link/new", { method: "POST", body: {} });
      const t = await api<{ transaction: string; cap: number }>(`/api/link/${code}?wallet=${session.pubkey}`);
      const signed = await makeSigner(signTransaction)(t.transaction);
      await confirmWithRetries(code, session.pubkey, signed);
      await invalidate();
      router.replace("/home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The approval did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function codeForAnotherWallet() {
    setBusy(true);
    setError(null);
    try {
      setCode((await api<{ code: string }>("/api/link/new", { method: "POST", body: {} })).code);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not make a code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>Link a wallet</Text>
      <Text style={{ fontSize: 16, lineHeight: 24, color: "#2B2B2B" }}>
        Every swap from a linked wallet rounds up to the next dollar. The change is pulled once a day, up to $5, and planted into your garden. You approve once; you can revoke any time. Under a dollar of rent, refunded when you revoke. The underlying approval is unlimited; the program enforces the limit.
      </Text>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>{"This phone's wallet"}</Text>
        <Text style={{ fontSize: 14, color: "#6B6558" }}>One fingerprint. Daily limit $5.</Text>
        <Button title={busy ? "Waiting for your Seeker" : "Approve"} disabled={busy} onPress={linkThisPhone} />
      </Card>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Another wallet</Text>
        {code ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 34, letterSpacing: 6, fontWeight: "700", color: "#2B2B2B" }}>{code}</Text>
            <Text style={{ fontSize: 14, color: "#6B6558" }}>Open sprouts-api-gamma.vercel.app/link on the computer with that wallet, enter this code, approve with Phantom. The code lasts 15 minutes.</Text>
          </View>
        ) : (
          <Button title="Get a code" kind="quiet" disabled={busy} onPress={codeForAnotherWallet} />
        )}
      </Card>
      {error ? <Text style={{ color: "#8C2F2F" }}>{error}</Text> : null}
    </Screen>
  );
}
