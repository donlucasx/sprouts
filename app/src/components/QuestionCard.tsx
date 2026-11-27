'use no memo' // 11-27: this file's lines are read in the current language at render; the React Compiler would cache them (i18n/useLang)
import { useEffect, useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Card } from './Card'
import { Button } from './Button'
import { ThemedText } from './ThemedText'
import { optionLabel, QUESTIONS, questionTitle, TEXT_MAX, sendFeedback, type Question } from '@/lib/feedback'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'
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
  useLang()
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
      setError(t('ask.sendFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Callers pass a new onDone each render (Home re-renders often); the timer reads the latest through a ref so it starts once.
  const doneRef = useRef(p.onDone)
  doneRef.current = p.onDone
  useEffect(() => {
    if (!sent) return
    const timer = setTimeout(() => doneRef.current(), sentRef ? SENT_WITH_REF_MS : SENT_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [sent, sentRef])

  if (sent) {
    return (
      <Card>
        <ThemedText variant="heading">{t('support.sent')}</ThemedText>
        {sentRef ? (
          <ThemedText tone="secondary" numeric>
            {t('support.ref', { ref: sentRef })}
          </ThemedText>
        ) : null}
      </Card>
    )
  }

  return (
    <Card>
      <ThemedText variant="heading">{questionTitle(p.question)}</ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {q.options.map((o) => {
          const on = o.value === choice
          return (
            <Pressable
              key={o.value}
              onPress={() => setChoice(on ? null : o.value)}
              accessibilityRole="button"
              accessibilityLabel={optionLabel(p.question, o.value)}
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
                {optionLabel(p.question, o.value)}
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
          placeholder={t('ask.more')}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('ask.more')}
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
          placeholder={t('ask.email')}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('ask.email')}
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
        <Button title={t('support.send')} onPress={() => void send()} disabled={!choice} loading={busy} style={{ flex: 1 }} />
        <Button title={t('ask.skip')} kind="quiet" onPress={p.onDone} disabled={busy} />
      </View>
    </Card>
  )
}
