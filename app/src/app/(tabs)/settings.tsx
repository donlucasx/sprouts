import { useRef, useState } from 'react'
import { Appearance, AppState, Switch, View } from 'react-native'
import { Link, router } from 'expo-router'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { ProBadge } from '@/components/ProBadge'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Disclosure } from '@/components/Disclosure'
import { AddWidget } from '@/components/AddWidget'
import { TwoWay } from '@/components/TwoWay'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { useMe, store, useInvalidateMe } from '@/lib/me'
import { refreshWidget } from '@/lib/widget-refresh'
import { unregisterBackgroundRefresh } from '@/lib/background'
import { useSession } from '@/lib/session'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { formatWallet, holdingsNote } from '@/lib/format'
import { makeSigner, SignRefused } from '@/lib/sign'
import { droppedNothingSent, isSessionDropped } from '@/lib/wallet-errors'
import { freshSignIn } from '@/lib/signin'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { readAppearance, writeAppearance, readNotify, writeNotify } from '@/lib/prefs'
import { readLangChoice, t, writeLangChoice, type LangChoice } from '@/i18n'
import type { Key } from '@/i18n/en'
import { useLang } from '@/i18n/useLang'
import type { NoticeKind } from '@/lib/notices'
import { disclosures } from '@/lib/settings-copy'
import { clearTaxFiles, prepareTaxCsv, shareTaxCsv, taxFileFresh, type TaxFile } from '@/lib/tax-export'
import { notify } from '@/lib/notify'
import { QuestionCard } from '@/components/QuestionCard'
import { dismiss, readDismissed, removedAskFor } from '@/lib/feedback'
import { spacing, switchColors, useTheme } from '@/theme'
import { schemeFor, type Appearance as AppearanceChoice } from '@/theme/appearance'

/** R161: each notice and its switch's words (a key, read at render), in the order they show. */
const NOTICES: [NoticeKind, Key][] = [
  ['plantings', 'settings.notices.plantings'],
  ['withdrawals', 'settings.notices.withdrawals'],
  ['manager', 'settings.notices.manager'],
  ['limit', 'settings.notices.limit'],
  ['paused', 'settings.notices.paused'],
  ['reminders', 'settings.notices.reminders'],
]
/** Copy F: a switch's second line, where it has one. */
const NOTICE_SUBLINE: Partial<Record<NoticeKind, Key>> = {
  reminders: 'settings.notices.reminders.sub',
}
/** A wallet's short address, as TalkBack hears it beside Pause / Resume / Revoke. */
const shortKey = (pubkey: string) => `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`

