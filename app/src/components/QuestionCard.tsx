import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Card } from './Card'
import { Button } from './Button'
import { ThemedText } from './ThemedText'
import { QUESTIONS, TEXT_MAX, sendFeedback, type Question } from '@/lib/feedback'
import { radius, spacing, TARGET, useTheme } from '@/theme'

/**
 * One optional question (copy D/E): the options as chips (the support screen's pattern), an optional "Tell us more", Send and Skip.
 * `onDone` fires after a successful Send and on Skip; the caller dismisses the card then. A failed Send keeps the card and says so.
 * brought_you has no free text line (copy E).
 */
export function QuestionCard(p: { question: Question; askRef?: string; onDone: () => void; onMessageUs?: () => void }) {
  const { colors } = useTheme()
  const q = QUESTIONS[p.question]
  const [choice, setChoice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!choice) return
    setBusy(true)
    setError(null)
    try {
      await sendFeedback(p.question, choice, p.question === 'brought_you' ? undefined : text, p.askRef)
      p.onDone()
    } catch {
      setError('Could not send it. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
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
      {error ? <ThemedText style={{ color: colors.error }}>{error}</ThemedText> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title="Send" onPress={() => void send()} disabled={!choice} loading={busy} style={{ flex: 1 }} />
        <Button title="Skip" kind="quiet" onPress={p.onDone} disabled={busy} />
      </View>
      {/* 11-08 (link screen): a way to a real conversation, plain "Message us" (his note: not "Want a reply?") */}
      {p.onMessageUs ? <Button title="Message us" kind="quiet" onPress={p.onMessageUs} disabled={busy} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  )
}
