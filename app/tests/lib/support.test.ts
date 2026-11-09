import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { kv } = vi.hoisted(() => ({ kv: new Map<string, string>() }))
vi.mock('@/lib/session', () => ({ loadSession: async () => ({ token: 'tok' }) }))
vi.mock('@/lib/store', () => ({ store: { getString: (k: string) => kv.get(k), set: (k: string, v: string) => kv.set(k, v) } }))
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.8' } } }))
vi.mock('react-native', () => ({ Platform: { OS: 'android', constants: { Model: 'Seeker' } } }))

import { canSend, fetchSupportLog, isTopic, logLine, looksLikeEmail, previewOf, readSupportEmail, sendSupport } from '@/lib/support'

beforeEach(() => kv.clear())
afterEach(() => vi.unstubAllGlobals())

describe('Message us', () => {
  it('Send needs a message and an email that looks like one', () => {
    expect(canSend('help', 'mo@proton.me')).toBe(true)
    expect(canSend('   ', 'mo@proton.me')).toBe(false)
    expect(canSend('help', '')).toBe(false)
    expect(canSend('help', 'mo@proton')).toBe(false)
    expect(canSend('x'.repeat(2001), 'mo@proton.me')).toBe(false)
    expect(looksLikeEmail(' mo@proton.me ')).toBe(true)
  })

  it('only the five topics pass (a link screen param that is anything else opens with none picked)', () => {
    expect(isTopic('link')).toBe(true)
    expect(isTopic('refund')).toBe(false)
    expect(isTopic(undefined)).toBe(false)
  })

  it('sends the trimmed message, the email and the app line, then remembers the email on the phone', async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(readSupportEmail()).toBe('')
    const fetchRef = fetchMock
    fetchRef.mockImplementationOnce(async () => new Response('{"ok":true,"ref":"S-7K3Q"}', { status: 200 }))
    expect(await sendSupport({ topic: 'link', message: '  nothing happened  ', email: ' mo@proton.me ' })).toBe('S-7K3Q')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/support$/)
    expect(JSON.parse(String(init?.body))).toEqual({ topic: 'link', message: 'nothing happened', email: 'mo@proton.me', app: { version: '0.1.8', device: 'Seeker' } })
    expect(readSupportEmail()).toBe('mo@proton.me')
  })

  it('a refused send does not remember the email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"You have sent 5 messages today."}', { status: 429 })))
    await expect(sendSupport({ topic: null, message: 'x', email: 'a@b.co' })).rejects.toThrow(/5 messages today/)
    expect(readSupportEmail()).toBe('')
  })

  it('the log: the API rows as they come, an older server (no GET) just has none', async () => {
    const rows = [{ ref: 'S-7K3Q', ts: '2026-11-01T22:56:53Z', topic: 'link', preview: 'Phantom opened' }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: rows }), { status: 200 })))
    expect(await fetchSupportLog()).toEqual(rows)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect(await fetchSupportLog()).toEqual([])
  })

  it("a log row's first line: reference, day, topic; a message from before references just skips it", () => {
    expect(logLine({ ref: 'S-7K3Q', ts: '2026-11-01T20:00:00Z', topic: 'link', preview: '' })).toBe('S-7K3Q \u00b7 Nov 1 \u00b7 Linking a wallet')
    expect(logLine({ ref: null, ts: '2026-11-01T20:00:00Z', topic: null, preview: '' })).toBe('Nov 1')
    // 11-08: an answer with a reference reads by its question, and its choice stands in for an empty note
    const answer = { ref: 'S-ABCD', ts: '2026-11-08T20:00:00Z', topic: 'link_failed', preview: '', choice: 'warning_worried' }
    expect(logLine(answer)).toBe('S-ABCD \u00b7 Nov 8 \u00b7 What happened?')
    expect(previewOf(answer)).toBe('The approval warning worried me')
    expect(previewOf({ ...answer, preview: 'the warning' })).toBe('The approval warning worried me: the warning')
    expect(previewOf({ ref: 'S-7K3Q', ts: '2026-11-01T20:00:00Z', topic: 'link', preview: 'hi' })).toBe('hi')
  })
})
