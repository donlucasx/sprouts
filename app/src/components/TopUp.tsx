import { useState } from 'react'
import { Pressable, Share, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, type MeUsdcResponse } from '@/lib/api'
import { makeSigner } from '@/lib/sign'
import { setupAccountsOf, setupLine } from '@/lib/safety-copy'
import { useSolUsd } from '@/lib/sol-usd'
import { choiceFor, ME_USDC_SETUP, TOPUP, TOPUP_SETUP_MAX, TopUpFailed, topUpChoices, topUpThisPhone, type TopUpSource } from '@/lib/topup'
import { coverageLine } from '@/lib/usdc-runway'
import { TwoWay } from '@/components/TwoWay'
import { oneAtATime } from '@/lib/withdraw-flow'
import { spacing } from '@/theme'

/**
 * The SOL top-up button (10-22): one Seed Vault signature swaps this phone's wallet's SOL to `cents` of USDC. Shown wherever USDC is
 * short for THIS phone's wallet (Home's no-USDC pause, Link a wallet's note). After it lands, /api/me and /api/me/usdc are read again,
 * so the pause line and the note go by themselves. `done` is the confirmation line (Home's names the next run; Link's does not).
 */
/** `compact` (10-27, his note: "a simple top up button that once clicked it opens up the different amounts"): one "Top up" button
 *  first; the amounts, the swap button and its line open under it on the tap. */
/** `offers` (10-27, /api/me/usdc topUpCents): the amounts this wallet's SOL covers; [] = none, so the address to send USDC to is shown
 *  instead; null or absent = unknown, every amount offered (the build route decides). */
/** `sources` (Task 3, /api/me/usdc topUpSources, 0.1.12 API): the coins this wallet can top up from, SOL first; when more than one has
 *  amounts, a picker of their symbols opens above the amounts, SOL picked first, and the amounts are the picked coin's. null or absent
 *  (an older API) = no picker, SOL, `offers` as in 0.1.11. */
