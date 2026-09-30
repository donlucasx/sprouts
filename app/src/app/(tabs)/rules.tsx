import { useState } from "react";
import { Text, Switch, TextInput, View } from "react-native";
import { useMobileWallet } from "@wallet-ui/react-native-kit";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { api, ApiError, type MeResponse } from "@/lib/api";
import { useMe, useInvalidateMe } from "@/lib/me";
import { makeSigner } from "@/lib/sign";
import { freshSignIn } from "@/lib/signin";
import { freshWalletSignIn } from "@/lib/reauth";
import { identity } from "@/lib/identity";
import { formatUsd, oreShareLine } from "@/lib/format";
import { Fence } from "@/components/Fence";
import { ORE_DISCLOSURE } from "@/lib/ore-copy";
import { rulesChanges } from "@/lib/forms";
import { useSession } from "@/lib/session";

type RulesShape = MeResponse["rules"];

function Stepper({ label, value, step, min, max, format, onChange, disabled }: { label: string; value: number; step: number; min: number; max: number; format: (v: number) => string; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 16, color: "#2B2B2B" }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Button title="-" kind="quiet" disabled={disabled} onPress={() => onChange(Math.max(min, value - step))} />
        <Text style={{ fontSize: 16, minWidth: 64, textAlign: "center", color: "#2B2B2B" }}>{format(value)}</Text>
        <Button title="+" kind="quiet" disabled={disabled} onPress={() => onChange(Math.min(max, value + step))} />
      </View>
    </View>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
    <Text style={{ fontSize: 16, color: "#2B2B2B", flex: 1 }}>{label}</Text>
    {children}
  </View>
);

