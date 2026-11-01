import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { kv } = vi.hoisted(() => ({ kv: new Map<string, string>() }))
vi.mock('@/lib/session', () => ({ loadSession: async () => ({ token: 'tok' }) }))
vi.mock('@/lib/store', () => ({ store: { getString: (k: string) => kv.get(k), set: (k: string, v: string) => kv.set(k, v) } }))
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.8' } } }))
vi.mock('react-native', () => ({ Platform: { OS: 'android', constants: { Model: 'Seeker' } } }))

import { canSend, isTopic, looksLikeEmail, readSupportEmail, sendSupport } from '@/lib/support'

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
    await sendSupport({ topic: 'link', message: '  nothing happened  ', email: ' mo@proton.me ' })
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
})
