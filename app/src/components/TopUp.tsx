'use no memo' // 11-27: this file's lines are read in the current language at render; the React Compiler would cache them (i18n/useLang)
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
import { chipLabel, choiceFor, ME_USDC_SETUP, meUsdcSetupKey, SEND_PICK, solCheaperLine, TOPUP, TOPUP_SETUP_MAX, TopUpFailed, topUpCard, topUpThisPhone, type TopUpSource, type TopUpUnavailable } from '@/lib/topup'
import { TwoWay } from '@/components/TwoWay'
import { oneAtATime } from '@/lib/withdraw-flow'
import { radius, spacing, TARGET, useTheme, type Palette } from '@/theme'
import { useLang } from '@/i18n/useLang'

/**
 * The SOL top-up button (10-22): one Seed Vault signature swaps this phone's wallet's SOL to `cents` of USDC. Shown wherever USDC is
 * short for THIS phone's wallet (Home's no-USDC card, Link a wallet's note). After it lands, /api/me and /api/me/usdc are read again,
 * so the card and the note go by themselves. `done` is the confirmation line (Home's names the next run; Link's does not).
 */
/** `compact` (10-27, his note: "a simple top up button that once clicked it opens up the different amounts"): one "Top up" button
 *  first; the options open under it on the tap. */
/** `offers` (10-27, /api/me/usdc topUpCents): the amounts this wallet's SOL covers, used only with no `sources` list (an older API,
 *  Link a wallet's read); [] = SOL cannot pay; null or absent = unknown, every amount offered (the build route decides). */
/** `sources` (Task 3, /api/me/usdc topUpSources) and `unavailable` (0.1.13 topUpUnavailable): the coins that can pay and the card coins
 *  that cannot, with why. `waiting` (Home): the ?sources=1 read has not landed, so [Top up] holds rather than open on a guess. */
/** 0.1.13 (his ruling 11-27, Kimi scope 11-27 #2): [Top up] and its line; the tap opens, in the same card, Use SKR / Use SOL (cheapest
 *  first by the server's ranking, each with its short line), the greyed ones with why, then Send USDC. A coin's tap shows its amounts and
 *  [Add $X of USDC]; Send USDC's shows the address and Copy. Link a wallet uses this same component. */
