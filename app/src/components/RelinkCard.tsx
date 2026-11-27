'use no memo' // 11-27: this file's lines are read in the current language at render; the React Compiler would cache them (i18n/useLang)
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ApprovalStep } from '@/components/ApprovalStep'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type MeResponse, type MeUsdcResponse } from '@/lib/api'
import { makeSigner, SignRefused } from '@/lib/sign'
import { setupAccountsOf, setupLine } from '@/lib/safety-copy'
import { useSolUsd } from '@/lib/sol-usd'
import { ME_USDC_SETUP, meUsdcSetupKey } from '@/lib/topup'
import { LEND_MOCK } from '@/lib/lend-mock'
import { disclosureItems, RELINK, relinkCode, RelinkExpired, RelinkSent, relinkThisPhone, relinkView, relinkWebLines, short } from '@/lib/relink'
import { oneAtATime } from '@/lib/withdraw-flow'
import { FONT, spacing, TARGET, useTheme } from '@/theme'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'

const CODE_LIFE_MS = 15 * 60_000 // api/link/new: a code lasts 15 minutes and binds to one wallet

/**
 * R287: the re-link card on Home, shown only while /api/me says relink.needed (the API turns that on at go-live, spec 6.5). Each path's
 * state comes from /api/me (T9 review I1): this phone's button goes when the refetched read stops listing it; the web part stays while
 * any web wallet is still listed.
 */
