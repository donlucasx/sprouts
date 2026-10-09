import { useState } from 'react'
import { Appearance, AppState, Switch, View } from 'react-native'
import { Link, router } from 'expo-router'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { ProBadge } from '@/components/ProBadge'
import { PRO_LINE } from '@/model/manager'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Disclosure } from '@/components/Disclosure'
import { TwoWay } from '@/components/TwoWay'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { useMe, store, useInvalidateMe } from '@/lib/me'
import { refreshWidget } from '@/lib/widget-refresh'
import { unregisterBackgroundRefresh } from '@/lib/background'
import { useSession } from '@/lib/session'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { formatWallet, HOLDINGS_NOTE } from '@/lib/format'
import { makeSigner, SignRefused } from '@/lib/sign'
import { DROPPED_NOTHING_SENT, isSessionDropped } from '@/lib/wallet-errors'
import { freshSignIn } from '@/lib/signin'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { readAppearance, writeAppearance, readNotify, writeNotify } from '@/lib/prefs'
import type { NoticeKind } from '@/lib/notices'
import { DISCLOSURES, HOW_IT_WORKS, NOT_ADVICE } from '@/lib/settings-copy'
import { clearTaxFiles, prepareTaxCsv, shareTaxCsv, taxFileFresh, type TaxFile } from '@/lib/tax-export'
import { notify } from '@/lib/notify'
import { PUBLIC_GUARANTEE } from '@/lib/relink'
import { spacing, switchColors, useTheme } from '@/theme'
import { schemeFor, type Appearance as AppearanceChoice } from '@/theme/appearance'

/** R161: each notice and its switch's words, in the order they show. */
const NOTICES: [NoticeKind, string][] = [
  ['plantings', 'Tell me when my change is planted'],
  ['withdrawals', 'Tell me when a withdrawal arrives'],
  ['manager', 'Tell me when the manager moves my split'],
  ['limit', 'Tell me when the daily limit is reached'],
]

