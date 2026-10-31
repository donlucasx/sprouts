import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
import { ApiError } from '@/lib/api'
import { SignRefused } from '@/lib/sign'
import { linkFailure, reportLinkFailure } from '@/lib/link-report'

describe('link failure reports (what the server cannot see)', () => {
  it('names a dropped wallet session, a decline and the app refusing to sign', () => {
    expect(linkFailure('sign', new Error('java.util.concurrent.CancellationException'))?.reason).toBe('dropped')
    expect(linkFailure('sign', Object.assign(new Error('x'), { code: 'ERROR_ASSOCIATION_CANCELLED' }))?.reason).toBe('declined')
    expect(linkFailure('sign', new SignRefused('not the approval Sprouts built'))).toMatchObject({ step: 'sign', reason: 'refused', error: 'SignRefused: not the approval Sprouts built' })
    expect(linkFailure('confirm', new TypeError('Network request failed'), 'W')).toMatchObject({ reason: 'other', wallet: 'W' })
  })

  it('an API answer is left to the route that gave it, and the error is cut at 200 characters', () => {
    expect(linkFailure('approval', new ApiError(409, 'linked elsewhere'))).toBeNull()
    expect(linkFailure('sign', new Error('y'.repeat(500)))!.error).toHaveLength(200)
  })

  it('a report that fails is swallowed', async () => {
    const post = vi.fn(async () => { throw new Error('offline') })
    expect(() => reportLinkFailure(post, 'sign', new Error('z'))).not.toThrow()
    await Promise.resolve()
    expect(post).toHaveBeenCalledOnce()
    reportLinkFailure(post, 'approval', new ApiError(500, 'x'))
    expect(post).toHaveBeenCalledOnce()
  })
})
