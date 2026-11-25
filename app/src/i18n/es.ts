import type { Key } from './en'

/** Spanish. Lucas reviews every line before release (his ruling 11-24). Missing keys fall back to English. */
export const es: Partial<Record<Key, string>> = {
  'settings.language': 'Idioma',
  'settings.language.auto': 'Automático (teléfono)',
  'settings.language.en': 'English',
  'settings.language.es': 'Español',
}
