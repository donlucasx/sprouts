import { useEffect, useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Card } from './Card'
import { Button } from './Button'
import { ThemedText } from './ThemedText'
import { QUESTIONS, TEXT_MAX, sendFeedback, type Question } from '@/lib/feedback'
import { SUPPORT_LOG_KEY } from '@/lib/support'
import { useQueryClient } from '@tanstack/react-query'
import { radius, spacing, TARGET, useTheme } from '@/theme'

/**
 * One optional question (copy D/E): the options as chips (the support screen's pattern), an optional "Tell us more", Send and Skip.
 * `onDone` fires after a successful Send and on Skip; the caller dismisses the card then. A failed Send keeps the card and says so.
 * brought_you has no free text line (copy E).
 */
/** 11-08 (his note: no confirmation on screen): how long "Message sent" stays before the card closes itself. */
export const SENT_SHOWN_MS = 2500
/** Longer when it shows a reference, so there is time to read it (it is also listed in Help). */
export const SENT_WITH_REF_MS = 4000

export function QuestionCard(p: { question: Question; askRef?: string; onDone: () => void }) {
  const { colors } = useTheme()
  const q = QUESTIONS[p.question]
  const [choice, setChoice] = useState<string | null>(null)
  const [text, setText] = useState('')
  // 11-08 (his ask): an optional email so Lucas can reply; without one an answer has no way back to the user
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  // 11-08 (his ask): the answer's reference, shown under "Message sent" and listed in Settings > Help > Message us
  const [sentRef, setSentRef] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!choice) return
    setBusy(true)
    setError(null)
    try {
      const ref = await sendFeedback(p.question, choice, p.question === 'brought_you' ? undefined : text, p.askRef, p.question === 'brought_you' ? undefined : email)
      setSentRef(ref)
      setSent(true)
      if (ref) void queryClient.invalidateQueries({ queryKey: SUPPORT_LOG_KEY })
    } catch {
      setError('Could not send it. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  // Callers pass a new onDone each render (Home re-renders often); the timer reads the latest through a ref so it starts once.
  const doneRef = useRef(p.onDone)
  doneRef.current = p.onDone
  useEffect(() => {
    if (!sent) return
    const t = setTimeout(() => doneRef.current(), sentRef ? SENT_WITH_REF_MS : SENT_SHOWN_MS)
    return () => clearTimeout(t)
  }, [sent, sentRef])

  if (sent) {
    return (
      <Card>
        <ThemedText variant="heading">Message sent</ThemedText>
        {sentRef ? (
          <ThemedText tone="secondary" numeric>
            Reference {sentRef}
          </ThemedText>
        ) : null}
      </Card>
    )
  }

  return (
    <Card>
      <ThemedText variant="heading">{q.title}</ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {q.options.map((o) => {
          const on = o.value === choice
          return (
            <Pressable
              key={o.value}
              onPress={() => setChoice(on ? null : o.value)}
              accessibilityRole="button"
              accessibilityLabel={o.label}
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
                {o.label}
              </ThemedText>
            </Pressable>
          )
        })}
      </View>
      {p.question !== 'brought_you' ? (
        <TextInput
          value={text}
          onChangeText={setText}
          maxLength={TEXT_MAX}
          multiline
          placeholder="Tell us more"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Tell us more"
          editable={!busy}
          textAlignVertical="top"
          style={{
            fontFamily: 'AlbertSans_400Regular',
            fontSize: 16,
            lineHeight: 22,
            color: colors.text,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: radius.md,
            padding: spacing.md,
            minHeight: TARGET,
          }}
        />
      ) : null}
      {p.question !== 'brought_you' ? (
        <TextInput
          value={email}
          onChangeText={setEmail}
          maxLength={254}
          placeholder="Your email, if you'd like a reply"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Your email, if you'd like a reply"
          editable={!busy}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            fontFamily: 'AlbertSans_400Regular',
            fontSize: 16,
            color: colors.text,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: radius.md,
            padding: spacing.md,
            minHeight: TARGET,
          }}
        />
      ) : null}
      {error ? <ThemedText style={{ color: colors.error }}>{error}</ThemedText> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title="Send" onPress={() => void send()} disabled={!choice} loading={busy} style={{ flex: 1 }} />
        <Button title="Skip" kind="quiet" onPress={p.onDone} disabled={busy} />
      </View>
    </Card>
  )
}
