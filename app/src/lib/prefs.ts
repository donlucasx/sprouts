import { store } from './store'
import { parseAppearance, type Appearance } from '@/theme/appearance'
import type { NoticeKind } from './notices'

/** The preferences on this phone (R153, R161), in the same store as the last read: the appearance and one switch per notice. */
const APPEARANCE = 'prefs.appearance'
/** "plantings" keeps the key R153 shipped, so a switch already turned off stays off. */
const NOTIFY_KEY: Record<NoticeKind, string> = {
  plantings: 'prefs.notifyPlantings',
  withdrawals: 'prefs.notifyWithdrawals',
  manager: 'prefs.notifyManager',
  limit: 'prefs.notifyLimit',
}

export function readAppearance(): Appearance {
  return parseAppearance(store.getString(APPEARANCE))
}
const appearanceListeners = new Set<() => void>()
/** For the theme hook (useSyncExternalStore): every write tells the listeners, so the colours follow the choice at once. */
export function subscribeAppearance(listener: () => void): () => void {
  appearanceListeners.add(listener)
  return () => void appearanceListeners.delete(listener)
}
export function writeAppearance(a: Appearance) {
  store.set(APPEARANCE, a)
  for (const l of appearanceListeners) l()
}
/** Every notice defaults to on. */
export function readNotify(kind: NoticeKind): boolean {
  return store.getBoolean(NOTIFY_KEY[kind]) ?? true
}
export function writeNotify(kind: NoticeKind, on: boolean) {
  store.set(NOTIFY_KEY[kind], on)
}
