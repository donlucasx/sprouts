import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = new Map<string, string | number>()
const post = vi.hoisted(() => vi.fn())
vi.mock('@/lib/store', () => ({
  store: {
    getString: (k: string) => (typeof mem.get(k) === 'string' ? mem.get(k) : undefined),
    getNumber: (k: string) => (typeof mem.get(k) === 'number' ? mem.get(k) : undefined),
    set: (k: string, v: string | number) => void mem.set(k, v),
  },
}))
vi.mock('@/lib/api', () => ({ api: post }))
import { QUESTIONS, cardsFor, removedAskFor, countHomeVisit, dismiss, homeVisits, readDismissed, sendFeedback } from '@/lib/feedback'

const msg = { id: 'm1', heading: 'From Lucas', body: 'Thanks', action: 'message_us' as const }
const removed = { question: 'wallet_removed' as const, ref: 'W:2026-11-01' }
const brought = { question: 'brought_you' as const, ref: 'brought_you' }

describe('cardsFor (0.1.9 Task 5)', () => {
  it('shows the message until its id is dismissed', () => {
    expect(cardsFor({ message: msg }, [], 1).message).toEqual(msg)
    expect(cardsFor({ message: msg }, ['m1'], 1).message).toBeNull()
  })
  it('brought_you waits for the second visit', () => {
    expect(cardsFor({ ask: brought }, [], 1).ask).toBeNull()
    expect(cardsFor({ ask: brought }, [], 2).ask).toEqual(brought)
  })
  it('Home shows one card: From Lucas first, brought_you only once it is closed (his 11-08 note: two cards = too cluttered)', () => {
    expect(cardsFor({ message: msg, ask: brought }, [], 5)).toEqual({ message: msg, ask: null })
    expect(cardsFor({ message: msg, ask: brought }, ['m1'], 5)).toEqual({ message: null, ask: brought })
  })
  it('wallet_removed never shows on Home; Settings shows it under Linked wallets (his 11-08 ruling)', () => {
    expect(cardsFor({ ask: removed }, [], 5).ask).toBeNull()
    expect(removedAskFor({ ask: removed }, [])).toEqual(removed)
    expect(removedAskFor({ ask: removed }, [removed.ref])).toBeNull()
    expect(removedAskFor({ ask: brought }, [])).toBeNull()
    expect(removedAskFor(null, [])).toBeNull()
    expect(removedAskFor({ ask: { question: 'wallet_removed' } as never }, [])).toBeNull()
  })
  it('hides a dismissed ask ref', () => {
    expect(cardsFor({ ask: brought }, ['brought_you'], 5).ask).toBeNull()
  })
  it('drops an unknown question or a malformed message instead of crashing the card', () => {
    expect(cardsFor({ ask: { question: 'x', ref: 'r' } as never }, [], 9).ask).toBeNull()
    expect(cardsFor({ ask: { question: 'constructor', ref: 'r' } as never }, [], 9).ask).toBeNull()
    expect(cardsFor({ ask: { question: 'toString', ref: 'r' } as never }, [], 9).ask).toBeNull()
    expect(cardsFor({ ask: { question: 'wallet_removed' } as never }, [], 9).ask).toBeNull()
    expect(cardsFor({ message: {} as never }, [], 9).message).toBeNull()
  })
  it('null or an old me (fields absent) gives no cards', () => {
    expect(cardsFor(null, [], 9)).toEqual({ message: null, ask: null })
    expect(cardsFor({}, [], 9)).toEqual({ message: null, ask: null })
    expect(cardsFor({ message: null, ask: null }, [], 9)).toEqual({ message: null, ask: null })
  })
})

describe('local state', () => {
  beforeEach(() => mem.clear())
  it('dismissals persist and do not duplicate', () => {
    expect(readDismissed()).toEqual([])
    dismiss('a')
    dismiss('a')
    dismiss('b')
    expect(readDismissed()).toEqual(['a', 'b'])
  })
  it('a corrupt dismissed list reads as empty', () => {
    mem.set('feedback.dismissed', '{nope')
    expect(readDismissed()).toEqual([])
  })
  it('counts a home visit at most once per local day', () => {
    expect(homeVisits()).toBe(0)
    countHomeVisit(new Date(2026, 10, 8, 9))
    countHomeVisit(new Date(2026, 10, 8, 21))
    expect(homeVisits()).toBe(1)
    countHomeVisit(new Date(2026, 10, 9, 8))
    expect(homeVisits()).toBe(2)
  })
})

describe('sendFeedback', () => {
  beforeEach(() => post.mockReset())
  it('posts question, ref, choice and trimmed text', async () => {
    post.mockResolvedValue({})
    await sendFeedback('wallet_removed', 'testing', '  hi ', 'W:2026-11-01')
    expect(post).toHaveBeenCalledWith('/api/feedback', { method: 'POST', body: { question: 'wallet_removed', ref: 'W:2026-11-01', choice: 'testing', text: 'hi' } })
  })
  it('omits empty text and absent ref', async () => {
    post.mockResolvedValue({})
    await sendFeedback('link_failed', 'other', '  ', undefined)
    expect(post.mock.calls[0][1].body).toEqual({ question: 'link_failed', choice: 'other' })
  })
  it('lets a failure through so the card stays', async () => {
    post.mockRejectedValueOnce(new Error('x'))
    const out = await sendFeedback('brought_you', 'looking', undefined, 'brought_you').then(() => 'resolved', (e: Error) => e.message)
    expect(out).toBe('x')
  })
})

describe('QUESTIONS', () => {
  it('has the copy labels and the API values, in order', () => {
    expect(QUESTIONS.link_failed.title).toBe('What happened?')
    expect(QUESTIONS.link_failed.options).toEqual([
      { value: 'backed_out', label: 'I backed out' },
      { value: 'closed_itself', label: 'The screen closed by itself' },
      { value: 'warning_worried', label: 'The approval warning worried me' },
      { value: 'other', label: 'Something else' },
    ])
    expect(QUESTIONS.wallet_removed.title).toBe('Before you go: why did you remove it?')
    expect(QUESTIONS.wallet_removed.options).toEqual([
      { value: 'testing', label: 'I just wanted to test it' },
      { value: 'approval', label: "I didn't like the approval" },
      { value: 'not_planting', label: "It wasn't planting" },
      { value: 'need_usdc', label: 'I need the USDC for something else' },
      { value: 'other', label: 'Something else' },
    ])
    expect(QUESTIONS.brought_you.title).toBe('What brought you to Sprouts?')
    expect(QUESTIONS.brought_you.options).toEqual([
      { value: 'skr_staking', label: 'Staking and unstaking SKR' },
      { value: 'roundups', label: 'Round-up savings' },
      { value: 'looking', label: 'Just looking around' },
      { value: 'other', label: 'Something else' },
    ])
  })
})
