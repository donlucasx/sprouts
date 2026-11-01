import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Disclosure } from '@/components/Disclosure'
import { ApiError } from '@/lib/api'
import { canSend, isTopic, MESSAGE_MAX, readSupportEmail, sendSupport, SUPPORT_TOPICS, type SupportTopic } from '@/lib/support'
import { radius, spacing, TARGET, useTheme } from '@/theme'

/** What the "Sent with your message" row says: everything attached, in plain words (the API's support route adds the server half). */
export const ATTACHED =
  'Your .skr name, the app version, your phone model, your linked wallets and the last few errors Sprouts saw. Never your keys or seed phrase.'

/**
 * 11-01 (his ask, draft v1 approved, email required by his ruling): one message to the team. Replies come by email only; nothing comes
 * back into the app, so the email is required. Opened from Settings > Help, and from the link screen with the topic picked (?topic=link).
 */
export default function Support() {
  const { colors } = useTheme()
  const params = useLocalSearchParams<{ topic?: string }>()
  const [topic, setTopic] = useState<SupportTopic | null>(isTopic(params.topic) ? params.topic : null)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(readSupportEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

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
      await sendSupport({ topic, message, email })
      setSentTo(email.trim())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send it just now. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <Screen back title="Message us">
        <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl * 2 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="check" size={36} color={colors.onAccent} />
          </View>
          <ThemedText variant="heading" accessibilityRole="header">
            Message sent
          </ThemedText>
          <ThemedText tone="secondary" style={{ textAlign: 'center' }}>
            {`Thanks. We will reply to ${sentTo}, usually within a day.`}
          </ThemedText>
          <Button title="Done" onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: spacing.lg }} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen back title="Message us">
      <ThemedText tone="secondary">Tell us what happened. We reply by email, usually within a day.</ThemedText>

      <ThemedText variant="label">What is it about?</ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {SUPPORT_TOPICS.map((t) => {
          const on = t.value === topic
          return (
            <Pressable
              key={t.value}
              onPress={() => setTopic(on ? null : t.value)}
              accessibilityRole="button"
              accessibilityLabel={t.label}
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
                {t.label}
              </ThemedText>
            </Pressable>
          )
        })}
      </View>

      <ThemedText variant="label">Your message</ThemedText>
      <TextInput
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={MESSAGE_MAX}
        placeholder="What were you trying to do?"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Your message"
        editable={!busy}
        textAlignVertical="top"
        style={{ ...field, minHeight: 120 }}
      />

      <ThemedText variant="label">Your email</ThemedText>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Your email, for our reply"
        editable={!busy}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        style={{ ...field, minHeight: TARGET }}
      />
      <ThemedText variant="caption" tone="secondary">
        Only used to reply to you.
      </ThemedText>

      <View>
        <Disclosure title="Sent with your message" first>
          {ATTACHED}
        </Disclosure>
      </View>

      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
      <Button title="Send" loading={busy} disabled={!canSend(message, email)} onPress={send} />
      <ThemedText variant="caption" tone="secondary">
        Sprouts will never ask for your seed phrase or ask you to sign anything by email.
      </ThemedText>
    </Screen>
  )
}
