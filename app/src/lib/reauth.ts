import { transact, stringToUint8Array, type AppIdentity } from "@wallet-ui/react-native-kit";
import { getAddressCodec, getBase64Encoder } from "@solana/kit";
import type { SignInFn } from "./signin";

/**
 * A sign-in for inside the app (raising the daily limit, resuming a wallet; R84): one wallet session, one authorize with the
 * sign-in payload and NO saved auth token, the same request the first sign-in makes. The kit's own signIn sends the saved token
 * with the payload, which Solflare declines ("-1/authorization request failed"), and its retry in the same session is declined
 * too (Saga, 09-29). The kit's saved authorization is left as it was; transactions keep using it.
 */
export function freshWalletSignIn(identity: AppIdentity): SignInFn {
  return async (payload) => await transact(async (wallet) => {
    const result = await wallet.authorize({ chain: "solana:mainnet", identity, sign_in_payload: payload });
    if (!result.sign_in_result) throw new Error("Sign in result not retrieved.");
    const address = getAddressCodec().decode(getBase64Encoder().encode(result.accounts[0].address));
    return {
      account: { address },
      signature: stringToUint8Array(result.sign_in_result.signature),
      signedMessage: stringToUint8Array(result.sign_in_result.signed_message),
    };
  });
}
