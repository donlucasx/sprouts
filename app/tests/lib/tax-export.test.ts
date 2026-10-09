import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { sessionMock, shareMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(async (): Promise<{ token: string } | null> => ({ token: 'tok' })),
  shareMock: vi.fn(async (_c: unknown, _o?: unknown) => ({ action: 'sharedAction' })),
}))
vi.mock('@/lib/session', () => ({ loadSession: () => sessionMock() }))
const written: { name: string; text: string }[] = []
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    name: string
    uri: string
    constructor(_dir: string, name: string) { this.name = name; this.uri = `file:///cache/${name}` }
    create() {}
    write(text: string) { written.push({ name: this.name, text }) }
  },
}))
vi.mock('expo-sharing', () => ({ shareAsync: (u: unknown, o?: unknown) => shareMock(u, o) }))
import { fetchTaxCsv, prepareTaxCsv, shareTaxCsv, taxFileFresh, TAX_FILE_FRESH_MS } from '@/lib/tax-export'
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

describe('prepareTaxCsv then shareTaxCsv (R463: request, notify, download)', () => {
  it('prepare writes the whole history as a .csv file without sharing; share opens that file', async () => {
    answer(200, CSV, { 'content-disposition': 'attachment; filename="sprouts-tax-all-2026-10-08.csv"' })
    const f = await prepareTaxCsv()
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/export\/tax$/)
    expect(f).toMatchObject({ uri: 'file:///cache/sprouts-tax-all-2026-10-08.csv', filename: 'sprouts-tax-all-2026-10-08.csv' })
    expect(taxFileFresh(f)).toBe(true)
    expect(taxFileFresh(f, f.madeAt + TAX_FILE_FRESH_MS)).toBe(false)
    expect(taxFileFresh(null)).toBe(false)
    expect(written.at(-1)).toEqual({ name: 'sprouts-tax-all-2026-10-08.csv', text: CSV })
    expect(shareMock).not.toHaveBeenCalled()
    await shareTaxCsv(f)
    expect(shareMock).toHaveBeenCalledWith('file:///cache/sprouts-tax-all-2026-10-08.csv', expect.objectContaining({ mimeType: 'text/csv' }))
  })
})
