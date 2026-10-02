import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { api, ApiError, type ActivityResponse, type Asset } from "@/lib/api";
import { useMe, useInvalidateMe, useApplyRules } from "@/lib/me";
import { splitRowLine, SPLIT_SECTION } from "@/model/manager";
import { undoSplit } from "@/lib/manager-api";
import { formatSkr, formatUsd, formatAmount, feeClause } from "@/lib/format";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const solscan = (sig: string) => Linking.openURL(`https://solscan.io/tx/${sig}`);

function Line({ text, signature }: { text: string; signature?: string | null }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, paddingVertical: 4 }}>
      <Text style={{ fontSize: 14, color: "#2B2B2B", flex: 1 }}>{text}</Text>
      {signature ? <Pressable onPress={() => solscan(signature)}><Text style={{ fontSize: 13, color: "#2F5D3A" }}>Solscan</Text></Pressable> : null}
    </View>
  );
}

/** Every swap, planting and withdrawal, newest first, each with its transaction on Solscan. */
export default function Activity() {
  const { data: me } = useMe();
  const skrUsd = me?.pot.skrUsd ?? null;
  const q = useQuery({ queryKey: ["activity"], queryFn: () => api<ActivityResponse>("/api/activity") });
  const a = q.data;
  const invalidate = useInvalidateMe();
  const applyRules = useApplyRules();
  const [busy, setBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const usdFor = (x: Asset) => (x === "SKR" ? me?.pot.skrUsd ?? null : x === "stORE" ? me?.pot.storeUsd ?? null : null);

  async function undo() {
    setBusy(true); setUndoError(null);
    try {
      const answer = await undoSplit();
      // The answer lands on the cached read at once; the rows refresh before the button settles.
      applyRules(answer, { managed: false, undoAvailable: false, changedDay: null });
      void invalidate();
      await q.refetch();
    } catch (e) {
      setUndoError(e instanceof ApiError ? e.message : "Could not undo. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>Activity</Text>
      {!a ? <Text style={{ color: "#6B6558" }}>{q.isError ? "Could not load the activity just now." : "Loading"}</Text> : null}
      {a ? (
        <>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Plantings</Text>
            <Text style={{ fontSize: 13, color: "#6B6558" }}>Each time your change was pulled, swapped and planted in your garden.</Text>
            {a.plantings.length === 0 ? <Text style={{ color: "#6B6558" }}>No planting yet.</Text> : null}
            {a.plantings.map((p) => {
              const leg = p.legs[0];
              const what = p.status === "confirmed" && leg ? `${formatUsd(p.usdcPulledCents)} pulled, ${formatAmount(leg.asset, BigInt(leg.amountOutRaw), usdFor(leg.asset))} planted${feeClause(leg.feeCents)}` : p.status === "failed" ? "did not land, nothing pulled" : "in flight";
              return <Line key={p.id} text={`${day(p.ts)}, ${what}`} signature={p.signature} />;
            })}
          </Card>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>{SPLIT_SECTION.title}</Text>
            <Text style={{ fontSize: 13, color: "#6B6558" }}>{SPLIT_SECTION.sub}</Text>
            {a.splits.length === 0 ? <Text style={{ color: "#6B6558" }}>{SPLIT_SECTION.empty}</Text> : null}
            {a.splits.map((s, i) => (
              <View key={`${s.ts}-${i}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 14, color: "#2B2B2B", flex: 1 }}>{splitRowLine(s)}</Text>
                {i === 0 && s.by === "manager" && me?.manager.undoAvailable ? (
                  <Button title={busy ? "Undoing..." : "Undo"} kind="quiet" disabled={busy} onPress={undo} />
                ) : null}
              </View>
            ))}
            {undoError ? <Text style={{ color: "#8C2F2F" }}>{undoError}</Text> : null}
          </Card>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Swaps</Text>
            <Text style={{ fontSize: 13, color: "#6B6558" }}>The trades seen in your linked wallets, and the change each one set aside.</Text>
            {a.swaps.length === 0 ? <Text style={{ color: "#6B6558" }}>No swap seen yet.</Text> : null}
            {a.swaps.map((s) => (
              <Line key={s.signature} text={`${day(s.ts)}, ${s.usdSizeCents === null ? "unpriced swap" : `${formatUsd(s.usdSizeCents)} swap`}, change ${formatUsd(s.roundupCents)}${s.plantingId ? ", planted" : ", waiting"}`} signature={s.signature} />
            ))}
          </Card>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Withdrawals</Text>
            <Text style={{ fontSize: 13, color: "#6B6558" }}>SKR you took out of your garden, on its way or delivered.</Text>
            {a.withdrawals.length === 0 ? <Text style={{ color: "#6B6558" }}>No withdrawal yet.</Text> : null}
            {a.withdrawals.map((w) => (
              <Line
                key={w.id}
                text={`${day(w.ts)}, ${w.amountRaw ? formatSkr(BigInt(w.amountRaw), skrUsd) : "an amount"} ${w.cancelled ? "put back" : w.delivered ? "delivered" : "in the basket"}${w.source === "wallet" ? " (from your wallet)" : ""}`}
                signature={w.withdrawSignature ?? w.unstakeSignature}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
