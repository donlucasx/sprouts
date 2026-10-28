import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { View } from 'react-native'
import { router } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError } from '@/lib/api'
import { makeSigner, SignRefused } from '@/lib/sign'
import { DROPPED_NOTHING_SENT, isSessionDropped } from '@/lib/wallet-errors'
import { useInvalidateMe, useMe } from '@/lib/me'
import { newlyLinked } from '@/lib/newly-linked'
import { confirmWithRetries, LINK_NOT_ON_CHAIN_YET } from '@/lib/confirm-retry'
import { formatWallet } from '@/lib/format'
import { useSession } from '@/lib/session'
import { APPROVAL_WARN_BODY, APPROVAL_WARN_TITLE, CAN, CANT, LINK_INTRO, OTHER_WALLET_LINE, phoneUsdcNote } from '@/lib/safety-copy'
import { TopUpButton } from '@/components/TopUp'
import { TOPUP, TOPUP_DEFAULT_CENTS } from '@/lib/topup'
import { FONT, radius, spacing, useTheme } from '@/theme'

/**
 * Confirms the link; when the delegation is late on chain the same code is confirmed again (no new signature, no new code), so a late
 * approval never leaves a stray delegation behind a fresh one (review I7). The retry loop lives in confirm-retry.ts (T9 shares it).
 */
function confirmLink(code: string, wallet: string, signedTransaction: string) {
  // after the first send the approval is out; only the delegation read is pending
  return confirmWithRetries((attempt) => api('/api/link/confirm', { method: 'POST', body: attempt === 0 ? { code, wallet, signedTransaction } : { code, wallet } }), {
    notOnChainYet: LINK_NOT_ON_CHAIN_YET,
  })
}

/** 10-27 (WAL-002): the wallet's "unlimited USDC" warning, said right above Approve so it is expected, not a surprise. */
function ApprovalWarning() {
  const { colors } = useTheme()
  return (
    <View style={{ borderWidth: 1.5, borderColor: colors.attention, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs }}>
      <ThemedText tone="attention" style={{ fontFamily: FONT.label, fontSize: 15, lineHeight: 21 }}>
        {APPROVAL_WARN_TITLE}
      </ThemedText>
      <ThemedText style={{ fontSize: 14, lineHeight: 20 }}>{APPROVAL_WARN_BODY}</ThemedText>
    </View>
  )
}

/** One marked line of the can / can't card: a check for what Sprouts can do, a cross for what it can't. */
function Mark({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <ThemedText tone={ok ? 'accentText' : 'error'} style={{ width: 18 }}>
        {ok ? '\u2713' : '\u2715'}
      </ThemedText>
      <ThemedText style={{ flex: 1 }}>{text}</ThemedText>
    </View>
  )
}

export default function Connect() {
  const { session } = useSession()
  const { signTransaction } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [code, setCode] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [coding, setCoding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toppedUp, setToppedUp] = useState(false)
  const { data: me, refetch } = useMe()
  const [before, setBefore] = useState<string[]>([])
  // Derived, not stored: the wallet that appeared since this code was made.
  const linked = code && me ? newlyLinked(before, me.wallets) : null
  // This phone's wallet's USDC, read only, for a note that never blocks the approval; a failed read (or an API without the route)
  // is no note: the "before you link" point says it anyway.
  const { data: usdc } = useQuery({
    queryKey: ['me-usdc', session?.pubkey],
    queryFn: () => api<{ usdcRaw: string | null; topUpCents?: number[] | null }>('/api/me/usdc'),
    enabled: !!session,
    retry: false,
    staleTime: 30_000,
  })
  const usdcNote = phoneUsdcNote(usdc?.usdcRaw, me?.rules.plantThresholdCents ?? 200)

  // While a code is on screen, look for the wallet the web page links (the Saga, 2026-09-29: the app never noticed).
  useEffect(() => {
    if (!code || linked) return
    const t = setInterval(() => void refetch(), 4_000)
    return () => clearInterval(t)
  }, [code, linked, refetch])

  /** This phone's wallet is the trading wallet: the Seed Vault key approves the delegation for itself. */
  async function linkThisPhone() {
    if (!session) return
    setApproving(true)
    setError(null)
    try {
      const { code } = await api<{ code: string }>('/api/link/new', { method: 'POST', body: {} })
      const t = await api<{ transaction: string; cap: number }>(`/api/link/${code}?wallet=${session.pubkey}`)
      const signed = await makeSigner(signTransaction, { kind: 'link', user: session.pubkey })(t.transaction)
      await confirmLink(code, session.pubkey, signed)
      await invalidate()
      router.replace('/home')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof SignRefused ? e.message : isSessionDropped(e) ? DROPPED_NOTHING_SENT : 'The approval did not go through. Try again.')
    } finally {
      setApproving(false)
    }
  }

  async function codeForAnotherWallet() {
    setCoding(true)
    setError(null)
    try {
      setBefore((me?.wallets ?? []).filter((w) => w.status !== 'revoked').map((w) => w.pubkey))
      setCode((await api<{ code: string }>('/api/link/new', { method: 'POST', body: {} })).code)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make a code. Try again.')
    } finally {
      setCoding(false)
    }
  }

  return (
    <Screen back title="Link a wallet">
      <ThemedText>{LINK_INTRO}</ThemedText>
      <Card>
        {CAN.map((l) => <Mark key={l} ok text={l} />)}
        {CANT.map((l) => <Mark key={l} ok={false} text={l} />)}
      </Card>
      <Card>
        <ThemedText variant="heading">{"This phone's wallet"}</ThemedText>
        {usdcNote ? (
          <ThemedText tone="attention" style={{ fontSize: 14, lineHeight: 20 }}>
            {usdcNote}
          </ThemedText>
        ) : null}
        {/* 10-22: the note's own fix, one tap; it stays mounted after a top-up so its confirmation shows once the note has gone */}
        {session && (usdcNote || toppedUp) ? (
          <TopUpButton compact user={session.pubkey} cents={TOPUP_DEFAULT_CENTS} done={TOPUP.doneLink} onDone={() => setToppedUp(true)} offers={usdc?.topUpCents ?? null} />
        ) : null}
        <ApprovalWarning />
        <Button title="Approve" loading={approving} onPress={linkThisPhone} />
        {approving ? (
          <ThemedText variant="caption" tone="secondary">
            Waiting for your wallet.
          </ThemedText>
        ) : null}
      </Card>
      <Card>
        <ThemedText variant="heading">Another wallet</ThemedText>
        {linked
          ? null
          : (
              <ThemedText tone="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
                {OTHER_WALLET_LINE}
              </ThemedText>
            )}
        {linked ? (
          <View style={{ gap: spacing.sm }}>
            <ThemedText tone="accentText">{`Linked ${formatWallet(linked)}.`}</ThemedText>
            <ThemedText tone="secondary">Its swaps now round up into your garden.</ThemedText>
            <Button title="Done" onPress={() => router.replace('/home')} />
          </View>
        ) : code ? (
          <View style={{ gap: spacing.sm }}>
            <ThemedText variant="display" numeric style={{ fontFamily: FONT.displayBold, letterSpacing: 6 }}>
              {code}
            </ThemedText>
            <ThemedText tone="secondary">
              On the computer with that wallet, open sprouts.money/link, enter this code and approve. It lasts 15
              minutes, one wallet.
            </ThemedText>
            <Button title="Get a new code" kind="quiet" loading={coding} onPress={codeForAnotherWallet} />
          </View>
        ) : (
          <Button title="Get a code" kind="quiet" loading={coding} onPress={codeForAnotherWallet} />
        )}
      </Card>
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </Screen>
  )
}