export function TopUpButton({ user, cents: suggested, done, onDone, compact = false, offers = null, sources = null, unavailable = null, waiting = false }: { user: string; cents: number; done: (cents: number) => string; onDone?: () => void; compact?: boolean; offers?: readonly number[] | null; sources?: readonly TopUpSource[] | null; unavailable?: readonly TopUpUnavailable[] | null; waiting?: boolean }) {
  useLang()
  const { colors } = useTheme()
  const [open, setOpen] = useState(!compact)
  // a mint, SEND_PICK or nothing yet; a coin that can no longer pay falls back to nothing picked (topUpCard)
  const [pick, setPick] = useState<string | null>(null)
  const view = topUpCard({ open, waiting, pick, sources, unavailable, offers })
  const source = view.step === 'open' && view.picked?.kind === 'coin' ? view.picked.source : null
  const choices: readonly number[] = source?.offers ?? []
  // 10-26: $5 / $10 / $25, the one covering the pause picked first
  const [picked, setPicked] = useState<number | null>(null)
  // the offers can arrive after the first render (Home's /api/me/usdc read): an amount they do not hold is never built or shown
  const cents = picked !== null && choices.includes(picked) ? picked : choiceFor(suggested, choices)
  const [copied, setCopied] = useState(false)
  const { signTransaction } = useMobileWallet()
  const qc = useQueryClient()
  const [gate] = useState(oneAtATime)
  const [phase, setPhase] = useState<null | 'wallet' | 'chain'>(null)
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null)
  // after it lands: only the confirmation line, whatever the re-read then says about the coins
  const [landed, setLanded] = useState(false)
  // Task 17b (ruling 26): the setup count is read only once a coin is picked (Link a wallet's read shares this key), never by Home's
  // regular read. A top-up carries at most 3; the number shown is the bound the build and the sign check get.
  const { data: setupRead } = useQuery({ queryKey: meUsdcSetupKey(user), queryFn: () => api<MeUsdcResponse>(ME_USDC_SETUP), enabled: source !== null, retry: false, staleTime: 30_000 })
  const setupCount = setupAccountsOf(setupRead?.setupAccounts, TOPUP_SETUP_MAX)
  const solUsd = useSolUsd(source !== null && setupCount > 0)
  const setupNote = setupLine(setupCount, solUsd)

  async function topUp() {
    if (!source || !gate.enter()) return
    setPhase('wallet')
    setLine(null)
    try {
      const outcome = await topUpThisPhone({
        user,
        cents,
        inputMint: source.mint,
        setupMax: setupCount,
        // topUpThisPhone shapes the body: exactly { cents } for SOL (as 0.1.11), { cents, inputMint } for another coin
        build: (body) => api<{ transaction: string; usdcRaw: string; inputMint?: string }>('/api/topup/build', { method: 'POST', body }),
        sign: (flow) => makeSigner(signTransaction, flow, { coinSymbol: source.symbol }),
        confirm: (body) => api<{ status?: string }>('/api/topup/confirm', { method: 'POST', body }),
        onSigned: () => setPhase('chain'),
      })
      setLine(outcome === 'confirmed' ? { text: done(cents), error: false } : { text: TOPUP.sent, error: false })
      if (outcome === 'confirmed') {
        setLanded(true)
        onDone?.()
      }
    } catch (e) {
      setLine({ text: e instanceof TopUpFailed ? e.message : TOPUP.failedBefore, error: true })
    } finally {
      setPhase(null)
      gate.leave()
      // Whatever happened, read the wallet again: a top-up that landed lifts the note and (at the next run) the pause.
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['me-usdc'] })
      void qc.invalidateQueries({ queryKey: ['me-usdc-setup'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    }
  }

  // after it lands: only the confirmation line; the card itself goes on the re-read (the USDC is there)
  if (landed)
    return (
      <ThemedText tone="accentText" style={{ fontSize: 14, lineHeight: 20 }}>
        {line?.text ?? done(cents)}
      </ThemedText>
    )
  if (view.step === 'closed')
    return (
      <View style={{ gap: spacing.xs }}>
        <Button title={TOPUP.open} loading={view.waiting} onPress={() => setOpen(true)} />
        <ThemedText tone="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
          {TOPUP.disclaimer}
        </ThemedText>
      </View>
    )
  // 11-20: Back closes the top-up without sending anything (a wrong tap undone); hidden while the wallet or chain is busy and once landed
  const back = () => {
    setOpen(false)
    setPick(null)
    setLine(null)
  }
  const choose = (next: string) => {
    if (phase) return
    setPick(next)
    setLine(null)
  }
  const busy = phase !== null
  const sending = view.picked?.kind === 'send'
  const solLine = solCheaperLine(source, view.coins, cents)
  return (
    <View style={{ gap: spacing.sm }}>
      {view.coins.map((c) => (
        <View key={c.mint} style={{ gap: spacing.sm }}>
          <OptionRow title={TOPUP.coinTitle(c.symbol)} line={TOPUP.coinLine(c.symbol)} selected={source?.mint === c.mint} disabled={busy} onPress={() => choose(c.mint)} colors={colors} />
          {source?.mint === c.mint ? (
            <View style={{ gap: spacing.xs }}>
              {!busy && choices.length > 1 ? <TwoWay options={choices.map((x) => ({ value: String(x), label: chipLabel(x) }))} value={String(cents)} onChange={(v) => setPicked(Number(v))} /> : null}
              <Button title={TOPUP.button(cents)} loading={busy} onPress={topUp} />
              {phase ? (
                <ThemedText tone="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
                  {phase === 'wallet' ? TOPUP.waiting : TOPUP.checking}
                </ThemedText>
              ) : (
                <>
                  {solLine ? (
                    <ThemedText tone="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
                      {solLine}
                    </ThemedText>
                  ) : null}
                  {setupNote ? (
                    <ThemedText tone="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
                      {setupNote}
                    </ThemedText>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </View>
      ))}
      {view.greyed.map((g) => (
        <OptionRow key={g.mint} title={TOPUP.coinTitle(g.symbol)} line={TOPUP.greyed(g.symbol, g.reason)} selected={false} disabled greyed colors={colors} />
      ))}
      <OptionRow title={TOPUP.send} line={TOPUP.sendLine} selected={sending} disabled={busy} onPress={() => choose(SEND_PICK)} colors={colors} />
      {sending ? <SendUsdcHere address={user} copied={copied} onCopy={() => void copyAddress(user).then(() => setCopied(true))} /> : null}
      {line ? (
        <ThemedText tone={line.error ? 'error' : 'accentText'} style={{ fontSize: 14, lineHeight: 20 }}>
          {line.text}
        </ThemedText>
      ) : null}
      {compact && !phase ? (
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={TOPUP.back} style={({ pressed }) => ({ minHeight: TARGET, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
          <ThemedText tone="accentText">{TOPUP.back}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  )
}

/**
 * One option of the open card: its name and one short line under it, a 44pt+ target. A greyed one (a coin that cannot pay) does not
 * press and says why in its line; TalkBack hears the name, the line and the state (Kimi scope 11-27: accessibility).
 */
function OptionRow({ title, line, selected, disabled, greyed = false, onPress, colors }: { title: string; line: string; selected: boolean; disabled: boolean; greyed?: boolean; onPress?: () => void; colors: Palette }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title}. ${line}`}
      style={({ pressed }) => ({
        minHeight: TARGET,
        justifyContent: 'center',
        gap: 2,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.accent : colors.hairline,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        backgroundColor: colors.surface,
        opacity: pressed && !disabled ? 0.7 : 1,
      })}
    >
      <ThemedText variant="button" style={{ color: greyed ? colors.disabledText : colors.accentText }}>
        {title}
      </ThemedText>
      <ThemedText style={{ fontSize: 14, lineHeight: 20, color: greyed ? colors.disabledText : colors.textSecondary }}>{line}</ThemedText>
    </Pressable>
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

/** Send USDC (10-27; 0.1.13: opened from its row, whose line already says from where): the address and Copy. */
function SendUsdcHere({ address, copied, onCopy }: { address: string; copied: boolean; onCopy: () => void }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={TOPUP.copy}>
        <ThemedText selectable style={{ fontFamily: 'monospace', fontSize: 14, lineHeight: 20 }}>
          {address}
        </ThemedText>
      </Pressable>
      <Button title={copied ? TOPUP.copied : TOPUP.copy} onPress={onCopy} />
    </View>
  )
}
