// Test stub (0.1.13 i18n): the phone's locale is English unless a test sets it.
export const stub = { languageCode: 'en' as string | null }
export const getLocales = () => [{ languageCode: stub.languageCode, languageTag: stub.languageCode ?? 'und' }]
