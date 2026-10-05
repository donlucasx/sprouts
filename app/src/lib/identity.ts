import type { AppIdentity } from "@wallet-ui/react-native-kit";

/** How the app names itself to the wallet (Mobile Wallet Adapter); the domain wallets check (R87: sprouts.money). */
// The icon (MWA: a path relative to uri) is the k6b brand mark the API serves; without it wallets fall back to the site's icon.
export const identity: AppIdentity = { name: "Sprouts", uri: "https://sprouts.money", icon: "/icon-192.png" };
