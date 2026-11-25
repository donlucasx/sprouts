/**
 * Every line the app shows in English: the source of truth. Spanish (es.ts) mirrors these keys; a key missing there shows this line.
 * Keys read as screen.thing. Placeholders are {name}.
 */
export const en = {
  'settings.language': 'Language',
  'settings.language.auto': 'Automatic (phone)',
  'settings.language.en': 'English',
  'settings.language.es': 'Español',
} as const

export type Key = keyof typeof en
