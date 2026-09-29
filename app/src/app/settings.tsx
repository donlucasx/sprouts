import { useState } from "react";
import { Text, View } from "react-native";
import { Link, router } from "expo-router";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe, store } from "@/lib/me";
import { refreshWidget } from "@/lib/widget-refresh";
import { unregisterBackgroundRefresh } from "@/lib/background";
import { useSession } from "@/lib/session";
import { formatUsd } from "@/lib/format";

const P = ({ children }: { children: string }) => <Text style={{ fontSize: 14, lineHeight: 21, color: "#2B2B2B" }}>{children}</Text>;
const H = ({ children }: { children: string }) => <Text style={{ fontSize: 15, fontWeight: "600", color: "#2B2B2B", marginTop: 6 }}>{children}</Text>;

/** The disclosures, verbatim (spec 3.5 and 9; R60; RECONCILED rules 10 to 12; R81 the remainder; R84 the sessions). */
const DISCLOSURES: [string, string][] = [
  ["How Sprouts holds your money.", "It does not. Your SKR is staked in Solana Mobile's staking program under your Seeker's key; only that key can unstake it, with your fingerprint. Your linked wallets grant Sprouts' puller key an allowance of at most your daily limit in USDC, revocable on chain at any time. The puller holds your change for one transaction: pull, swap, stake. It keeps nothing beyond the disclosed fee and the slippage remainder. Sprouts pays the rent of your staking position, about $0.25, on your first planting."],
  ["What \"earned\" means.", "Rewards are paid by the staking program every two days into the share price. Sprouts draws what the program shows and nothing else; a fruit is earned SKR since you joined, in SKR, with today's dollar value beside it. The dollar value of your garden moves with the price of SKR and can be lower than what you put in."],
  ["Fees.", "Sprouts takes 0.5% of the SKR bought at each planting, inside the swap, and passes through the network fee (about $0.03). The remainder of a swap's slippage (cents) stays with Sprouts. Both are on every receipt."],
  ["Signed in.", "Signing in keeps you signed in for seven days on this phone; sign out ends it at once. Raising your daily limit or resuming a wallet asks your Seeker for a fresh fingerprint."],
  ["Not advice.", "Sprouts is not tax advice and not investment advice. It never sets or changes an amount without your confirmation. The tax export is a record, not a filing."],
];

export default function Settings() {
  const { data: me } = useMe();
  const { session, setSession } = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  /**
   * Ends this device's session on the server (best effort) and forgets everything here: the session, the last verified garden,
   * the widget's picture, the background polling and the query cache (review I4). "Everywhere" ends every device's session (R84).
   */
  async function signOut(everywhere: boolean) {
    setBusy(true);
    try {
      await api(everywhere ? "/api/auth/signout-all" : "/api/auth/signout", { method: "POST", body: {} }).catch(() => {});
    } finally {
      await setSession(null);
      store.remove("me.last");
      queryClient.clear();
      await Promise.all([refreshWidget(null).catch(() => {}), unregisterBackgroundRefresh().catch(() => {})]);
      setBusy(false);
      router.replace("/");
    }
  }

  return (
    <Screen>
      <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>Settings</Text>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Your Seeker</Text>
        <P>{me?.user.skrName ?? (session ? `${session.pubkey.slice(0, 4)}...${session.pubkey.slice(-4)}` : "")}</P>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B", marginTop: 8 }}>Linked wallets</Text>
        {me && me.wallets.length === 0 ? <P>No wallet linked yet.</P> : null}
        {me?.wallets.map((w) => <P key={w.pubkey}>{`${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}, ${w.status}, limit ${formatUsd(w.dailyCapCents)} a day`}</P>)}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <Link href="/connect" asChild><Button title="Link a wallet" kind="quiet" onPress={() => {}} /></Link>
          <Link href="/rules" asChild><Button title="Rules" kind="quiet" onPress={() => {}} /></Link>
          <Link href="/activity" asChild><Button title="Activity" kind="quiet" onPress={() => {}} /></Link>
        </View>
      </Card>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Export for taxes</Text>
        <P>{"Coming in this build's next update."}</P>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B", marginTop: 8 }}>Pro</Text>
        <P>{"Coming in this build's next update."}</P>
      </Card>
      <Card>
        {DISCLOSURES.map(([h, p]) => (
          <View key={h}>
            <H>{h}</H>
            <P>{p}</P>
          </View>
        ))}
      </Card>
      <Button title="Sign out" kind="quiet" disabled={busy} onPress={() => signOut(false)} />
      <Button title="Sign out of all devices" kind="quiet" disabled={busy} onPress={() => signOut(true)} />
      <Text style={{ fontSize: 12, color: "#6B6558" }}>Sprouts, built for CLOCK IN. Code: github.com/donlucasx/sprouts</Text>
    </Screen>
  );
}
