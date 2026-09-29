import { Linking, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { api, type ActivityResponse } from "@/lib/api";
import { useMe } from "@/lib/me";
import { formatSkr, formatUsd } from "@/lib/format";

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
  return (
    <Screen back>
      <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>Activity</Text>
      {!a ? <Text style={{ color: "#6B6558" }}>{q.isError ? "Could not load the activity just now." : "Loading"}</Text> : null}
      {a ? (
        <>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Plantings</Text>
            {a.plantings.length === 0 ? <Text style={{ color: "#6B6558" }}>No planting yet.</Text> : null}
            {a.plantings.map((p) => {
              const leg = p.legs[0];
              const what = p.status === "confirmed" && leg ? `${formatUsd(p.usdcPulledCents)} pulled, ${formatSkr(BigInt(leg.amountOutRaw), skrUsd)} planted` : p.status === "failed" ? "did not land, nothing pulled" : "in flight";
              return <Line key={p.id} text={`${day(p.ts)}, ${what}`} signature={p.signature} />;
            })}
          </Card>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Swaps</Text>
            {a.swaps.length === 0 ? <Text style={{ color: "#6B6558" }}>No swap seen yet.</Text> : null}
            {a.swaps.map((s) => (
              <Line key={s.signature} text={`${day(s.ts)}, ${s.usdSizeCents === null ? "unpriced swap" : `${formatUsd(s.usdSizeCents)} swap`}, change ${formatUsd(s.roundupCents)}${s.plantingId ? ", planted" : ", waiting"}`} signature={s.signature} />
            ))}
          </Card>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Withdrawals</Text>
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