export default function Settings() {
  const [taxBusy, setTaxBusy] = useState(false)
  const [taxFile, setTaxFile] = useState<TaxFile | null>(null)
  const [proNote, setProNote] = useState(false)
  const [taxError, setTaxError] = useState<string | null>(null)
  const { data: me } = useMe()
  const liveWallets = (me?.wallets ?? []).filter((w) => w.status !== 'revoked')
  const { session, setSession } = useSession()
  // The kit's cached wallet authorization goes with the session: a stale token is declined by Solflare (-1) on the next sign-in or transaction (10-01).
  const { disconnect } = useMobileWallet()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const { colors } = useTheme()
  const toggle = switchColors(colors)
  const [appearance, setAppearanceState] = useState<AppearanceChoice>(() => readAppearance())
  // 0.1.13: the language row; useLang re-renders this screen the moment the choice changes.
  useLang()
  const [langChoice, setLangChoice] = useState<LangChoice>(() => readLangChoice())
  function chooseLang(c: LangChoice) {
    writeLangChoice(c)
    setLangChoice(c)
  }
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
      setWalletError(e instanceof ApiError ? e.message : t('settings.wallets.changeFailed'))
    } finally {
      setWalletBusy(false)
      setSigning(false)
    }
  }

  // Copy D: after a revoke the user made, the removed-wallet question. Its ref is the server's removedRef (`<wallet>:<UTC day>`), so Home's ask for it counts as answered.
  const [removedRef, setRemovedRef] = useState<string | null>(null)
  // 11-08 (his note: the keyboard covered the What happened? box): the card's bottom in the scroll, where the keyboard stops
  const walletsBottom = useRef<number | null>(null)
  // 11-08 his ruling: the server's ask (a wallet removed anywhere, e.g. sprouts.money/revoke) shows here too, not on Home
  const [, setAnswered] = useState(0)
  const shownRemovedRef = removedRef ?? removedAskFor(me ?? null, readDismissed())?.ref ?? null

  async function revoke(wallet: string) {
    if (!session) return
    setWalletError(null)
    if (wallet !== session.pubkey) {
      setWalletError(t('settings.wallets.revokeElsewhere'))
      return
    }
    setWalletBusy(true)
    setSigning(true)
    try {
      const built = await api<{ transaction: string | null }>(`/api/revoke/${wallet}`)
      if (!built.transaction) throw new ApiError(409, t('settings.wallets.nothingToRevoke'))
      const signed = await makeSigner(signTransaction, { kind: 'revoke', user: wallet })(built.transaction)
      await api(`/api/revoke/${wallet}`, { method: 'POST', body: { signedTransaction: signed } })
      setRemovedRef(`${wallet}:${new Date().toISOString().slice(0, 10)}`)
      await invalidate()
    } catch (e) {
      setWalletError(e instanceof ApiError || e instanceof SignRefused ? e.message : isSessionDropped(e) ? droppedNothingSent() : t('settings.wallets.revokeFailed'))
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
    <Screen inset="top" title={t('tabs.settings')} keyboard keyboardAnchor={() => walletsBottom.current}>
      <Card>
        {/* R462: the wallet that signs in is the Seed Vault */}
        <ThemedText variant="heading">{t('settings.seedVault.title')}</ThemedText>
        <ThemedText numeric>
          {me?.user.skrName ?? (session ? `${session.pubkey.slice(0, 4)}...${session.pubkey.slice(-4)}` : '')}
        </ThemedText>
        {/* R150: the holdings note moved here from Home (both audits): where the wallet coins sit, said once. */}
        {/* His note 10-08: one small caption under the address, so the address leads */}
        <ThemedText variant="caption" tone="secondary">
          {`${t('settings.seedVault.note')} ${holdingsNote()}`}
        </ThemedText>
      </Card>
      <Card>
        {/* R446: one Pro bundle (the Yield Manager, automatic lending, tax reports), free during launch; R457: Add money is coming.
            R464: near the top, under the Seed Vault, with a greyed "Get Pro" that explains itself on a tap */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ThemedText variant="heading">Sprouts Pro</ThemedText>
          <ProBadge />
        </View>
        <ThemedText>{t('settings.pro.line')}</ThemedText>
        {[t('settings.pro.manager'), t('settings.pro.lending'), t('settings.pro.tax')].map((l) => (
          <ThemedText key={l} tone="secondary">
            {`\u2022 ${l}`}
          </ThemedText>
        ))}
        <Button
          title={t('settings.pro.get')}
          kind="quiet"
          onPress={() => setProNote((v) => !v)}
          accessibilityLabel={t('settings.pro.get.a11y')}
          style={{ alignSelf: 'flex-start', opacity: 0.45 }}
        />
        {proNote ? (
          <ThemedText variant="caption" tone="secondary">
            {`${t('manager.proLine')} ${t('settings.pro.nothingToBuy')}`}
          </ThemedText>
        ) : null}
        <ThemedText variant="caption" tone="secondary">
          {t('settings.pro.soon')}
        </ThemedText>
      </Card>
      <View onLayout={(e) => (walletsBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <Card>
        <ThemedText variant="heading">{t('settings.wallets.title')}</ThemedText>
        {/* 10-28 (his note: an old revoked wallet clutters the list): revoked wallets are hidden; a stopped one has Home's re-link card,
            and its plantings stay in Activity */}
        {me && liveWallets.length === 0 ? <ThemedText tone="secondary">{t('settings.wallets.none')}</ThemedText> : null}
        {/* 11-08 his ruling: the server checks each wallet's own USDC (plant-run.ts), so say it where the wallets are listed */}
        {liveWallets.length > 0 ? (
          <ThemedText variant="caption" tone="secondary">
            {t('settings.wallets.ownUsdc')}
          </ThemedText>
        ) : null}
        {liveWallets.map((w) => (
          <View key={w.pubkey} style={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
            <ThemedText numeric>{formatWallet(w)}</ThemedText>
            {/* 11-08 his note: the phone's own wallet says so, subtly (it is the wallet the user signs in with) */}
            {w.pubkey === me?.user.pubkey ? (
              <ThemedText variant="caption" tone="secondary">
                {t('settings.wallets.seedVault')}
              </ThemedText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title={w.status === 'paused' ? t('settings.wallets.resume') : t('settings.wallets.pause')} accessibilityLabel={w.status === 'paused' ? t('settings.wallets.resume.a11y', { wallet: shortKey(w.pubkey) }) : t('settings.wallets.pause.a11y', { wallet: shortKey(w.pubkey) })} kind="quiet" loading={walletBusy} onPress={() => pauseOrResume(w)} />
              <Button title={t('settings.wallets.revoke')} accessibilityLabel={t('settings.wallets.revoke.a11y', { wallet: shortKey(w.pubkey) })} kind="danger" loading={walletBusy} onPress={() => revoke(w.pubkey)} />
            </View>
          </View>
        ))}
        <ThemedText variant="caption" tone="secondary">
          {t('settings.wallets.revokeNote')}
        </ThemedText>
        {signing ? (
          <ThemedText variant="caption" tone="secondary">
            {t('wallet.waiting')}
          </ThemedText>
        ) : null}
        {walletError ? <ThemedText tone="error">{walletError}</ThemedText> : null}
        {shownRemovedRef ? (
          <QuestionCard
            key={shownRemovedRef}
            question="wallet_removed"
            askRef={shownRemovedRef}
            onDone={() => {
              dismiss(shownRemovedRef)
              setRemovedRef(null)
              setAnswered((n) => n + 1)
            }}
          />
        ) : null}
        <Link href="/connect" asChild>
          <Button title={t('settings.wallets.link')} kind="quiet" onPress={() => {}} style={{ alignSelf: 'flex-start' }} />
        </Link>
      </Card>
      </View>
      <Card>
        <ThemedText variant="heading">{t('settings.appearance')}</ThemedText>
        <TwoWay
          options={[
            { value: 'system', label: t('settings.appearance.system') },
            { value: 'light', label: t('settings.appearance.light') },
            { value: 'dark', label: t('settings.appearance.dark') },
          ]}
          value={appearance}
          onChange={setAppearance}
        />
        <AddWidget />
      </Card>
      <Card>
        <ThemedText variant="heading">{t('settings.language')}</ThemedText>
        <TwoWay
          options={[
            { value: 'auto', label: t('settings.language.auto') },
            { value: 'en', label: t('settings.language.en') },
            { value: 'es', label: t('settings.language.es') },
          ]}
          value={langChoice}
          onChange={chooseLang}
        />
      </Card>
      <Card>
        {/* R160 and R161: the notices grouped under their own heading, one switch each. */}
        <ThemedText variant="heading">{t('settings.notices.title')}</ThemedText>
        {NOTICES.map(([kind, labelKey]) => {
          const label = t(labelKey)
          const sub = NOTICE_SUBLINE[kind] ? t(NOTICE_SUBLINE[kind]) : null
          return (
          <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs }}>
            {/* The switch carries the label; the text is hidden from the screen reader so it is not read twice. */}
            <View style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
              <ThemedText>{label}</ThemedText>
              {sub ? <ThemedText variant="caption">{sub}</ThemedText> : null}
            </View>
            <Switch
              {...toggle}
              value={notifyOn[kind]}
              onValueChange={(on) => {
                writeNotify(kind, on)
                setNotifyOn((s) => ({ ...s, [kind]: on }))
              }}
              accessibilityLabel={sub ? `${label}. ${sub}` : label}
            />
          </View>
          )
        })}
      </Card>
      <Card>
        {/* R447 + R476: Tax reports, Pro (free during launch). R463: request it, the phone says when it is ready,
            then download; the whole history, no year button */}
        {/* His note 10-08: "Tax reports", with the Pro pill the Yield Manager carries */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ThemedText variant="heading">{t('settings.pro.tax')}</ThemedText>
          <ProBadge />
        </View>
        <ThemedText tone="secondary">{t('settings.tax.line')}</ThemedText>
        <Button
          title={taxFileFresh(taxFile) ? t('settings.tax.download') : t('settings.tax.request')}
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
                if (AppState.currentState !== 'active') await notify(t('settings.tax.notify.title'), t('settings.tax.notify.body')).catch(() => {})
              }
            } catch (e) {
              setTaxError(e instanceof ApiError ? e.message : t('settings.tax.failed'))
            } finally {
              setTaxBusy(false)
            }
          }}
          style={{ alignSelf: 'flex-start' }}
        />
        {taxFileFresh(taxFile) ? (
          <ThemedText variant="caption" tone="secondary">
            {t('settings.tax.ready', { file: taxFile.filename })}
          </ThemedText>
        ) : null}
        {taxError ? <ThemedText tone="error">{taxError}</ThemedText> : null}
      </Card>
      <Card>
        {/* 11-01 (his ask, draft v1): one way to reach the team; replies go by email (the Message us screen asks for it) */}
        <ThemedText variant="heading">{t('settings.help.title')}</ThemedText>
        <Button title={t('support.title')} kind="quiet" onPress={() => router.push('/support')} style={{ alignSelf: 'flex-start' }} />
        <ThemedText variant="caption" tone="secondary">
          {t('settings.help.note')}
        </ThemedText>
      </Card>
      <Card style={{ gap: 0 }}>
        {/* R145 and R153: the disclosures as rows that open in place, grouped as About at the end; R300's promise above them, the precise rule inside. */}
        <ThemedText variant="heading">{t('settings.about.title')}</ThemedText>
        {/* R452: three lines on how it works before the questions. 11-20 (his): R300's promise moved into "Who holds my money?" */}
        <ThemedText style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>{t('about.how')}</ThemedText>
        <ThemedText style={{ marginBottom: spacing.sm }}>{t('settings.about.under1')}</ThemedText>
        {disclosures().map(([h, p], i) => (
          <Disclosure key={h} title={h} first={i === 0}>
            {p}
          </Disclosure>
        ))}
        <ThemedText variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
          {t('about.notAdvice')}
        </ThemedText>
      </Card>
      <Button title={t('home.terms.title')} kind="quiet" onPress={() => router.push('/terms')} />
      <Button title={t('settings.signOut')} kind="quiet" disabled={busy} onPress={() => signOut(false)} />
      <Button title={t('settings.signOutAll')} kind="quiet" disabled={busy} onPress={() => signOut(true)} />
    </Screen>
  )
}
