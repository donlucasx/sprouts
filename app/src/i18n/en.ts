/**
 * Every line the app shows in English: the source of truth. Spanish (es.ts) mirrors these keys; a key missing there shows this line.
 * Keys read as screen.thing. Placeholders are {name}.
 */
export const en = {
  'settings.language': 'Language',
  'settings.language.auto': 'Automatic (phone)',
  'settings.language.en': 'English',
  'settings.language.es': 'Español',
  // 0.1.13 step 3 (his copy, 11-25): the wallet approval, said as the last step before the wallet opens
  'link.approval.title': 'One approval, then round-ups run on their own',
  'link.approval.body': 'Your wallet will ask you to approve "unlimited USDC" so Sprouts can round up every swap without asking you to sign each time. Our on-chain program only lets Sprouts move up to $5 a day into your own account, less a 0.5% fee. Revoke it any time.',
  'link.approval.continue': 'Continue to wallet',
  'link.approval.back': 'Back',
  // 11-25 (his ruling: "less a 0.5% fee"; CAN as two lines)
  'link.can.plants': 'Plants up to $5 of USDC a day into your own savings',
  'link.can.fee': 'Takes 0.5% per planting',
  'link.cant.send': "Can't send your money anywhere else",
  'link.cant.touch': "Can't touch other tokens or sell your garden",
  'promise.public': 'Even if our server is hacked, neither it nor the AI can move more than your daily round-up (max $5), and only into your own savings, less a 0.5% fee.',
  // 11-25 (his ruling "Name both"): the top-up swap is free; the planting carries the fee
  'topup.fee': "No fee on the swap. Sprouts takes 0.5% when it's planted.",
  // 11-25 (his ruling "Point to SOL instead"; Kimi: the real split share, only when SOL covers the amount and costs less)
  'topup.solCheaper': 'Your split plants {pct}% of it back into {symbol}, so SOL costs less.',
  // 11-24: Activity names the coin that paid; a top-up recorded before 11-24 has no coin
  'activity.topup.coin': 'From {coin} in this wallet. No Sprouts fee.',
  'activity.topup.coinNamed': 'From {coin} in your {wallet}. No Sprouts fee.',
  'activity.topup.plain': 'From this wallet. No Sprouts fee.',
  'activity.topup.plainNamed': 'From your {wallet}. No Sprouts fee.',
} as const

export type Key = keyof typeof en
