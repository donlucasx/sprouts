import { useState } from "react";
import { TwoWay } from "@/components/TwoWay";
import { withdrawMode } from "@/lib/me-state";
import { amountProblem, maxAmountText, parseSkr } from "@/lib/forms";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useMobileWallet } from "@wallet-ui/react-native-kit";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { api, ApiError } from "@/lib/api";
import { useMe, useInvalidateMe } from "@/lib/me";
import { makeSigner } from "@/lib/sign";
import { formatSkr } from "@/lib/format";

type Plan = { transaction: string; shares: string; amountRaw: string; prunes: boolean; brief: string[] };

export default function Withdraw() {
  const { data: me } = useMe();
  const { signTransaction } = useMobileWallet();
  const invalidate = useInvalidateMe();
  const [chosen, setMode] = useState<"earned" | "amount" | null>(null);
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return <Screen back><Text style={{ color: "#6B6558" }}>Loading</Text></Screen>;
  const skrUsd = me.pot.skrUsd;
  const earned = BigInt(me.pot.skrEarnedRaw);
  const canEarned = earned >= 1_000_000n;
  const mode = withdrawMode(earned, chosen);
  const held = BigInt(me.pot.skrStakedRaw);
  const problem = mode === "amount" ? amountProblem(amount, held) : null;

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const amountRaw = mode === "amount" ? String(parseSkr(amount)) : undefined;
      setPlan(await api<Plan>("/api/withdraw/build", { method: "POST", body: { mode, amountRaw } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not prepare the withdrawal.");
    } finally {
      setBusy(false);
    }
  }
  async function sign() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await makeSigner(signTransaction)(plan.transaction);
      await api("/api/withdraw/confirm", { method: "POST", body: { signedTransaction: signed } });
      await invalidate();
      router.replace("/home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The withdrawal did not go through. Nothing moved.");
    } finally {
      setBusy(false);
    }
  }
  async function putBack() {
    setBusy(true);
    setError(null);
    try {
      const t = await api<{ transaction: string }>("/api/withdraw/cancel/build", { method: "POST", body: {} });
      const signed = await makeSigner(signTransaction)(t.transaction);
      await api("/api/withdraw/cancel/confirm", { method: "POST", body: { signedTransaction: signed } });
      await invalidate();
      router.replace("/home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not put it back. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (me.basket) {
    return (
      <Screen back>
        <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>In the basket</Text>
        <Card>
          <Text style={{ fontSize: 18, color: "#2B2B2B" }}>{formatSkr(BigInt(me.basket.amountRaw), skrUsd)}</Text>
          <Text style={{ fontSize: 15, color: "#6B6558" }}>
            Arrives {new Date(me.basket.readyAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })}. It stopped earning when you signed. {"One basket at a time: your Seeker's wallet cannot start another withdrawal until this one arrives."}
          </Text>
          <Button title={busy ? "Waiting for your Seeker" : "Put it back"} kind="quiet" disabled={busy} onPress={putBack} />
        </Card>
        {error ? <Text style={{ color: "#8C2F2F" }}>{error}</Text> : null}
      </Screen>
    );
  }

  return (
    <Screen back>
      <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>Withdraw</Text>
      {!plan ? (
        <Card>
          <Text style={{ fontSize: 16, color: "#2B2B2B" }}>What do you want to take out?</Text>
          <TwoWay options={[{ value: "earned", label: "What it earned" }, { value: "amount", label: "An amount" }]} value={mode} onChange={setMode} />
          <Text style={{ fontSize: 14, lineHeight: 20, color: "#6B6558" }}>
            {mode === "earned"
              ? "Only the rewards your garden earned. What you put in stays planted and keeps earning."
              : "Any amount, up to everything in your garden. Taking more than it earned prunes a plant."}
          </Text>
          {mode === "earned" ? (
            <>
              <Text style={{ fontSize: 15, color: "#2B2B2B" }}>Earned so far: {formatSkr(earned, skrUsd)}</Text>
              {!canEarned ? <Text style={{ fontSize: 14, color: "#6B6558" }}>You can withdraw once your earned SKR reaches 1 SKR.</Text> : null}
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 15, color: "#2B2B2B" }}>Available: {formatSkr(held, skrUsd)}</Text>
                <Button title="Max" kind="quiet" onPress={() => setAmount(maxAmountText(held))} />
              </View>
              <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount in SKR" placeholderTextColor="#9A9384" accessibilityLabel="Amount in SKR" style={{ fontSize: 22, borderBottomWidth: 1, borderBottomColor: "#CFC8B8", paddingVertical: 8, color: "#2B2B2B" }} />
              {problem ? <Text style={{ fontSize: 14, color: amount.trim() === "" ? "#6B6558" : "#8C2F2F" }}>{problem}</Text> : null}
            </>
          )}
          <Text style={{ fontSize: 14, color: "#6B6558" }}>{"It reaches your Seeker's wallet 48 hours after you sign."}</Text>
          <Button title="Continue" disabled={busy || (mode === "earned" && !canEarned) || problem !== null} onPress={prepare} />
        </Card>
      ) : (
        <Card>
          {plan.brief.map((l, i) => <Text key={i} style={{ fontSize: 15, lineHeight: 22, color: "#2B2B2B" }}>{l}</Text>)}
          <Button title={busy ? "Waiting for your Seeker" : "Withdraw"} kind={plan.prunes ? "danger" : "primary"} disabled={busy} onPress={sign} />
          <Button title="Back" kind="quiet" onPress={() => setPlan(null)} />
        </Card>
      )}
      {error ? <Text style={{ color: "#8C2F2F" }}>{error}</Text> : null}
    </Screen>
  );
}
