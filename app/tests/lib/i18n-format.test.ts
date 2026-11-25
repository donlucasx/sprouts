import { describe, it, expect } from 'vitest'
import {
  clockShort, dayHourOf, dayMonth, dayMonthYear, dayMonthYearLong, dayTimeOf, decimalNumber, fixedNumber, groupedNumber, monthName, percent,
  timeOfDay, usdFromCents, usdTrimmed, weekday, weekdayName,
} from '@/i18n/format'
import { formatUsd, formatSkr, formatAsOf, dayTime, dayLabel, arrivalLine, holdingAmount } from '@/lib/format'
import { dayHeader, spokenLabel } from '@/model/activity'
import { nextRunLabel } from '@/lib/next-planting'
import { writeLangChoice } from '@/i18n'

// 0.1.13 Spanish pass P1 (his ruling 11-25): Spanish numbers are "$1.234,50" and "0,5%"; English output stays exactly as before.
describe('money', () => {
  it('English is unchanged', () => {
    const table: [number, string][] = [[0, '$0.00'], [5, '$0.05'], [42, '$0.42'], [-100, '-$1.00'], [123450, '$1,234.50'], [100000000, '$1,000,000.00'], [1727, '$17.27'], [99999, '$999.99'], [100000, '$1,000.00']]
    for (const [c, out] of table) expect(usdFromCents(c, 'en')).toBe(out)
  })
  it('Spanish uses dot grouping and a decimal comma', () => {
    const table: [number, string][] = [[0, '$0,00'], [42, '$0,42'], [-100, '-$1,00'], [123450, '$1.234,50'], [100000000, '$1.000.000,00'], [99999, '$999,99'], [100000, '$1.000,00']]
    for (const [c, out] of table) expect(usdFromCents(c, 'es')).toBe(out)
  })
  it('rounds half up to the cent in both', () => {
    expect(usdFromCents(10.5, 'en')).toBe('$0.11')
    expect(usdFromCents(10.5, 'es')).toBe('$0,11')
    expect(usdFromCents(10.4, 'es')).toBe('$0,10')
  })
  it('trimmed drops cents on whole dollars only', () => {
    expect(usdTrimmed(500, 'en')).toBe('$5')
    expect(usdTrimmed(525, 'en')).toBe('$5.25')
    expect(usdTrimmed(525, 'es')).toBe('$5,25')
    expect(usdTrimmed(500, 'es')).toBe('$5')
    expect(usdTrimmed(200000, 'es')).toBe('$2.000')
  })
})

describe('numbers and percents', () => {
  it('grouping and decimals', () => {
    expect(groupedNumber('12980.46', 'en')).toBe('12,980.46')
    expect(groupedNumber('12980.46', 'es')).toBe('12.980,46')
    expect(groupedNumber('1240', 'es')).toBe('1.240')
    expect(groupedNumber('-1234567.5', 'es')).toBe('-1.234.567,5')
    expect(fixedNumber(0.0215, 4, 'es')).toBe('0,0215')
    expect(fixedNumber(12980.456, 2, 'en')).toBe('12,980.46')
    expect(decimalNumber(0.5, 1, 'es')).toBe('0,5')
  })
  it('percent', () => {
    expect(percent(0.5, 1, 'en')).toBe('0.5%')
    expect(percent(0.5, 1, 'es')).toBe('0,5%')
    expect(percent(12.34, 1, 'es')).toBe('12,3%')
    expect(percent(12.34, 1, 'en')).toBe('12.3%')
    expect(percent(4.567, 2, 'es')).toBe('4,57%')
    expect(percent(5, 0, 'es')).toBe('5%')
  })
})

