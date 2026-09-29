import { useCallback, useMemo, useState } from "react";
import { Text, View, RefreshControl, ScrollView, Pressable } from "react-native";
import { Link, Redirect, useFocusEffect } from "expo-router";
import Svg from "react-native-svg";
import { useMe, useInvalidateMe, toGardenInput } from "@/lib/me";
import { api } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { Garden } from "@/garden/Garden";
import { WateringCan } from "@/garden/parts";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { WatcherLine } from "@/components/WatcherLine";
import { formatUsd, formatSkr, formatAsOf, formatWallet } from "@/lib/format";
import { useSession } from "@/lib/session";
import { noPlantingLine } from "@/lib/me-state";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function Home() {
  const { setSession } = useSession();
  const { data: me, stale, refetch, asOf, loading, unauthorized } = useMe();
  const invalidate = useInvalidateMe();
  const [justOpened, setJustOpened] = useState<Set<string>>(new Set());
  const [watering, setWatering] = useState(false);
  const now = new Date();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is taken once per render on purpose
  const scene = useMemo(() => (me ? buildScene(toGardenInput(me, now)) : null), [me]);
  // Coming back to Home reads again: a wallet linked on the web, a planting, a withdrawal show without a pull-down.
  useFocusEffect(useCallback(() => void refetch(), [refetch]));

  async function water() {
    if (!me || !scene) return;
    setWatering(true);
    const opening = new Set(scene.parts.filter((p) => p.kind === "sprout" && p.bud).map((p) => (p as { id: string }).id));
    try {
      await api("/api/water", { method: "POST", body: {} });
      setJustOpened(opening);
      await invalidate();
    } finally {
      setWatering(false);
    }
  }

  if (unauthorized) {
    // The token expired or was revoked (R84): back to Welcome.
    void setSession(null);
    return <Redirect href="/" />;
  }
  if (loading || !me || !scene) return <View style={{ flex: 1, backgroundColor: "#F4EEDF" }} />;
  const skrUsd = me.pot.skrUsd;
  const name = me.user.skrName;
  const line = scene.unrevealed > 0
    ? `${scene.unrevealed} new ${scene.unrevealed === 1 ? "sprout" : "sprouts"} since you last watered.`
    : scene.wateredToday ? "Watered today." : "Nothing new since you last watered.";
  const allStopped = me.wallets.length > 0 && me.wallets.every((w) => w.status !== "active");

  return (
    <ScrollView
      style={{ backgroundColor: "#F4EEDF" }}
      contentContainerStyle={{ padding: 20, gap: 14, paddingTop: 48 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => refetch()} />}
    >
      <Text style={{ fontSize: 22, fontStyle: "italic", fontFamily: "serif", color: "#2F5D3A" }}>{name ? `${name}'s garden` : "Your garden"}</Text>
      <Garden scene={scene} justOpened={justOpened} />
      {allStopped ? <Text style={{ fontSize: 14, color: "#6B6558" }}>Planting is paused. Your plant keeps its fruit and keeps earning.</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <WatcherLine text={line} />
        <Pressable onPress={water} disabled={watering || scene.wateredToday} style={{ opacity: scene.wateredToday ? 0.35 : 1, padding: 8 }} accessibilityLabel="Water the garden">
          <Svg width={36} height={24}><WateringCan /></Svg>
        </Pressable>
      </View>
      <Card>
        <Text style={{ fontSize: 15, color: "#6B6558" }}>In your garden, locked to your Seeker</Text>
        <Text style={{ fontSize: 28, fontWeight: "600", color: "#2B2B2B" }}>{formatSkr(BigInt(me.pot.skrStakedRaw), skrUsd)}</Text>
        <Text style={{ fontSize: 16, color: "#2B2B2B" }}>Put in {formatSkr(BigInt(me.pot.skrPutInRaw), skrUsd)}. Earned {formatSkr(BigInt(me.pot.skrEarnedRaw), skrUsd)}.</Text>
        {stale && asOf ? (
          <Text style={{ fontSize: 13, color: "#8C2F2F" }}>{formatAsOf(asOf, now)}, the chain could not be read just now.</Text>
        ) : asOf ? (
          <Text style={{ fontSize: 13, color: "#6B6558" }}>{formatAsOf(asOf, now)}</Text>
        ) : null}
      </Card>
      <Card>
        <Text style={{ fontSize: 16, color: "#2B2B2B" }}>Next planting: {formatUsd(me.nextPlanting.pendingCents)} of {formatUsd(me.nextPlanting.thresholdCents)}</Text>
        {me.lastReceipt ? (
          <Text style={{ fontSize: 14, color: "#6B6558" }}>
            Last planting {shortDate(me.lastReceipt.ts)}: {formatUsd(me.lastReceipt.usdcPulledCents)} pulled, {formatSkr(BigInt(me.lastReceipt.amountOutRaw), skrUsd)} planted, network fee {formatUsd(me.lastReceipt.networkFeeCents)}
          </Text>
        ) : (
          <Text style={{ fontSize: 14, color: "#6B6558" }}>{noPlantingLine(me)}</Text>
        )}
        <Link href="/activity" asChild><Button title="Activity" kind="quiet" onPress={() => {}} /></Link>
      </Card>
      <Card>
        <Text style={{ fontSize: 16, color: "#2B2B2B" }}>Linked wallets</Text>
        {me.wallets.filter((w) => w.status !== "revoked").length === 0 ? (
          <Text style={{ fontSize: 14, color: "#6B6558" }}>No wallet linked yet. Swaps from a linked wallet round up into your garden.</Text>
        ) : (
          me.wallets.filter((w) => w.status !== "revoked").map((w) => <Text key={w.pubkey} style={{ fontSize: 14, color: "#6B6558" }}>{formatWallet(w)}</Text>)
        )}
        <Link href="/connect" asChild><Button title={me.wallets.some((w) => w.status !== "revoked") ? "Link another wallet" : "Link a wallet"} kind="quiet" onPress={() => {}} /></Link>
      </Card>
      {me.basket ? (
        <Card>
          <Text style={{ fontSize: 16 }}>In the basket: {formatSkr(BigInt(me.basket.amountRaw), skrUsd)}, arrives {new Date(me.basket.readyAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })}</Text>
        </Card>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Link href="/rules" asChild><Button title="Rules" kind="quiet" onPress={() => {}} /></Link>
        <Link href="/withdraw" asChild><Button title="Withdraw" kind="quiet" onPress={() => {}} /></Link>
        {me.wallets.length === 0 ? (
          <Link href="/connect" asChild><Button title="Link a wallet" onPress={() => {}} /></Link>
        ) : (
          <Link href="/settings" asChild><Button title="Settings" kind="quiet" onPress={() => {}} /></Link>
        )}
      </View>
    </ScrollView>
  );
}
