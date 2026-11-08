import { store } from './store'
import type { MeResponse } from './api'

/** 0.1.9 (his ruling): no reminder between 8 PM and 9 AM on the phone's own clock, and at most one a local day. */
export const QUIET_START_HOUR = 20
export const QUIET_END_HOUR = 9
const IDS = 'reminders.shownIds'
const DAY = 'reminders.lastShownDay'
const KEEP = 50

type Reminder = NonNullable<MeResponse['reminder']>

/** YYYY-MM-DD in the phone's zone. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The server's reminder if this phone may show it now: switch on, outside quiet hours, none yet today, id not shown before. An old API sends none. */
export function reminderToShow(
  r: MeResponse['reminder'] | undefined,
  s: { shownIds: string[]; lastShownDay: string | null; now: Date; on: boolean },
): Reminder | null {
  if (!r || !s.on) return null
  const h = s.now.getHours()
  if (h >= QUIET_START_HOUR || h < QUIET_END_HOUR) return null
  if (s.lastShownDay === localDay(s.now)) return null
  if (s.shownIds.includes(r.id)) return null
  return r
}

export function readReminderState(): { shownIds: string[]; lastShownDay: string | null } {
  let shownIds: string[] = []
  try {
    const v = JSON.parse(store.getString(IDS) ?? '[]')
    if (Array.isArray(v)) shownIds = v.filter((x): x is string => typeof x === 'string')
  } catch {}
  return { shownIds, lastShownDay: store.getString(DAY) ?? null }
}

export function recordReminderShown(id: string, now: Date): void {
  const ids = [...readReminderState().shownIds.filter((x) => x !== id), id].slice(-KEEP)
  store.set(IDS, JSON.stringify(ids))
  store.set(DAY, localDay(now))
}

/** A tapped notification opens only these two screens; anything else in its data is ignored. */
export function routeForNotification(data: unknown): '/connect' | '/home' | null {
  const route = (data as { route?: unknown } | null | undefined)?.route
  return route === '/connect' || route === '/home' ? route : null
}

/** Which notification response to act on: each id once, and one seen while signed out is spent (a later sign-in must not replay it). */
export function tapDecision(id: string, lastHandled: string | null, signedIn: boolean): { handled: string | null; go: boolean } {
  if (id === lastHandled) return { handled: lastHandled, go: false }
  return { handled: id, go: signedIn }
}
