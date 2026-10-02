import { store } from './me'
import { parseAppearance, type Appearance } from '@/theme/appearance'

/** Two preferences on this phone (R153), in the same store as the last read: the appearance and whether a landed planting is announced. */
const APPEARANCE = 'prefs.appearance'
const NOTIFY = 'prefs.notifyPlantings'

export function readAppearance(): Appearance {
  return parseAppearance(store.getString(APPEARANCE))
}
export function writeAppearance(a: Appearance) {
  store.set(APPEARANCE, a)
}
export function readNotifyPlantings(): boolean {
  return store.getBoolean(NOTIFY) ?? true
}
export function writeNotifyPlantings(on: boolean) {
  store.set(NOTIFY, on)
}
