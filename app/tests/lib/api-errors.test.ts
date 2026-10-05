import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
import { api, ApiError, API_UNANSWERED } from '@/lib/api'

const answer = (status: number, body: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    return e as ApiError
  }
  throw new Error('did not throw')
}
afterEach(() => vi.unstubAllGlobals())

describe('api(): an error body that is not JSON', () => {
  it('a Vercel timeout page becomes the unknown-outcome sentence, never "Nothing moved."', async () => {
    answer(504, '<html><body>An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT</body></html>')
    const e = await failure(api('/api/moves/confirm', { method: 'POST', auth: false }))
    expect(e).toBeInstanceOf(ApiError)
    expect(e.status).toBe(504)
    expect(e.message).toBe("Sprouts didn't answer. Check Home in a minute.")
    expect(e.message).not.toContain('Nothing moved')
    expect(API_UNANSWERED).toBe(e.message)
  })
  it('an empty error body is the same sentence for a 5xx, and the plain one for a 4xx', async () => {
    answer(502, '')
    expect((await failure(api('/x', { auth: false }))).message).toBe(API_UNANSWERED)
    answer(404, '')
    expect((await failure(api('/x', { auth: false }))).message).toBe('Request failed (404).')
  })
  it('a 200 with a non-JSON body is also unanswered', async () => {
    answer(200, 'not json')
    expect((await failure(api('/x', { auth: false }))).message).toBe(API_UNANSWERED)
  })
  it('a dropped connection is the unknown-outcome sentence too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed') }))
    const e = await failure(api('/x', { auth: false }))
    expect(e).toBeInstanceOf(ApiError)
    expect(e.message).toBe(API_UNANSWERED)
  })
  it('a valid JSON error is unchanged, and carries its body', async () => {
    answer(409, JSON.stringify({ error: 'Back in your wallet.', partial: true, unwrapTransaction: 'AAA' }))
    const e = await failure(api('/x', { auth: false }))
    expect(e.status).toBe(409)
    expect(e.message).toBe('Back in your wallet.')
    expect(e.body).toEqual({ error: 'Back in your wallet.', partial: true, unwrapTransaction: 'AAA' })
  })
  it('a valid JSON success is returned', async () => {
    answer(200, '{"ok":1}')
    expect(await api('/x', { auth: false })).toEqual({ ok: 1 })
  })
})
