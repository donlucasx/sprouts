import type { AppIdentity } from "@wallet-ui/react-native-kit";

/** How the app names itself to the wallet (Mobile Wallet Adapter); the domain wallets check (R87: sprouts.money). */
export const identity: AppIdentity = { name: "Sprouts", uri: "https://sprouts.money" };
