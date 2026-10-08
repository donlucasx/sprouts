import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { sessionMock, shareMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(async (): Promise<{ token: string } | null> => ({ token: 'tok' })),
  shareMock: vi.fn(async (_c: unknown, _o?: unknown) => ({ action: 'sharedAction' })),
}))
vi.mock('@/lib/session', () => ({ loadSession: () => sessionMock() }))
vi.mock('react-native', () => ({ Share: { share: (c: unknown, o?: unknown) => shareMock(c, o) } }))
import { fetchTaxCsv, exportTaxCsv } from '@/lib/tax-export'
import { ApiError } from '@/lib/api'

const CSV = 'Date,Sent Amount\r\n2026-01-01 00:00:00,1.00\r\n'
let fetchMock: ReturnType<typeof vi.fn>
const answer = (status: number, body: string, headers: Record<string, string> = {}) => {
  fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status, headers }))
  vi.stubGlobal('fetch', fetchMock)
}
beforeEach(() => { sessionMock.mockClear(); shareMock.mockClear() })
afterEach(() => vi.unstubAllGlobals())

describe('fetchTaxCsv', () => {
  it('sends the session bearer, passes the year, returns the text and the served filename', async () => {
    answer(200, CSV, { 'content-disposition': 'attachment; filename="sprouts-tax-2026-2026-10-08.csv"' })
    const r = await fetchTaxCsv(2026)
    expect(r).toEqual({ csv: CSV, filename: 'sprouts-tax-2026-2026-10-08.csv' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/export\/tax\?year=2026$/)
    expect((init as RequestInit).headers).toEqual({ authorization: 'Bearer tok' })
  })
  it('no year: no query, and a fallback filename when none is served', async () => {
    answer(200, CSV)
    const r = await fetchTaxCsv()
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/export\/tax$/)
    expect(r.filename).toBe('sprouts-tax-all.csv')
  })
  it("an error answer carries the API's sentence; no session never fetches", async () => {
    answer(400, JSON.stringify({ error: 'year must be four digits, like 2026.' }))
    await expect(fetchTaxCsv(26)).rejects.toMatchObject({ status: 400, message: 'year must be four digits, like 2026.' })
    sessionMock.mockResolvedValueOnce(null)
    answer(200, CSV)
    await expect(fetchTaxCsv()).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('exportTaxCsv', () => {
  it('opens the share sheet with the CSV text and the filename', async () => {
    answer(200, CSV, { 'content-disposition': 'attachment; filename="sprouts-tax-all-2026-10-08.csv"' })
    const r = await exportTaxCsv()
    expect(r).toEqual({ filename: 'sprouts-tax-all-2026-10-08.csv', action: 'sharedAction' })
    expect(shareMock).toHaveBeenCalledWith({ message: CSV, title: 'sprouts-tax-all-2026-10-08.csv' }, expect.objectContaining({ dialogTitle: 'sprouts-tax-all-2026-10-08.csv' }))
  })
})
