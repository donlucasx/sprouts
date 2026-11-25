import { en } from '@/i18n/en'
import { t, type Lang } from '@/i18n'
/** Copy pass 11-20 (founder-reviewed draft, Kimi copy audit): the precise guarantee in plain words, the hacked line moved here from the
 *  Link a wallet card. Deltas from spec 6.2: "leg" is "coin", "leaves" is "arrives", the re-link precondition is its own paragraph,
 *  remainders moved to What does it cost?. "or replace the program" stays (Kimi item 2, matches the Terms).
 *  0.1.13: the English constants are read from en.ts (drift tests and /faqs keep them); the screen renders aboutSprouts() in its language. */
export const PRECISE_GUARANTEE = en['about.guarantee']

/** R299: where the admin key lives. Goes stale when the key moves to Squads. */
export const ADMIN_KEY_LINE = en['about.adminKey']

/** Contracts 2.6 and R324: where the program's prices come from and cbBTC's looser age. */
export const PRICE_LINE = en['about.prices']

/** R452 (10-08): About Sprouts = how it works, then six questions. Copy pass 11-20: the draft's wording. */
export const HOW_IT_WORKS = en['about.how']

/** The cost answer's first paragraph; /faqs says it word for word (settings-copy.test.ts checks). */
export const COST_LINE = en['about.cost']

/** The six questions and their answers in `lang` (default: the current one). Paragraphs are whole sentences joined by a blank line. */
export function disclosures(lang?: Lang): [string, string][] {
  const l = (k: Parameters<typeof t>[0]) => t(k, undefined, lang)
  return [
    [l('about.who.title'), `${l('about.who.where')}\n\n${l('about.guarantee')} ${l('about.adminKey')} ${l('about.prices')}\n\n${l('about.who.trust')}\n\n${l('about.who.session')}`],
    [l('about.cost.title'), `${l('about.cost')}\n\n${l('about.cost.rent')}\n\n${l('about.cost.leftovers')}`],
    [l('about.lending.title'), l('about.lending.body')],
    [l('about.earned.title'), l('about.earned.body')],
    [l('about.buy.title'), `${l('ore.disclosure')} ${l('about.buy.coins')}\n\n${l('about.buy.manager')}`],
    [l('about.pause.title'), l('about.pause.body')],
  ]
}

export const DISCLOSURES: [string, string][] = disclosures('en')

/** The line under the questions (R452: "Not advice" became the footer). */
export const NOT_ADVICE = en['about.notAdvice']

export const VENUES_EMPTY = en['venues.empty']
