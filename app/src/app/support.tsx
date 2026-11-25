import { useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Disclosure } from '@/components/Disclosure'
import { ApiError } from '@/lib/api'
import { canSend, fetchSupportLog, isTopic, logLine, MESSAGE_MAX, previewOf, readSupportEmail, sendSupport, SUPPORT_LOG_KEY, SUPPORT_TOPICS, topicLabel, type SupportTopic } from '@/lib/support'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { useLang } from '@/i18n/useLang'
import { en } from '@/i18n/en'
import { t } from '@/i18n'

/** What the "Sent with your message" row says: everything attached, in plain words (the API's support route adds the server half).
 *  0.1.13: the English (tests); the screen shows t('support.attached'). */
export const ATTACHED = en['support.attached']

/**
 * 11-01 (his ask, draft v1 approved, email required by his ruling): one message to the team. Replies come by email only; nothing comes
 * back into the app, so the email is required. Opened from Settings > Help, and from the link screen with the topic picked (?topic=link).
 */
export default function Support() {
  useLang()
  const { colors } = useTheme()
  const params = useLocalSearchParams<{ topic?: string }>()
  const [topic, setTopic] = useState<SupportTopic | null>(isTopic(params.topic) ? params.topic : null)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(readSupportEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [sentRef, setSentRef] = useState<string | null>(null)
  const queryClient = useQueryClient()
  // 11-02: Send's bottom edge in the scroll's content, so the keyboard stops there, not at the message list's end
  const sendBottom = useRef<number | null>(null)
  // 11-01 (his ruling B): the user's own messages with their references; a failed read just hides the list
  const { data: log } = useQuery({ queryKey: SUPPORT_LOG_KEY, queryFn: fetchSupportLog })

  const field = {
    fontFamily: 'AlbertSans_400Regular',
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    padding: spacing.md,
  } as const

  async function send() {
    setBusy(true)
    setError(null)
    try {
      setSentRef(await sendSupport({ topic, message, email }))
      setSentTo(email.trim())
      void queryClient.invalidateQueries({ queryKey: SUPPORT_LOG_KEY })
    } catch (e) {
      // 11-01 (his Seeker was offline): Home's generic "didn't answer" line points at Home; here, say what to do. Your text stays put.
      setError(e instanceof ApiError && e.status !== 0 ? e.message : t('support.sendFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <Screen back title={t('support.title')}>
        <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl * 2 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="check" size={36} color={colors.onAccent} />
          </View>
          <ThemedText variant="heading" accessibilityRole="header">
            {t('support.sent')}
          </ThemedText>
          <ThemedText tone="secondary" style={{ textAlign: 'center' }}>
            {t('support.thanks', { email: sentTo })}
          </ThemedText>
          {sentRef ? (
            <ThemedText variant="label" numeric style={{ textAlign: 'center' }}>
              {t('support.ref', { ref: sentRef })}
            </ThemedText>
          ) : null}
          <Button title={t('support.done')} onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: spacing.lg }} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen back title={t('support.title')} keyboard keyboardAnchor={() => sendBottom.current}>
      <ThemedText tone="secondary">{t('support.intro')}</ThemedText>

      <ThemedText variant="label">{t('support.about')}</ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {SUPPORT_TOPICS.map((tp) => {
          const on = tp.value === topic
          const label = topicLabel(tp.value)
          return (
            <Pressable
              key={tp.value}
              onPress={() => setTopic(on ? null : tp.value)}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              hitSlop={4}
              style={({ pressed }) => ({
                minHeight: 40,
                justifyContent: 'center',
                paddingHorizontal: spacing.md,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: on ? colors.accent : colors.hairline,
                backgroundColor: on ? colors.accent : colors.background,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <ThemedText variant="button" style={{ color: on ? colors.onAccent : colors.text }}>
                {label}
              </ThemedText>
            </Pressable>
          )
        })}
      </View>

      <ThemedText variant="label">{t('support.message')}</ThemedText>
      <TextInput
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={MESSAGE_MAX}
        placeholder={t('support.placeholder')}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={t('support.message')}
        editable={!busy}
        textAlignVertical="top"
        style={{ ...field, minHeight: 120 }}
      />

      <ThemedText variant="label">{t('support.email')}</ThemedText>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder={t('support.email.placeholder')}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={t('support.email.a11y')}
        editable={!busy}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        style={{ ...field, minHeight: TARGET }}
      />
      <ThemedText variant="caption" tone="secondary">
        {t('support.email.note')}
      </ThemedText>

      <View>
        <Disclosure title={t('support.attached.title')} first>
          {t('support.attached')}
        </Disclosure>
      </View>

      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
      <View onLayout={(e) => (sendBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <Button title={t('support.send')} loading={busy} disabled={!canSend(message, email)} onPress={send} />
      </View>
      <ThemedText variant="caption" tone="secondary">
        {t('support.neverAsk')}
      </ThemedText>
      {/* 11-01 (his note: the Settings footer email goes, "ensure the email can be found elsewhere relevant"): here, beside the form */}
      <ThemedText variant="caption" tone="secondary">
        {t('support.preferEmail')}
      </ThemedText>
      {log && log.length > 0 ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <ThemedText variant="heading">{t('support.yours')}</ThemedText>
          {log.map((e, i) => (
            <View key={`${e.ref ?? ''}${e.ts}`} style={{ gap: 2, paddingTop: i === 0 ? 0 : spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
              <ThemedText variant="label" tone="secondary" numeric>
                {logLine(e)}
              </ThemedText>
              <ThemedText numberOfLines={2}>{previewOf(e)}</ThemedText>
            </View>
          ))}
          <ThemedText variant="caption" tone="secondary">
            {t('support.replies')}
          </ThemedText>
        </View>
      ) : null}
    </Screen>
  )
}
