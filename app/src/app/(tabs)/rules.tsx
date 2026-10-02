import { useState } from "react";
import { Text, Switch, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
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
import { formatUsd, COIN_NAME } from "@/lib/format";
import { TwoWay } from "@/components/TwoWay";
import { undoSplit } from "@/lib/manager-api";
import { splitRows, togglePin, stepPin, pinsForOn, managerSentence, undoLine, SWITCH_LABEL, OFF_TEXT, ON_TEXT, STOP_LINE, UNDONE_TEXT, STORE_ROW_NOTE, canStepUp } from "@/model/manager";
import { ORE_DISCLOSURE } from "@/lib/ore-copy";
import { rulesChanges } from "@/lib/forms";
import { useSession } from "@/lib/session";

type RulesShape = MeResponse["rules"];

// D5: the text-to-controls box is hidden; it still compiles and its compile route still answers.
const SHOW_BOX = false as boolean;

const INK = "#2B2B2B";
const MUTED = "#6B6558";
const muted: TextStyle = { fontSize: 13, color: MUTED };
const sectionLabel: TextStyle = { fontSize: 16, color: INK, marginTop: 4 };
const splitRow: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 };
const coin: TextStyle = { flex: 1, fontSize: 15, color: INK };
const pct: TextStyle = { width: 48, textAlign: "right", fontSize: 15, color: INK, fontVariant: ["tabular-nums"] };
const stepper: ViewStyle = { flexDirection: "row", gap: 4 };
const why: TextStyle = { fontSize: 15, lineHeight: 22, color: INK, marginTop: 8 };
const undoRow: ViewStyle = { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 };

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
  const [undone, setUndone] = useState(false);
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
  const edit = (p: Partial<RulesShape>) => {
    setUndone(false);
    setDraft((d) => ({ ...d, ...p }));
  };
  // The ORE disclosure shows inline once: the first time the manager is switched on, or, off, the first time stORE's pin leaves zero (spec 3.1).
  // F1: switched on but not yet saved, the saved allocation is still the OFF one; the rows preview the stop's split instead.
  const unsavedOn = r.managed && !saved.managed;
  const showDisclosure = (r.managed && !saved.managed) || (!r.managed && (r.pins.stORE ?? 0) > 0 && (saved.pins.stORE ?? 0) === 0);

  /** Saves the whole draft at once; if it raises the daily limit, the Seeker signs in once for all of it (R84). */
  async function saveAll() {
    setUndone(false);
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

  /** The one-tap undo (spec 4.5): yesterday's split back and the manager off; no sign-in. */
  async function undo() {
    setBusy(true);
    setError(null);
    try {
      await undoSplit();
      await invalidate();
      setDraft({});
      setUndone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not undo. Try again.");
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

  const sentence = `${r.roundupOn ? "Round up every swap to the next dollar" : "No round-up"}${r.pctOn ? `, plus ${r.pctBps / 100}% on swaps of ${formatUsd(r.pctThresholdCents)} or more` : ""}. Plant when the change reaches ${formatUsd(r.plantThresholdCents)} or after ${r.plantMaxDays} days, at most ${formatUsd(r.dailyCapCents)} a day.${managerSentence(r)}`;

  return (
    <Screen>
      <Text style={{ fontSize: 24, color: "#2F5D3A", fontStyle: "italic", fontFamily: "serif" }}>Rules</Text>
      {SHOW_BOX && (
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
      )}
      <Card>
        <Row label="Round up to the next dollar"><Switch value={r.roundupOn} disabled={busy} onValueChange={(v) => edit({ roundupOn: v })} /></Row>
        <Row label={`1% on swaps of ${formatUsd(r.pctThresholdCents)} or more`}><Switch value={r.pctOn} disabled={busy} onValueChange={(v) => edit({ pctOn: v })} /></Row>
        <Stepper label="Daily limit" value={r.dailyCapCents} step={100} min={100} max={500} format={formatUsd} disabled={busy} onChange={(v) => edit({ dailyCapCents: v })} />
        <Stepper label="Plant at" value={r.plantThresholdCents} step={50} min={50} max={2000} format={formatUsd} disabled={busy} onChange={(v) => edit({ plantThresholdCents: v })} />
      </Card>
      <Card>
        <Row label={SWITCH_LABEL}>
          <Switch value={r.managed} onValueChange={(v) => edit(v ? { managed: true, pins: pinsForOn(r.pins) } : { managed: false })} disabled={busy} />
        </Row>
        <Text style={muted}>{r.managed ? ON_TEXT : OFF_TEXT}</Text>
        {r.managed && (
          <>
            <TwoWay
              options={[{ value: "careful", label: "Careful" }, { value: "balanced", label: "Balanced" }, { value: "bold", label: "Bold" }]}
              value={r.stop}
              onChange={(v) => edit({ stop: v })}
            />
            <Text style={muted}>{STOP_LINE}</Text>
          </>
        )}
        <Text style={sectionLabel}>{saved.managed ? "Today's split" : r.managed ? "The split after you save" : "Your split"}</Text>
        {splitRows(r, unsavedOn ? me.manager.stopSplit : undefined).map((row) => (
          <View key={row.asset} style={splitRow}>
            <Text style={coin}>{COIN_NAME[row.asset]}{row.asset === "stORE" ? `, ${STORE_ROW_NOTE}` : ""}</Text>
            <Text style={pct}>{row.pct}%</Text>
            <Text style={muted}>{row.mode}{row.bound ? ` (${row.bound})` : ""}</Text>
            {r.managed && (
              <Switch
                accessibilityLabel={`Pin ${COIN_NAME[row.asset]}`}
                value={row.mode === "pinned"}
                onValueChange={(on) => edit({ pins: togglePin(r.pins, row.asset, on, row.pct) })}
                disabled={busy}
              />
            )}
            {row.mode === "pinned" && (
              <View style={stepper}>
                <Button title="-" kind="quiet" disabled={busy || row.pct <= 0} onPress={() => edit({ pins: stepPin(r.pins, row.asset, -1) })} />
                <Button title="+" kind="quiet" disabled={busy || !canStepUp(r, row.asset)} onPress={() => edit({ pins: stepPin(r.pins, row.asset, 1) })} />
              </View>
            )}
          </View>
        ))}
        {saved.managed && me.manager.why ? <Text style={why}>{me.manager.why}</Text> : null}
        {undone ? <Text style={muted}>{UNDONE_TEXT}</Text> : null}
        {!undone && me.manager.undoAvailable && undoLine(me.manager.changedDay) ? (
          <View style={undoRow}>
            <Text style={muted}>{undoLine(me.manager.changedDay)}</Text>
            <Button title={busy ? "Undoing..." : "Undo"} kind="quiet" disabled={busy} onPress={undo} />
          </View>
        ) : null}
        {showDisclosure ? <Text style={{ ...muted, lineHeight: 19 }}>{ORE_DISCLOSURE}</Text> : null}
      </Card>
      {/* The save and its reason sit under the last control (audit fix F5). */}
      <View style={{ gap: 6 }}>
        {dirty ? (
          <>
            <Text style={{ fontSize: 13, color: "#6B6558" }}>{raises ? "Saving asks your Seeker to sign in once, because it raises the daily limit." : "Nothing to sign for these changes."}</Text>
            <Button title={busy ? "Saving..." : "Save changes"} disabled={busy} onPress={saveAll} />
            <Button title="Discard" kind="quiet" disabled={busy} onPress={() => setDraft({})} />
          </>
        ) : (
          <Text style={{ fontSize: 13, color: "#6B6558" }}>Change what you like, then save. Raising the daily limit asks your Seeker to sign in once.</Text>
        )}
        {error ? <Text style={{ color: "#8C2F2F" }}>{error}</Text> : null}
      </View>
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
    </Screen>
  );
}
