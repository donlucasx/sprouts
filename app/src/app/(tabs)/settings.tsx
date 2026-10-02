import { useState } from 'react'
import { Appearance, Switch, View } from 'react-native'
import { Link, router } from 'expo-router'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
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
import { makeSigner } from '@/lib/sign'
import { freshSignIn } from '@/lib/signin'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { readAppearance, writeAppearance, readNotify, writeNotify } from '@/lib/prefs'
import type { NoticeKind } from '@/lib/notices'
import { ORE_DISCLOSURE } from '@/lib/ore-copy'
import { spacing, switchColors, useTheme } from '@/theme'
import { schemeFor, type Appearance as AppearanceChoice } from '@/theme/appearance'

/** The disclosures, verbatim (spec 3.5 and 9; R60; RECONCILED rules 10 to 12; R81 the remainder; R84 the sessions): the safety story the judges read. */
/** R161: each notice and its switch's words, in the order they show. */
const NOTICES: [NoticeKind, string][] = [
  ['plantings', 'Tell me when a planting lands'],
  ['withdrawals', 'Tell me when a withdrawal arrives'],
  ['manager', 'Tell me when the manager moves my split'],
  ['limit', 'Tell me when the daily limit is reached'],
]

const DISCLOSURES: [string, string][] = [
  [
    'How Sprouts holds your money',
    "It does not. Your SKR is staked in Solana Mobile's staking program under your Seeker's key; only that key can unstake it, with your fingerprint. Your linked wallets grant Sprouts' puller key an allowance of at most your daily limit in USDC, revocable on chain at any time. The puller holds your change for one transaction: pull, swap, plant. It keeps nothing beyond the disclosed fee and the slippage remainder. Sprouts pays the rent of your staking position, about $0.25, on your first planting.",
  ],
  [
    'What "earned" means',
    "Rewards are paid by the staking program every two days into the share price. Sprouts draws what the program shows and nothing else; a fruit is earned SKR since you joined, in SKR, with today's dollar value beside it. The dollar value of your garden moves with the price of SKR and can be lower than what you put in.",
  ],
  ['Watering', 'Watering moves no money and signs nothing. It opens new growth on the screen.'],
  [
    'Fees',
    "Sprouts takes 0.5% of each planting, in USDC, inside the swap, and passes through the network fee (about $0.03). The remainder of a swap's slippage (cents) stays with Sprouts. Both are on every receipt.",
  ],
  [
    'Signed in',
    'Signing in keeps you signed in for seven days on this phone; sign out ends it at once. Raising your daily limit or resuming a wallet asks your Seeker for a fresh fingerprint.',
  ],
  ['ORE, if you choose it', ORE_DISCLOSURE],
  [
    'Coins the Yield Manager can buy',
    "hSOL, JitoSOL and JupSOL are SOL staked with Helius, Jito and Jupiter; their value moves with SOL. cbBTC is bitcoin held by Coinbase; its value moves with bitcoin. All four sit in your Seeker wallet, not locked, and you can move them from any Solana wallet; Sprouts cannot sell or withdraw them for you, and pays each coin's one-time account rent. The list is fixed in code; nothing else can be bought.",
  ],
  [
    'Not advice',
    'Sprouts is not tax advice and not investment advice. The Yield Manager, if you turn it on, chooses how new round-ups are split across six coins inside limits you set and limits in code. It never sets the amount, never sells anything you hold, and every change it makes shows in Activity with an undo. The tax export is a record, not a filing.',
  ],
]

export default function Settings() {
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
      const signed = await makeSigner(signTransaction)(t.transaction)
      await api(`/api/revoke/${wallet}`, { method: 'POST', body: { signedTransaction: signed } })
      await invalidate()
    } catch (e) {
      setWalletError(e instanceof ApiError ? e.message : 'The revoke did not go through. Try again.')
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
        <ThemedText variant="heading">Your Seeker</ThemedText>
        <ThemedText numeric>
          {me?.user.skrName ?? (session ? `${session.pubkey.slice(0, 4)}...${session.pubkey.slice(-4)}` : '')}
        </ThemedText>
        {/* R150: the holdings note moved here from Home (both audits): where the wallet coins sit, said once. */}
        <ThemedText variant="caption" tone="secondary">
          {HOLDINGS_NOTE}
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
            Waiting for your Seeker.
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
        <ThemedText variant="heading">Export for taxes</ThemedText>
        <ThemedText tone="secondary">Coming soon.</ThemedText>
      </Card>
      <Card style={{ gap: 0 }}>
        {/* R145 and R153: the eight disclosures as rows that open in place, grouped as About at the end. */}
        <ThemedText variant="heading" style={{ marginBottom: spacing.sm }}>
          About Sprouts
        </ThemedText>
        {DISCLOSURES.map(([h, p], i) => (
          <Disclosure key={h} title={h} first={i === 0}>
            {p}
          </Disclosure>
        ))}
      </Card>
      <Button title="Sign out" kind="quiet" disabled={busy} onPress={() => signOut(false)} />
      <Button title="Sign out of all devices" kind="quiet" disabled={busy} onPress={() => signOut(true)} />
      <ThemedText variant="caption" tone="secondary">
        Sprouts, built for CLOCK IN. Code: github.com/donlucasx/sprouts
      </ThemedText>
    </Screen>
  )
}
