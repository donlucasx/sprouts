import { Redirect } from 'expo-router'
import { WelcomeView } from './index'

/** Dev builds only: the Welcome screen while signed in, for screenshots of the sign-in design (10-07). Release builds redirect. */
export default function DevWelcome() {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return <Redirect href="/" />
  return <WelcomeView />
}
