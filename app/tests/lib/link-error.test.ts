import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
import { ApiError } from '@/lib/api'
import { SignRefused } from '@/lib/sign'
import { showStillStuck, linkErrorView } from '@/lib/link-error'

const CLOSED = { title: 'Seed Vault closed before approving', body: 'Nothing was sent. Tap Try again and press Approve on the next screen.', ask: true }

describe('linkErrorView (copy C)', () => {
  it('a dropped wallet session gets the Seed Vault copy and the question', () => {
    expect(linkErrorView(new Error('java.util.concurrent.CancellationException'))).toEqual(CLOSED)
  })
  it('a declined request gets the same copy', () => {
    expect(linkErrorView(Object.assign(new Error('x'), { code: 'ERROR_ASSOCIATION_CANCELLED' }))).toEqual(CLOSED)
  })
  it('an ApiError or SignRefused keeps its own message and does not ask', () => {
    expect(linkErrorView(new ApiError(409, 'Already linked.'))).toEqual({ title: '', body: 'Already linked.', ask: false })
    expect(linkErrorView(new SignRefused('not the approval Sprouts built'))).toEqual({ title: '', body: 'not the approval Sprouts built', ask: false })
  })
  it('anything else keeps today\'s text', () => {
    expect(linkErrorView(new Error('boom'))).toEqual({ title: '', body: 'The approval did not go through. Try again.', ask: false })
    expect(linkErrorView('x')).toEqual({ title: '', body: 'The approval did not go through. Try again.', ask: false })
  })
})

describe('showStillStuck (his 11-08 Saga note)', () => {
  it('stays hidden after the first failure and shows from the second', () => {
    expect(showStillStuck(0)).toBe(false)
    expect(showStillStuck(1)).toBe(false)
    expect(showStillStuck(2)).toBe(true)
    expect(showStillStuck(5)).toBe(true)
  })
})