export default function Rules() {
  const { data: me } = useMe();
  const { session } = useSession();
  const { signTransaction } = useMobileWallet();
  const invalidate = useInvalidateMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Changes are a draft until Save (09-29: each "+" asked for its own approval, and the first tap looked like nothing happened).
  const [draft, setDraft] = useState<Partial<RulesShape>>({});
  // The watcher (spec 6): a rule in plain English becomes a proposal, set on the controls as the draft; Save is the confirmation.
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [watcher, setWatcher] = useState<{ understood: string; notes: string[] } | null>(null);
  if (!me) return <Screen><Text style={{ color: "#6B6558" }}>Loading</Text></Screen>;
  const saved = me.rules;
  const r = { ...saved, ...draft };
  const { patch, raises } = rulesChanges(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const edit = (p: Partial<RulesShape>) => setDraft((d) => ({ ...d, ...p }));

  /** Saves the whole draft at once; if it raises the daily limit, the Seeker signs in once for all of it (R84). */
  async function saveAll() {
    setBusy(true);
    setError(null);
    try {
      const reauth = raises ? await freshSignIn(freshWalletSignIn(identity)) : undefined;
      await api("/api/rules", { method: "PUT", body: { ...patch, ...(reauth ? { reauth } : {}) } });
      await invalidate();
      setDraft({});
    } catch (e) {
      // Dev builds only: the real error for Metro's terminal (09-29: a save after the sign-in failed with only the generic line).
      if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[rules] save failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      setError(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /** The typed rule to the watcher; its patch lands on the controls as the draft, so the existing Save confirms it. */
  async function askWatcher() {
    setAsking(true);
    setError(null);
    try {
      const r = await api<{ patch: Partial<RulesShape>; understood: string; notes: string[] }>("/api/watcher/compile", { method: "POST", body: { text: ask.trim() } });
      setDraft((d) => ({ ...d, ...r.patch }));
      setWatcher({ understood: r.understood, notes: r.notes });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The watcher could not read that. Use the controls below.");
    } finally {
      setAsking(false);
    }
  }

  /** Pause needs nothing; resume asks the Seeker for one fingerprint (R84). */
  async function pauseOrResume(w: MeResponse["wallets"][number]) {
    setBusy(true);
    setError(null);
    try {
      const action = w.status === "paused" ? "resume" : "pause";
      const reauth = action === "resume" ? await freshSignIn(freshWalletSignIn(identity)) : undefined;
      await api(`/api/wallets/${w.pubkey}`, { method: "POST", body: { action, ...(reauth ? { reauth } : {}) } });
      await invalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the wallet. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(wallet: string) {
    if (!session) return;
    setError(null);
    if (wallet !== session.pubkey) {
      setError("Revoke this wallet on sprouts.money/revoke with the wallet that approved it.");
      return;
    }
    setBusy(true);
    try {
      const t = await api<{ transaction: string | null }>(`/api/revoke/${wallet}`);
      if (!t.transaction) throw new ApiError(409, "Nothing to revoke.");
      const signed = await makeSigner(signTransaction)(t.transaction);
      await api(`/api/revoke/${wallet}`, { method: "POST", body: { signedTransaction: signed } });
      await invalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The revoke did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const sentence = `${r.roundupOn ? "Round up every swap to the next dollar" : "No round-up"}${r.pctOn ? `, plus ${r.pctBps / 100}% on swaps of ${formatUsd(r.pctThresholdCents)} or more` : ""}. Plant when the change reaches ${formatUsd(r.plantThresholdCents)} or after ${r.plantMaxDays} days, at most ${formatUsd(r.dailyCapCents)} a day.${r.allocation.stORE > 0 ? ` ${oreShareLine(r.allocation.stORE)}` : ""}`;

  return (
    <Screen>
      <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>Rules</Text>
      <Card>
        <Text style={{ fontSize: 16, color: "#2B2B2B" }}>Say it in your words</Text>
        <TextInput
          value={ask}
          onChangeText={setAsk}
          multiline
          maxLength={300}
          placeholder="Plant every $5, and add 1% of swaps over $50"
          placeholderTextColor="#9A9384"
          accessibilityLabel="Your rule in plain English"
          editable={!busy && !asking}
          style={{ fontSize: 16, lineHeight: 22, minHeight: 48, borderBottomWidth: 1, borderBottomColor: "#CFC8B8", paddingVertical: 8, color: "#2B2B2B" }}
        />
        <Button title={asking ? "Reading..." : "Ask the watcher"} kind="quiet" disabled={busy || asking || ask.trim() === ""} onPress={askWatcher} />
        {watcher ? <Text style={{ fontSize: 15, lineHeight: 22, color: "#2B2B2B" }}>{[watcher.understood, ...watcher.notes].join(" ")}</Text> : null}
        <Text style={{ fontSize: 13, color: "#6B6558" }}>The watcher sets the controls below. Nothing changes until you save.</Text>
      </Card>
      <Card>
        <Row label="Round up to the next dollar"><Switch value={r.roundupOn} disabled={busy} onValueChange={(v) => edit({ roundupOn: v })} /></Row>
        <Row label={`1% on swaps of ${formatUsd(r.pctThresholdCents)} or more`}><Switch value={r.pctOn} disabled={busy} onValueChange={(v) => edit({ pctOn: v })} /></Row>
        <Stepper label="Daily limit" value={r.dailyCapCents} step={100} min={100} max={2000} format={formatUsd} disabled={busy} onChange={(v) => edit({ dailyCapCents: v })} />
        <Stepper label="Plant at" value={r.plantThresholdCents} step={50} min={50} max={2000} format={formatUsd} disabled={busy} onChange={(v) => edit({ plantThresholdCents: v })} />
        {/* The garden split (R92): the fence. Saved with the rest; never a raise, so never a sign-in. */}
        <View style={{ gap: 6, marginTop: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 16, color: "#2B2B2B" }}>Garden split</Text>
            <Text style={{ fontSize: 16, color: "#2B2B2B" }}>SKR {r.allocation.SKR} · ORE {r.allocation.stORE}</Text>
          </View>
          <Fence share={r.allocation.stORE} disabled={busy} onChange={(v) => edit({ allocation: { SKR: 100 - v, stORE: v } })} />
          <Text style={{ fontSize: 13, color: "#6B6558" }}>{oreShareLine(r.allocation.stORE)}</Text>
          {r.allocation.stORE > 0 && saved.allocation.stORE === 0 ? <Text style={{ fontSize: 13, lineHeight: 19, color: "#6B6558" }}>{ORE_DISCLOSURE}</Text> : null}
        </View>
        {dirty ? (
          <>
            <Text style={{ fontSize: 13, color: "#6B6558" }}>{raises ? "Saving asks your Seeker to sign in once, because it raises the daily limit." : "Nothing to sign for these changes."}</Text>
            <Button title={busy ? "Saving..." : "Save changes"} disabled={busy} onPress={saveAll} />
            <Button title="Discard" kind="quiet" disabled={busy} onPress={() => setDraft({})} />
          </>
        ) : (
          <Text style={{ fontSize: 13, color: "#6B6558" }}>Change what you like, then save. Raising the daily limit asks your Seeker to sign in once.</Text>
        )}
      </Card>
      <Card><Text style={{ fontSize: 15, lineHeight: 22, color: "#2B2B2B" }}>{sentence}</Text></Card>
      <Card>
        <Text style={{ fontSize: 17, fontWeight: "600", color: "#2B2B2B" }}>Linked wallets</Text>
        {me.wallets.length === 0 ? <Text style={{ fontSize: 14, color: "#6B6558" }}>No wallet linked yet.</Text> : null}
        {me.wallets.map((w) => (
          <View key={w.pubkey} style={{ gap: 6, paddingVertical: 6 }}>
            <Text style={{ fontSize: 14, color: "#2B2B2B" }}>{w.pubkey.slice(0, 4)}...{w.pubkey.slice(-4)}, {w.status}, limit {formatUsd(w.dailyCapCents)} a day</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {w.status !== "revoked" ? <Button title={w.status === "paused" ? "Resume" : "Pause"} kind="quiet" disabled={busy} onPress={() => pauseOrResume(w)} /> : null}
              {w.status !== "revoked" ? <Button title="Revoke" kind="danger" disabled={busy} onPress={() => revoke(w.pubkey)} /> : null}
            </View>
          </View>
        ))}
        <Text style={{ fontSize: 13, color: "#6B6558" }}>{"Revoke removes Sprouts' authority on chain and leaves the wallet with no delegate. Nothing in your garden moves."}</Text>
      </Card>
      {error ? <Text style={{ color: "#8C2F2F" }}>{error}</Text> : null}
    </Screen>
  );
}
