import { api, type MeResponse } from './api'
import { freshSignIn, type SignInFn } from './signin'

export type PauseAnswer = {
  paused: boolean
  wallets: { pubkey: string; status: MeResponse['wallets'][number]['status'] }[]
}

/** The switch on Home (R147): off pauses every linked wallet with the session; on asks the Seeker once and resumes them all. */
export async function setPaused(paused: boolean, signIn: SignInFn): Promise<PauseAnswer> {
  const reauth = paused ? undefined : await freshSignIn(signIn)
  return api<PauseAnswer>('/api/pause', { method: 'POST', body: { paused, ...(reauth ? { reauth } : {}) } })
}
