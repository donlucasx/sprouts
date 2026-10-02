import { ThemedText } from './ThemedText'

/** The one line beside the garden (spec 6): Body text, under 25 words, spoken as Sprouts (manual 5: the AI lines are running text). */
export function WatcherLine({ text }: { text: string }) {
  return <ThemedText style={{ flex: 1 }}>{text}</ThemedText>
}