export default function Settings() {
  const [taxBusy, setTaxBusy] = useState(false)
  const [taxFile, setTaxFile] = useState<TaxFile | null>(null)
  const [proNote, setProNote] = useState(false)
  const [taxError, setTaxError] = useState<string | null>(null)
  const { data: me } = useMe()
  const { session, setSession } = useSession()
  // The kit's cached wallet authorization goes with the session: a stale token is declined by Solflare (-1) on the next sign-in or transaction (10-01).
  const { disconnect } = useMobileWallet()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const { colors } = useTheme()
  const toggle = switchColors(colors)
  const [appearance, setAppearanceState] = useState<AppearanceChoice>(() => readAppearance())
  const [notifyOn, setNotifyOn] = useState(() => Object.fromEntries(NOTICES.map(([k]) => [k, readNotify(k)])) as Record<NoticeKind, boolean>)
  const { signTransaction } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [walletBusy, setWalletBusy] = useState(false)
  const [signing, setSigning] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)

  /** R153: the choice is saved, applied to the phone's scheme at once (the theme and the native controls follow), and shown. */
  function setAppearance(a: AppearanceChoice) {
    writeAppearance(a)
    Appearance.setColorScheme(schemeFor(a))
    setAppearanceState(a)
  }

  /** Pause needs nothing; resume asks the Seeker for one fingerprint (R84). Moved from Rules (his note 5). */
  async function pauseOrResume(w: MeResponse['wallets'][number]) {
    setWalletBusy(true)
    setWalletError(null)
    try {
      const action = w.status === 'paused' ? 'resume' : 'pause'
      setSigning(action === 'resume')
      const reauth = action === 'resume' ? await freshSignIn(freshWalletSignIn(identity)) : undefined
      await api(`/api/wallets/${w.pubkey}`, { method: 'POST', body: { action, ...(reauth ? { reauth } : {}) } })
      await invalidate()
    } catch (e) {
      setWalletError(e instanceof ApiError ? e.message : 'Could not change the wallet. Try again.')
    } finally {
      setWalletBusy(false)
      setSigning(false)
    }
  }

  async function revoke(wallet: string) {
    if (!session) return
    setWalletError(null)
    if (wallet !== session.pubkey) {
      setWalletError('Revoke this wallet on sprouts.money/revoke with the wallet that approved it.')
      return
    }
    setWalletBusy(true)
    setSigning(true)
    try {
      const t = await api<{ transaction: string | null }>(`/api/revoke/${wallet}`)
      if (!t.transaction) throw new ApiError(409, 'Nothing to revoke.')
      const signed = await makeSigner(signTransaction, { kind: 'revoke', user: wallet })(t.transaction)
      await api(`/api/revoke/${wallet}`, { method: 'POST', body: { signedTransaction: signed } })
      await invalidate()
    } catch (e) {
      setWalletError(e instanceof ApiError || e instanceof SignRefused ? e.message : isSessionDropped(e) ? DROPPED_NOTHING_SENT : 'The revoke did not go through. Try again.')
    } finally {
      setWalletBusy(false)
      setSigning(false)
    }
  }

  /**
   * Ends this device's session on the server (best effort) and forgets everything here: the session, the last verified garden,
   * the widget's picture, the background polling and the query cache (review I4). "Everywhere" ends every device's session (R84).
   */
  async function signOut(everywhere: boolean) {
    setBusy(true)
    try {
      await api(everywhere ? '/api/auth/signout-all' : '/api/auth/signout', { method: 'POST', body: {} }).catch(
        () => {},
      )
    } finally {
      await setSession(null)
      store.remove('me.last')
      clearTaxFiles()
      queryClient.clear()
      await disconnect().catch(() => {})
      await Promise.all([refreshWidget(null).catch(() => {}), unregisterBackgroundRefresh().catch(() => {})])
      setBusy(false)
      router.replace('/')
    }
  }

  return (
    <Screen inset="top" title="Settings">
      <Card>
        {/* R462: the wallet that signs in is the Seed Vault */}
        <ThemedText variant="heading">Your Seed Vault</ThemedText>
        <ThemedText numeric>
          {me?.user.skrName ?? (session ? `${session.pubkey.slice(0, 4)}...${session.pubkey.slice(-4)}` : '')}
        </ThemedText>
        {/* R150: the holdings note moved here from Home (both audits): where the wallet coins sit, said once. */}
        {/* His note 10-08: one small caption under the address, so the address leads */}
        <ThemedText variant="caption" tone="secondary">
          {`Where your savings live. Only you can move them. ${HOLDINGS_NOTE}`}
        </ThemedText>
      </Card>
      <Card>
        {/* R446: one Pro bundle (the Yield Manager, automatic lending, tax reports), free during launch; R457: Add money is coming.
            R464: near the top, under the Seed Vault, with a greyed "Get Pro" that explains itself on a tap */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ThemedText variant="heading">Sprouts Pro</ThemedText>
          <ProBadge />
        </View>
        <ThemedText>Your money works by itself.</ThemedText>
        {['The AI Yield Manager splits new change each morning', 'Automatic lending at the best safe rate', 'Tax reports'].map((l) => (
          <ThemedText key={l} tone="secondary">
            {`\u2022 ${l}`}
          </ThemedText>
        ))}
        <Button
          title="Get Pro"
          kind="quiet"
          onPress={() => setProNote((v) => !v)}
          accessibilityLabel="Get Pro, not needed during launch"
          style={{ alignSelf: 'flex-start', opacity: 0.45 }}
        />
        {proNote ? (
          <ThemedText variant="caption" tone="secondary">
            {PRO_LINE} Nothing to buy yet: every Pro feature is already on.
          </ThemedText>
        ) : null}
        <ThemedText variant="caption" tone="secondary">
          Coming soon: add money to your garden anytime.
        </ThemedText>
      </Card>
      <Card>
        <ThemedText variant="heading">Linked wallets</ThemedText>
        {me && me.wallets.length === 0 ? <ThemedText tone="secondary">No wallet linked yet.</ThemedText> : null}
        {me?.wallets.map((w) => (
          <View key={w.pubkey} style={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
            <ThemedText numeric>{formatWallet(w)}</ThemedText>
            {w.status !== 'revoked' ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title={w.status === 'paused' ? 'Resume' : 'Pause'} accessibilityLabel={`${w.status === 'paused' ? 'Resume' : 'Pause'} wallet ${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}`} kind="quiet" loading={walletBusy} onPress={() => pauseOrResume(w)} />
                <Button title="Revoke" accessibilityLabel={`Revoke wallet ${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}`} kind="danger" loading={walletBusy} onPress={() => revoke(w.pubkey)} />
              </View>
            ) : null}
          </View>
        ))}
        <ThemedText variant="caption" tone="secondary">
          {"Revoke ends Sprouts' approval on chain. Nothing in your garden moves."}
        </ThemedText>
        {signing ? (
          <ThemedText variant="caption" tone="secondary">
            Waiting for your wallet.
          </ThemedText>
        ) : null}
        {walletError ? <ThemedText tone="error">{walletError}</ThemedText> : null}
        <Link href="/connect" asChild>
          <Button title="Link a wallet" kind="quiet" onPress={() => {}} style={{ alignSelf: 'flex-start' }} />
        </Link>
      </Card>
      <Card>
        <ThemedText variant="heading">Appearance</ThemedText>
        <TwoWay
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={appearance}
          onChange={setAppearance}
        />
      </Card>
      <Card>
        {/* R160 and R161: the notices grouped under their own heading, one switch each. */}
        <ThemedText variant="heading">Notifications</ThemedText>
        {NOTICES.map(([kind, label]) => (
          <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs }}>
            {/* The switch carries the label; the text is hidden from the screen reader so it is not read twice. */}
            <ThemedText style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
              {label}
            </ThemedText>
            <Switch
              {...toggle}
              value={notifyOn[kind]}
              onValueChange={(on) => {
                writeNotify(kind, on)
                setNotifyOn((s) => ({ ...s, [kind]: on }))
              }}
              accessibilityLabel={label}
            />
          </View>
        ))}
      </Card>
      <Card>
        {/* R447 + R476: Tax reports, Pro (free during launch). R463: request it, the phone says when it is ready,
            then download; the whole history, no year button */}
        {/* His note 10-08: "Tax reports", with the Pro pill the Yield Manager carries */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ThemedText variant="heading">Tax reports</ThemedText>
          <ProBadge />
        </View>
        <ThemedText tone="secondary">Every planting and withdrawal, for your tax tool.</ThemedText>
        <Button
          title={taxFileFresh(taxFile) ? 'Download' : 'Request history'}
          kind="quiet"
          loading={taxBusy}
          onPress={async () => {
            setTaxBusy(true)
            setTaxError(null)
            try {
              if (taxFileFresh(taxFile)) {
                await shareTaxCsv(taxFile)
              } else {
                setTaxFile(await prepareTaxCsv())
                // The notice is for someone who left the app while it was prepared; on screen the button turning to Download says it
                if (AppState.currentState !== 'active') await notify('Your tax report is ready', 'Open Settings to download it.').catch(() => {})
              }
            } catch (e) {
              setTaxError(e instanceof ApiError ? e.message : 'Could not prepare it just now. Try again.')
            } finally {
              setTaxBusy(false)
            }
          }}
          style={{ alignSelf: 'flex-start' }}
        />
        {taxFileFresh(taxFile) ? (
          <ThemedText variant="caption" tone="secondary">
            Ready: {taxFile.filename}
          </ThemedText>
        ) : null}
        {taxError ? <ThemedText tone="error">{taxError}</ThemedText> : null}
      </Card>
      <Card style={{ gap: 0 }}>
        {/* R145 and R153: the disclosures as rows that open in place, grouped as About at the end; R300's promise above them, the precise rule inside. */}
        <ThemedText variant="heading">About Sprouts</ThemedText>
        <ThemedText variant="caption" tone="secondary" style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>
          {PUBLIC_GUARANTEE}
        </ThemedText>
        {/* R452: three lines on how it works before the questions */}
        <ThemedText style={{ marginBottom: spacing.sm }}>{HOW_IT_WORKS}</ThemedText>
        {DISCLOSURES.map(([h, p], i) => (
          <Disclosure key={h} title={h} first={i === 0}>
            {p}
          </Disclosure>
        ))}
        <ThemedText variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
          {NOT_ADVICE}
        </ThemedText>
      </Card>
      <Button title="Terms and Privacy" kind="quiet" onPress={() => router.push('/terms')} />
      <Button title="Sign out" kind="quiet" disabled={busy} onPress={() => signOut(false)} />
      <Button title="Sign out of all devices" kind="quiet" disabled={busy} onPress={() => signOut(true)} />
      <ThemedText variant="caption" tone="secondary">
        Sprouts, built for CLOCK IN. Code: github.com/donlucasx/sprouts
      </ThemedText>
    </Screen>
  )
}