export function TopUpButton({ user, cents: suggested, done, onDone, avgDailyCents = null, compact = false, offers = null, sources = null }: { user: string; cents: number; done: (cents: number) => string; onDone?: () => void; avgDailyCents?: number | null; compact?: boolean; offers?: readonly number[] | null; sources?: readonly TopUpSource[] | null }) {
  const [open, setOpen] = useState(!compact)
  // Only coins with an amount to offer are picked or shown; none at all = the address to send USDC to.
  const [pickedMint, setPickedMint] = useState<string | null>(null)
  const { usable, source, symbol, choices } = topUpChoices(sources, offers, pickedMint)
  // 10-26: $5 / $10 / $25, the one covering the pause picked first; one quiet line says how long it lasts (his: "subtle")
  const [picked, setPicked] = useState<number>(() => choiceFor(suggested, choices))
  // the offers can arrive after the first render (Home's /api/me/usdc read): an amount they do not hold is never built or shown
  const cents = choices.includes(picked) ? picked : choiceFor(suggested, choices)
  const [copied, setCopied] = useState(false)
  const { signTransaction } = useMobileWallet()
  const qc = useQueryClient()
  const [gate] = useState(oneAtATime)
  const [phase, setPhase] = useState<null | 'wallet' | 'chain'>(null)
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null)
  // Task 17b (ruling 26): the setup count is read only once the amounts are open (Link a wallet's read shares this key), never by Home's
  // regular read. A top-up carries at most 3; the number shown is the bound the build and the sign check get.
  const { data: setupRead } = useQuery({ queryKey: ['me-usdc', user, 'setup'], queryFn: () => api<MeUsdcResponse>(ME_USDC_SETUP), enabled: open, retry: false, staleTime: 30_000 })
  const setupCount = setupAccountsOf(setupRead?.setupAccounts, TOPUP_SETUP_MAX)
  const solUsd = useSolUsd(open && setupCount > 0)
  const setupNote = setupLine(setupCount, solUsd)

  async function topUp() {
    if (!gate.enter()) return
    setPhase('wallet')
    setLine(null)
    try {
      const outcome = await topUpThisPhone({
        user,
        cents,
        ...(source ? { inputMint: source.mint } : {}),
        setupMax: setupCount,
        // topUpThisPhone shapes the body: exactly { cents } for SOL (as 0.1.11), { cents, inputMint } for another coin
        build: (body) => api<{ transaction: string; usdcRaw: string; inputMint?: string }>('/api/topup/build', { method: 'POST', body }),
        sign: (flow) => makeSigner(signTransaction, flow, { coinSymbol: symbol }),
        confirm: (body) => api<{ status?: string }>('/api/topup/confirm', { method: 'POST', body }),
        onSigned: () => setPhase('chain'),
      })
      setLine(outcome === 'confirmed' ? { text: done(cents), error: false } : { text: TOPUP.sent, error: false })
      if (outcome === 'confirmed') onDone?.()
    } catch (e) {
      setLine({ text: e instanceof TopUpFailed ? e.message : TOPUP.failedBefore, error: true })
    } finally {
      setPhase(null)
      gate.leave()
      // Whatever happened, read the wallet again: a top-up that landed lifts the note and (at the next run) the pause.
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['me-usdc'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    }
  }

  const landed = line !== null && !line.error && line.text === done(cents)
  if (!open)
    return (
      <View style={{ gap: spacing.xs }}>
        <Button title={TOPUP.open} onPress={() => setOpen(true)} />
        <ThemedText variant="caption" tone="secondary">
          {TOPUP.swapsLine(symbol)}
        </ThemedText>
      </View>
    )
  if (choices.length === 0) return <SendUsdcHere address={user} copied={copied} onCopy={() => void copyAddress(user).then(() => setCopied(true))} />
  return (
    <View style={{ gap: spacing.xs }}>
      {landed || phase || !usable || usable.length < 2 || !source ? null : (
        <TwoWay options={usable.map((s) => ({ value: s.mint, label: s.symbol }))} value={source.mint} onChange={(m) => setPickedMint(m)} />
      )}
      {landed || phase ? null : (
        choices.length > 1 ? <TwoWay options={choices.map((c) => ({ value: String(c), label: `$${c / 100}` }))} value={String(cents)} onChange={(v) => setPicked(Number(v))} /> : null
      )}
      {landed ? null : <Button title={TOPUP.button(cents)} loading={phase !== null} onPress={topUp} />}
      {phase ? (
        <ThemedText variant="caption" tone="secondary">
          {phase === 'wallet' ? TOPUP.waiting : TOPUP.checking}
        </ThemedText>
      ) : landed ? null : (
        <>
          <ThemedText variant="caption" tone="secondary">
            {TOPUP.how(cents, coverageLine(cents, avgDailyCents), symbol)}
          </ThemedText>
          {setupNote ? (
            <ThemedText variant="caption" tone="secondary">
              {setupNote}
            </ThemedText>
          ) : null}
        </>
      )}
      {line ? (
        <ThemedText tone={line.error ? 'error' : 'accentText'} style={{ fontSize: 14, lineHeight: 20 }}>
          {line.text}
        </ThemedText>
      ) : null}
    </View>
  )
}

/** The clipboard (expo-clipboard, native: from the next build); a build without it opens the share sheet, which has its own Copy. */
async function copyAddress(address: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setStringAsync } = require('expo-clipboard') as typeof import('expo-clipboard')
    await setStringAsync(address)
  } catch {
    await Share.share({ message: address }).catch(() => undefined)
  }
}

/** 10-27: a wallet whose SOL covers no amount is shown where to send USDC, never told about SOL. */
function SendUsdcHere({ address, copied, onCopy }: { address: string; copied: boolean; onCopy: () => void }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <ThemedText style={{ fontSize: 14, lineHeight: 20 }}>{TOPUP.sendHere}</ThemedText>
      <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={TOPUP.copy}>
        <ThemedText variant="caption" tone="secondary" selectable style={{ fontFamily: 'monospace' }}>
          {address}
        </ThemedText>
      </Pressable>
      <Button title={copied ? TOPUP.copied : TOPUP.copy} onPress={onCopy} />
    </View>
  )
}