describe('dates and times', () => {
  const d = new Date(2026, 11, 3, 14, 5) // Dec 3 2026, 2:05 PM phone-local; a Thursday
  const am = new Date(2026, 9, 5, 7, 11)
  const mid = new Date(2026, 9, 5, 0, 24)
  it('English keeps AM/PM and "Mon D"', () => {
    expect(timeOfDay(d, 'en')).toBe('2:05 PM')
    expect(timeOfDay(am, 'en')).toBe('7:11 AM')
    expect(timeOfDay(mid, 'en')).toBe('12:24 AM')
    expect(clockShort(new Date(2026, 9, 5, 7, 0), 'en')).toBe('7 AM')
    expect(clockShort(new Date(2026, 9, 5, 19, 30), 'en')).toBe('7:30 PM')
    expect(dayMonth(d, 'en')).toBe('Dec 3')
    expect(dayMonthYear(d, 'en')).toBe('Dec 3, 2026')
    expect(dayTimeOf(am, 'en')).toBe('Oct 5, 7:11 AM')
    expect(dayHourOf(new Date(2026, 9, 4, 15, 40), 'en')).toBe('Oct 4, 3 PM')
    expect(dayMonthYearLong(2025, 9, 3, 'en')).toBe('October 3, 2025')
  })
  it('Spanish is 24-hour with day first and lowercase months', () => {
    expect(timeOfDay(d, 'es')).toBe('14:05')
    expect(timeOfDay(am, 'es')).toBe('7:11')
    expect(clockShort(new Date(2026, 9, 5, 7, 0), 'es')).toBe('7:00')
    expect(dayMonth(d, 'es')).toBe('3 dic')
    expect(dayMonthYear(d, 'es')).toBe('3 dic 2026')
    expect(dayTimeOf(d, 'es')).toBe('3 dic, 14:05')
    expect(dayHourOf(new Date(2026, 9, 4, 15, 40), 'es')).toBe('4 oct, 15:00')
    expect(dayMonthYearLong(2025, 9, 3, 'es')).toBe('3 de octubre de 2025')
  })
  it('weekday and month names', () => {
    expect(weekday(d, true, 'es')).toBe('jueves')
    expect(weekday(d, false, 'es')).toBe('jue')
    expect(weekday(d, true, 'en')).toBe('Thursday')
    expect(weekdayName(3, true, 'es')).toBe('miércoles')
    expect(monthName(0, false, 'es')).toBe('ene')
    expect(monthName(8, true, 'es')).toBe('septiembre')
  })
  it('a fixed zone gives the same day on any phone', () => {
    const at = new Date('2026-11-08T03:00:00Z')
    expect(dayMonthYear(at, 'en', 'America/Los_Angeles')).toBe('Nov 7, 2026')
    expect(dayMonthYear(at, 'es', 'America/Los_Angeles')).toBe('7 nov 2026')
  })
})

describe('the app helpers follow the language', () => {
  it('English, then Spanish, through the same functions', () => {
    writeLangChoice('en')
    expect(formatUsd(123450)).toBe('$1,234.50')
    expect(formatSkr(266_000_000n, 0.01833)).toBe('266.00 SKR ($4.88)')
    expect(dayTime('2026-10-05T14:11:34.294Z')).toBe('Oct 5, 7:11 AM')
    expect(dayLabel('2026-10-05')).toBe('Oct 5')
    expect(holdingAmount({ asset: 'SKR', heldRaw: '12980460000', valueUsd: 1234.5 } as never)).toBe('12,980.46 SKR ($1,234.50)')
    expect(formatAsOf(new Date('2026-09-20T09:41:00-07:00'), new Date('2026-09-28T16:41:00-07:00'))).toBe('as of Sep 20')
    expect(nextRunLabel(new Date('2026-10-05T10:00:00Z'))).toBe('Today, 7 AM')
    expect(dayHeader('2025-12-30', new Date(2026, 9, 5))).toBe('Dec 30, 2025')
    expect(spokenLabel({ key: 'k', ts: '2026-10-03T20:00:00Z', label: 'L', amount: '$1.00', details: [], signature: null })).toBe('October 3, 2026, 1:00 PM, L, $1.00')
    expect(arrivalLine(new Date('2026-10-04T22:00:00Z'), new Date('2026-10-03T12:00:00Z'))).toBe('arrives Oct 4, 3 PM')
    writeLangChoice('es')
    try {
      expect(formatUsd(123450)).toBe('$1.234,50')
      expect(formatSkr(266_000_000n, 0.01833)).toBe('266,00 SKR ($4,88)')
      expect(dayTime('2026-10-05T21:11:34.294Z')).toBe('5 oct, 14:11')
      expect(dayLabel('2026-10-05')).toBe('5 oct')
      expect(holdingAmount({ asset: 'SKR', heldRaw: '12980460000', valueUsd: 1234.5 } as never)).toBe('12.980,46 SKR ($1.234,50)')
      expect(formatAsOf(new Date('2026-09-20T09:41:00-07:00'), new Date('2026-09-28T16:41:00-07:00'))).toBe('as of 20 sep')
      expect(nextRunLabel(new Date('2026-10-05T10:00:00Z'))).toBe('Today, 7:00')
      expect(dayHeader('2025-12-30', new Date(2026, 9, 5))).toBe('30 dic 2025')
      expect(spokenLabel({ key: 'k', ts: '2026-10-03T20:00:00Z', label: 'L', amount: '$1,00', details: [], signature: null })).toBe('3 de octubre de 2026, 13:00, L, $1,00')
      expect(arrivalLine(new Date('2026-10-04T22:00:00Z'), new Date('2026-10-03T12:00:00Z'))).toBe('arrives 4 oct, 15:00')
    } finally {
      writeLangChoice('auto')
    }
  })
})