export function RelinkCard({ me }: { me: MeResponse }) {
  useLang()
  const view = relinkView(me)
  const user = me.user.pubkey
  const webKey = view.web.join(',')
  const { colors } = useTheme()
  // 0.1.13 step 3 (Kimi 6): Re-link asks for the same USDC approval, so it shows the same last step before the wallet opens
  const [confirming, setConfirming] = useState(false)
  const { signTransaction } = useMobileWallet()
  const qc = useQueryClient()
  const [gate] = useState(oneAtATime)
  const [open, setOpen] = useState(false)
  // The Re-link tap's phase: the Seeker is asked, then (signature back) the confirm and its retries run.
  const [relinking, setRelinking] = useState<null | 'seeker' | 'chain'>(null)
  const [coding, setCoding] = useState(false)
  // Each tap's error sits beside its own button (T9 re-review minor).
  const [relinkError, setRelinkError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  // Set when this phone's re-link confirmed; the done line shows once the refetched read no longer lists this phone.
  const [relinked, setRelinked] = useState(false)
  const [code, setCode] = useState<{ code: string; at: number; web: string[] } | null>(null)
  // C6: each web wallet's leash address, derived on the phone, so the user can compare it with the one the link page shows.
  const [leashes, setLeashes] = useState<Record<string, string>>({})
  // Held until the refetch after a confirmed re-link lands: the button stays hidden in between (I1), then the read decides.
  const [settling, setSettling] = useState(false)
  // Task 17b (rulings 26, 27): the setup count is read ONCE, when this phone's re-link button first shows (never stale, no refetch on
  // focus or polls, kept for the session; only a top-up invalidates it). The number shown is the bound.
  const { data: setupRead } = useQuery({ queryKey: meUsdcSetupKey(user), queryFn: () => api<MeUsdcResponse>(ME_USDC_SETUP), enabled: view.thisPhone, retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const setupCount = setupAccountsOf(setupRead?.setupAccounts)
  const solUsd = useSolUsd(view.thisPhone && setupCount > 0)
  const setupNote = setupLine(setupCount, solUsd)

  useEffect(() => {
    if (!webKey) return
    let live = true
    relinkWebLines(user, webKey.split(','))
      .then((lines) => {
        if (live) setLeashes(Object.fromEntries(lines.map((l) => [l.pubkey, l.leash])))
      })
      .catch(() => {
        // T9 review M4: a key that is not an address shows no leash line (the sentence never stands without its address)
        if (live) setLeashes({})
      })
    return () => {
      live = false
    }
  }, [user, webKey])

  // T9 review I2 (as Connect): while a code is out, read /api/me every 4 s; a wallet that leaves the list used the code.
  // Derived, not stored (as Connect's `linked`): the wallet that left the list since the code was made used it.
  const used = code ? (code.web.find((pk) => !view.web.includes(pk)) ?? null) : null
  useEffect(() => {
    if (!code || used) return
    const t = setInterval(() => {
      if (Date.now() - code.at > CODE_LIFE_MS) setCode(null)
      else void qc.invalidateQueries({ queryKey: ['me'] })
    }, 4_000)
    return () => clearInterval(t)
  }, [code, used, qc])

  async function relinkHere() {
    if (!gate.enter()) return
    setRelinking('seeker')
    setRelinkError(null)
    try {
      await relinkThisPhone({
        user,
        setupMax: setupCount,
        build: (body) => api<{ transaction: string }>('/api/relink/build', { method: 'POST', body }),
        sign: (flow) => makeSigner(signTransaction, flow),
        confirm: (body) => api('/api/relink/confirm', { method: 'POST', body }),
        onSigned: () => setRelinking('chain'),
        // 11-26: the first approval expired; the Seed Vault is asked once more
        onRebuild: () => setRelinking('seeker'),
      })
      setRelinked(true)
      setSettling(true)
    } catch (e) {
      setRelinkError(e instanceof RelinkSent || e instanceof RelinkExpired || e instanceof ApiError || e instanceof SignRefused ? e.message : RELINK.failedBefore)
      setConfirming(false)
    } finally {
      setRelinking(null)
      try {
        await qc.invalidateQueries({ queryKey: ['me'] })
      } finally {
        setSettling(false)
        gate.leave()
      }
    }
  }
  async function getCode() {
    if (!gate.enter()) return
    setCoding(true)
    setCodeError(null)
    try {
      const c = await relinkCode({ mock: LEND_MOCK, post: () => api<{ code: string }>('/api/link/new', { method: 'POST', body: {} }) })
      if ('error' in c) setCodeError(c.error)
      else setCode({ code: c.code, at: Date.now(), web: view.web })
    } catch (e) {
      setCodeError(e instanceof ApiError ? e.message : RELINK.codeFailed)
    } finally {
      gate.leave()
      setCoding(false)
    }
  }

  const doneLine = relinked && !view.thisPhone
  if (!view.show && !doneLine) return null
  return (
    <Card>
      {view.thisPhone || !doneLine ? <ThemedText variant="heading">{RELINK.title}</ThemedText> : null}
      {doneLine ? <ThemedText tone="accentText">{RELINK.done}</ThemedText> : null}
      {view.thisPhone ? (
        <>
          <ThemedText>{RELINK.body}</ThemedText>
          {setupNote && !settling ? (
            <ThemedText variant="caption" tone="secondary">
              {setupNote}
            </ThemedText>
          ) : null}
          {settling ? null : confirming ? (
            <ApprovalStep busy={relinking !== null} onContinue={relinkHere} onBack={() => setConfirming(false)} />
          ) : (
            <Button title={RELINK.button} loading={relinking !== null} onPress={() => setConfirming(true)} />
          )}
          {relinking ? (
            <ThemedText variant="caption" tone="secondary">
              {relinking === 'seeker' ? RELINK.waiting : RELINK.checking}
            </ThemedText>
          ) : null}
          {relinkError ? <ThemedText tone="error">{relinkError}</ThemedText> : null}
        </>
      ) : null}
      {view.web.length > 0 ? (
        <View style={{ borderTopWidth: view.thisPhone ? 1 : 0, borderTopColor: colors.hairline }}>
          <Pressable
            onPress={() => setOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={RELINK.disclosure}
            accessibilityState={{ expanded: open }}
            style={({ pressed }) => ({ minHeight: TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, opacity: pressed ? 0.7 : 1 })}
          >
            <ThemedText style={{ flex: 1 }}>{RELINK.disclosure}</ThemedText>
            <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colors.accentText} />
          </Pressable>
          {open ? (
            <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
              {disclosureItems(view.web, leashes).map((it) =>
                it.kind === 'address' ? (
                  <ThemedText key={it.key} variant="caption" selectable style={{ fontFamily: FONT.label }}>
                    {it.text}
                  </ThemedText>
                ) : (
                  <ThemedText key={it.key} variant={it.kind === 'note' ? 'caption' : 'body'} tone="secondary">
                    {it.text}
                  </ThemedText>
                ),
              )}
              {used ? <ThemedText tone="accentText">{RELINK.webDone(short(used))}</ThemedText> : null}
              {code && !used ? (
                <>
                  <ThemedText variant="display" numeric style={{ fontFamily: FONT.displayBold, letterSpacing: 6 }}>
                    {code.code}
                  </ThemedText>
                  <ThemedText tone="secondary">{RELINK.codeRule}</ThemedText>
                </>
              ) : null}
              <Button title={code && !used ? RELINK.newCode : RELINK.getCode} kind="quiet" loading={coding} onPress={getCode} style={{ alignSelf: 'flex-start' }} />
              {codeError ? <ThemedText tone="error">{codeError}</ThemedText> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  )
}
