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
import { makeSigner } from '@/lib/sign'
import { linkErrorView, showStillStuck } from '@/lib/link-error'
import { QuestionCard } from '@/components/QuestionCard'
import { useInvalidateMe, useMe } from '@/lib/me'
import { newlyLinked } from '@/lib/newly-linked'
import { confirmWithRetries, LINK_NOT_ON_CHAIN_YET } from '@/lib/confirm-retry'
import { useSession } from '@/lib/session'
import { reportLinkFailure, type LinkFailure, type LinkStep } from '@/lib/link-report'
import { APPROVAL_WARN_BODY, APPROVAL_WARN_TITLE, CAN, CANT, CODE_STEPS, LINK_FINISHING, LINK_INTRO, OTHER_WALLET_LINE, phoneUsdcNote } from '@/lib/safety-copy'
import { TopUpButton } from '@/components/TopUp'
import { TOPUP, TOPUP_DEFAULT_CENTS } from '@/lib/topup'
import { FONT, radius, spacing, useTheme } from '@/theme'

/**
 * Confirms the link; when the delegation is late on chain the same code is confirmed again (no new signature, no new code), so a late
 * approval never leaves a stray delegation behind a fresh one (review I7). The retry loop lives in confirm-retry.ts (T9 shares it).
 * 11-01 (Kimi MED, hapybuda.skr: one tap, five 409s, no approval ever on chain): every attempt re-posts the SAME signed approval, as
 * the re-link card already does (relink.ts). A first send the network lost is sent again; one that landed is simply already processed.
 */
function confirmLink(code: string, wallet: string, signedTransaction: string) {
  return confirmWithRetries(() => api('/api/link/confirm', { method: 'POST', body: { code, wallet, signedTransaction } }), {
    notOnChainYet: LINK_NOT_ON_CHAIN_YET,
  })
}

/** The error under the button that caused it, and (11-01, support draft v1 screen 5) help right there, with the topic picked. */
function LinkError({ error, title, help = true }: { error: string; title?: string; help?: boolean }) {
  return (
    <>
      {title ? <ThemedText variant="heading" tone="error">{title}</ThemedText> : null}
      <ThemedText tone="error">{error}</ThemedText>
      {help ? <Button title="Still stuck? Message us" kind="quiet" onPress={() => router.push('/support?topic=link')} style={{ alignSelf: 'flex-start' }} /> : null}
    </>
  )
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
  // 10-28: after the wallet signs, the link is still being checked on chain; the caption says so instead of "Waiting for your wallet"
  const [signed, setSigned] = useState(false)
  const [coding, setCoding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Copy C: the phone-link error's title, and whether "What happened?" is offered; the question shows at most once per screen visit.
  const [errorTitle, setErrorTitle] = useState('')
  const [canAsk, setCanAsk] = useState(false)
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState(false)
  // 11-08: failures of this phone's link on this screen visit; help shows from the second (showStillStuck)
  const [failures, setFailures] = useState(0)
  // 11-02 (his device note: the error sat at the page's foot, "Still stuck" out of sight): which card the error belongs under
  const [errorFrom, setErrorFrom] = useState<'phone' | 'code'>('phone')
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
  // 10-28 (his note): a wallet linked from the web page sends the app back to the garden too, with the same notice
  useEffect(() => {
    if (linked) router.replace({ pathname: '/home', params: { linked: linked.pubkey } })
  }, [linked])

  /** This phone's wallet is the trading wallet: the Seed Vault key approves the delegation for itself. */
  async function linkThisPhone() {
    if (!session) return
    setApproving(true)
    setSigned(false)
    setError(null)
    setErrorTitle('')
    setCanAsk(false)
    setAsking(false)
    let step: LinkStep = 'new'
    try {
      const { code } = await api<{ code: string }>('/api/link/new', { method: 'POST', body: {} })
      step = 'approval'
      const t = await api<{ transaction: string; cap: number }>(`/api/link/${code}?wallet=${session.pubkey}`)
      step = 'sign'
      const signedTx = await makeSigner(signTransaction, { kind: 'link', user: session.pubkey })(t.transaction)
      setSigned(true)
      step = 'confirm'
      await confirmLink(code, session.pubkey, signedTx)
      await invalidate()
      // 10-28 (his note): back to the garden, where a notice says the wallet linked until he taps OK
      router.replace({ pathname: '/home', params: { linked: session.pubkey } })
    } catch (e) {
      setErrorFrom('phone')
      setFailures((n) => n + 1)
      const view = linkErrorView(e)
      setErrorTitle(view.title)
      setCanAsk(view.ask)
      setError(view.body)
      // 10-31: where it stopped, for the drop-offs the server cannot see (a wallet closed or cancelled before signing)
      reportLinkFailure((body: LinkFailure) => api('/api/link/report', { method: 'POST', body }), step, e, session.pubkey)
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
      setErrorFrom('code')
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
            {signed ? LINK_FINISHING : 'Waiting for your wallet.'}
          </ThemedText>
        ) : null}
        {error && errorFrom === 'phone' ? (
          <>
            {/* 11-08 (his Saga note): one help line, from the second failure. A wallet that closed opens What happened? in place
                (with Message us inside); any other error keeps "Still stuck? Message us". */}
            <LinkError error={error} title={errorTitle} help={!canAsk && showStillStuck(failures)} />
            {canAsk ? <Button title="Try again" loading={approving} onPress={linkThisPhone} style={{ alignSelf: 'flex-start' }} /> : null}
            {canAsk && showStillStuck(failures) && !asked ? (
              <Button title="Still stuck? Tell us what happened" kind="quiet" onPress={() => { setAsking(true); setAsked(true) }} style={{ alignSelf: 'flex-start' }} />
            ) : null}
            {asking ? <QuestionCard question="link_failed" onDone={() => setAsking(false)} onMessageUs={() => router.push('/support?topic=link')} /> : null}
          </>
        ) : null}
      </Card>
      <Card>
        <ThemedText variant="heading">Another wallet</ThemedText>
        <ThemedText tone="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
          {OTHER_WALLET_LINE}
        </ThemedText>
        {code ? (
          <View style={{ gap: spacing.sm }}>
            <ThemedText variant="display" numeric style={{ fontFamily: FONT.displayBold, letterSpacing: 6 }}>
              {code}
            </ThemedText>
            <ThemedText tone="secondary">{CODE_STEPS}</ThemedText>
            <Button title="Get a new code" kind="quiet" loading={coding} onPress={codeForAnotherWallet} />
          </View>
        ) : (
          <Button title="Get a code" kind="quiet" loading={coding} onPress={codeForAnotherWallet} />
        )}
        {error && errorFrom === 'code' ? <LinkError error={error} /> : null}
      </Card>
    </Screen>
  )
}
