import { currentLang, type Lang } from './index'

/**
 * 0.1.13 Spanish pass P1: every number, money amount, percent, date and time the app shows goes through here, and follows the
 * current language. Hand-rolled on purpose (no Intl for numbers or dates: Hermes support on Android devices is partial).
 * English output is exactly what the app showed before ("$1,234.50", "0.5%", "Oct 5, 7:11 AM"). Spanish (his ruling 11-25):
 * "$1.234,50", "0,5%", "5 oct, 14:05", 24-hour clock. Every function takes an optional `lang`, default currentLang().
 */

const MONTHS_SHORT: Record<Lang, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}
const MONTHS_LONG: Record<Lang, readonly string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
}
const WEEKDAYS_SHORT: Record<Lang, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
}
const WEEKDAYS_LONG: Record<Lang, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
}

/** Month name for a 0-based month index. */
export const monthName = (m0: number, long = false, lang: Lang = currentLang()): string => (long ? MONTHS_LONG : MONTHS_SHORT)[lang][m0]
/** Weekday name for a 0-based day (0 = Sunday, like Date.getDay()). */
export const weekdayName = (d0: number, long = false, lang: Lang = currentLang()): string => (long ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[lang][d0]
/** The weekday of a date in the phone's zone: "Wed" / "mié", or long "Wednesday" / "miércoles". */
export const weekday = (d: Date, long = false, lang: Lang = currentLang()): string => weekdayName(d.getDay(), long, lang)

// ---- numbers ----

const sepOf = (lang: Lang) => (lang === 'es' ? { group: '.', dec: ',' } : { group: ',', dec: '.' })

/** The decimal separator: "." in English, "," in Spanish. */
export const decimalSeparator = (lang: Lang = currentLang()): string => sepOf(lang).dec

/** A coin amount's whole part grouped by thousands and its decimals kept, "12980.46" -> "12,980.46" (es "12.980,46"). Takes the plain "123.45" string. */
export function groupedNumber(n: string, lang: Lang = currentLang()): string {
  const { group, dec } = sepOf(lang)
  const neg = n.startsWith('-')
  const [whole, frac] = (neg ? n.slice(1) : n).split('.')
  const g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return `${neg ? '-' : ''}${frac === undefined ? g : `${g}${dec}${frac}`}`
}
/** A number at a fixed count of decimals, grouped: (12980.456, 2) -> "12,980.46" (es "12.980,46"). */
export const fixedNumber = (n: number, places: number, lang: Lang = currentLang()): string => groupedNumber(n.toFixed(places), lang)
/** A plain decimal with a localized separator and no grouping: "0.5" -> "0,5" in es. */
export const decimalNumber = (n: number, places: number, lang: Lang = currentLang()): string => n.toFixed(places).replace('.', sepOf(lang).dec)
/** A percent: (0.5, 1) -> "0.5%" (es "0,5%"). `places` default 1. */
export const percent = (n: number, places = 1, lang: Lang = currentLang()): string => `${decimalNumber(n, places, lang)}%`

/** Dollars from integer cents: "$11,407.00", "-$1.00"; es "$11.407,00", "-$1,00". */
export function usdFromCents(cents: number, lang: Lang = currentLang()): string {
  const { group, dec } = sepOf(lang)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return `${sign}$${dollars}${dec}${String(abs % 100).padStart(2, '0')}`
}
/** Like usdFromCents, but whole dollars drop the cents: "$5", "$5.25" (es "$5,25"). */
export function usdTrimmed(cents: number, lang: Lang = currentLang()): string {
  return Math.round(cents) % 100 === 0 ? usdFromCents(cents, lang).replace(/[.,]00$/, '') : usdFromCents(cents, lang)
}

// ---- times and dates (the phone's zone unless a timeZone is passed, for tests) ----

/** The year/month/day of an instant, in the phone's zone, or in `timeZone` when one is passed. */
function ymd(d: Date, timeZone?: string): { y: number; m0: number; d: number } {
  if (!timeZone) return { y: d.getFullYear(), m0: d.getMonth(), d: d.getDate() }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d)
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { y: pick('year'), m0: pick('month') - 1, d: pick('day') }
}

/** The time of day: en "7:11 AM", es 24-hour "7:11" ("14:05"). */
export function timeOfDay(d: Date, lang: Lang = currentLang()): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return lang === 'es' ? `${h}:${m}` : `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}
/** The clock short: en "7 AM" on the hour, "7:30 AM" otherwise; es "7:00", "7:30". */
export function clockShort(d: Date, lang: Lang = currentLang()): string {
  const h = d.getHours()
  const m = d.getMinutes()
  if (lang === 'es') return `${h}:${String(m).padStart(2, '0')}`
  return `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`} ${h < 12 ? 'AM' : 'PM'}`
}
/** The hour only, as the staking withdrawals show it: en "3 PM", es "15:00". */
function hourOnly(d: Date, lang: Lang): string {
  const h = d.getHours()
  return lang === 'es' ? `${h}:00` : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

/** Day and month: en "Oct 5", es "5 oct". Pass a zone for a fixed one (tests). */
export function dayMonth(d: Date, lang: Lang = currentLang(), timeZone?: string): string {
  const p = ymd(d, timeZone)
  return dayMonthParts(p.m0, p.d, lang)
}
/** The same from a month index and day number (the API's own day, read as given). */
export const dayMonthParts = (m0: number, day: number, lang: Lang = currentLang()): string =>
  lang === 'es' ? `${day} ${MONTHS_SHORT.es[m0]}` : `${MONTHS_SHORT.en[m0]} ${day}`
/** Day, month and year: en "Nov 7, 2026", es "7 nov 2026". */
export function dayMonthYear(d: Date, lang: Lang = currentLang(), timeZone?: string): string {
  const p = ymd(d, timeZone)
  return dayMonthYearParts(p.y, p.m0, p.d, lang)
}
export const dayMonthYearParts = (y: number, m0: number, day: number, lang: Lang = currentLang()): string =>
  lang === 'es' ? `${day} ${MONTHS_SHORT.es[m0]} ${y}` : `${MONTHS_SHORT.en[m0]} ${day}, ${y}`
/** The full date as a screen reader says it: en "October 3, 2025", es "3 de octubre de 2025". */
export const dayMonthYearLong = (y: number, m0: number, day: number, lang: Lang = currentLang()): string =>
  lang === 'es' ? `${day} de ${MONTHS_LONG.es[m0]} de ${y}` : `${MONTHS_LONG.en[m0]} ${day}, ${y}`
/** An Activity row's when: en "Oct 5, 7:11 AM", es "5 oct, 7:11". */
export const dayTimeOf = (d: Date, lang: Lang = currentLang()): string => `${dayMonth(d, lang)}, ${timeOfDay(d, lang)}`
/** A withdrawal's arrival: en "Oct 4, 3 PM", es "4 oct, 15:00". */
export const dayHourOf = (d: Date, lang: Lang = currentLang()): string => `${dayMonth(d, lang)}, ${hourOnly(d, lang)}`
