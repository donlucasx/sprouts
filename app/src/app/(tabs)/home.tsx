import { useCallback, useMemo, useState } from "react";
import { Text, View, RefreshControl, ScrollView } from "react-native";
import { Link, Redirect, useFocusEffect } from "expo-router";
import { useMe, useInvalidateMe, toGardenInput } from "@/lib/me";
import { api } from "@/lib/api";
import { buildScene } from "@/model/garden";
import { watcherLine } from "@/model/watcher";
import { Garden } from "@/garden/Garden";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { WatcherLine } from "@/components/WatcherLine";
import { WaterButton } from "@/components/WaterButton";
import { formatUsd, formatSkr, formatStore, formatAmount, formatAsOf, formatWallet } from "@/lib/format";
import { useSession } from "@/lib/session";
import { noPlantingLine } from "@/lib/me-state";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function Home() {
  const { setSession } = useSession();
  const { data: me, stale, refetch, asOf, loading, unauthorized } = useMe();
  const invalidate = useInvalidateMe();
  const [justOpened, setJustOpened] = useState<Set<string>>(new Set());
  const [watering, setWatering] = useState(false);
  const [failed, setFailed] = useState(false);
  const now = new Date();
  const today = now.toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is taken once per render on purpose; the scene follows the local date
  const scene = useMemo(() => (me ? buildScene(toGardenInput(me, now)) : null), [me, today]);
  // Coming back to Home reads again: a wallet linked on the web, a planting, a withdrawal show without a pull-down. Leaving it
  // ends the "Opened" line and forgets a failed tap (audits/watering-ux, finding 10).
  useFocusEffect(useCallback(() => {
    void refetch();
    return () => {
      setJustOpened(new Set());
      setFailed(false);
    };
  }, [refetch]));

  /**
   * The reveal (R55): the API records the moment, the fresh read opens the buds, then each one blooms in. The state comes from
   * the read, never from the tap. A failed tap says so instead of nothing (finding 8).
   */
  async function water() {
    if (!me || !scene) return;
    setFailed(false);
    setWatering(true);
    const opening = new Set(scene.parts.filter((p) => p.kind === "sprout" && p.bud).map((p) => (p as { id: string }).id));
    try {
      await api("/api/water", { method: "POST", body: {} });
      await invalidate();
      setJustOpened(opening);
    } catch {
      setFailed(true);
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
  // R96: the line and the can decided together, so they always agree; the can is there only while a bud waits.
  const watcher = watcherLine({
    unrevealed: scene.unrevealed,
    hasPlant: scene.parts.some((p) => p.kind === "plant"),
    neverWatered: me.user.wateredAt === null,
    pendingCents: me.nextPlanting.pendingCents,
    thresholdCents: me.nextPlanting.thresholdCents,
    watering,
    opened: justOpened.size,
    failed,
  });
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
      <WatcherLine text={watcher.line} />
      {watcher.button ? (
        <View style={{ gap: 8 }}>
          <WaterButton label={watcher.button} busy={watering} onPress={water} />
          {watcher.note ? <Text style={{ fontSize: 13, lineHeight: 19, color: "#6B6558" }}>{watcher.note}</Text> : null}
        </View>
      ) : null}
      <Card>
        <Text style={{ fontSize: 15, color: "#6B6558" }}>In your garden, locked to your Seeker</Text>
        <Text style={{ fontSize: 28, fontWeight: "600", color: "#2B2B2B" }}>{formatSkr(BigInt(me.pot.skrStakedRaw), skrUsd)}</Text>
        <Text style={{ fontSize: 16, color: "#2B2B2B" }}>Put in {formatSkr(BigInt(me.pot.skrPutInRaw), skrUsd)}. Earned {formatSkr(BigInt(me.pot.skrEarnedRaw), skrUsd)}.</Text>
        {BigInt(me.pot.storeRaw) > 0n ? (
          <Text style={{ fontSize: 14, color: "#2B2B2B" }}>ORE: {formatStore(BigInt(me.pot.storeRaw), me.pot.storeUsd)}, in your Seeker wallet, not locked. Sprouts cannot sell it for you.</Text>
        ) : null}
        {stale && asOf ? (
          <Text style={{ fontSize: 13, color: "#8C2F2F" }}>{formatAsOf(asOf, now)}, the chain could not be read just now.</Text>
        ) : asOf ? (
          <Text style={{ fontSize: 13, color: "#6B6558" }}>{formatAsOf(asOf, now)}</Text>
        ) : null}
        <Link href="/withdraw" asChild><Button title="Withdraw" kind="quiet" onPress={() => {}} /></Link>
      </Card>
      <Card>
        <Text style={{ fontSize: 16, color: "#2B2B2B" }}>Next planting: {formatUsd(me.nextPlanting.pendingCents)} of {formatUsd(me.nextPlanting.thresholdCents)}{me.nextPlanting.asset === "stORE" ? ", grows ORE" : ""}</Text>
        {me.lastReceipt ? (
          <Text style={{ fontSize: 14, color: "#6B6558" }}>
            Last planting {shortDate(me.lastReceipt.ts)}: {formatUsd(me.lastReceipt.usdcPulledCents)} pulled, {formatAmount(me.lastReceipt.asset, BigInt(me.lastReceipt.amountOutRaw), me.lastReceipt.asset === "SKR" ? skrUsd : me.pot.storeUsd)} planted, network fee {formatUsd(me.lastReceipt.networkFeeCents)}
          </Text>
        ) : (
          <Text style={{ fontSize: 14, color: "#6B6558" }}>{noPlantingLine(me)}</Text>
        )}
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
    </ScrollView>
  );
}
