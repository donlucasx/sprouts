/** Days are UTC dates, "YYYY-MM-DD": one cron run is one day everywhere, and the snapshot and decision tables key on it. */
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const daysBetween = (a: string, b: string): number => Math.round((ms(b) - ms(a)) / 86_400_000);
export const addDays = (day: string, n: number): string => new Date(ms(day) + n * 86_400_000).toISOString().slice(0, 10);
