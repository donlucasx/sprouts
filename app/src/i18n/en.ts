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
  // 11-25 (his rulings on the store-review themes): how it works, and the link fee, on Link a wallet
  'link.step.1': 'Link a wallet that has a little USDC.',
  'link.step.2': 'Swap like you normally do.',
  'link.step.3': 'Sprouts rounds up each swap and plants the change once a day.',
  'link.fees': 'Linking and unlinking each cost a small Solana network fee. Sprouts gets none of it.',
  'link.cant.send': "Can't send your money anywhere else",
  'link.cant.touch': "Can't touch other tokens or sell your garden",
  'promise.public': 'Even if our server is hacked, neither it nor the AI can move more than your daily round-up (max $5), and only into your own savings, less a 0.5% fee.',
  // 11-25 (his ruling "Name both"): the top-up swap is free; the planting carries the fee
  'topup.fee': "Sprouts takes 0.5% when it's planted.",
  // 11-25 (his ruling "Point to SOL instead"; Kimi: the real split share, only when SOL covers the amount and costs less)
  'topup.solCheaper': 'Your split plants {pct}% of it back into {symbol}, so SOL costs less.',
  // 11-24: Activity names the coin that paid; a top-up recorded before 11-24 has no coin
  'activity.topup.coin': 'From {coin} in this wallet.',
  'activity.topup.coinNamed': 'From {coin} in your {wallet}.',
  'activity.topup.plain': 'From this wallet.',
  'activity.topup.plainNamed': 'From your {wallet}.',
  // 0.1.13 Plant my SKR (his rulings 11-25, verbatim): the SKR coin sheet's section, the marker, the top-up's line, Activity's row
  'plant.title': 'Plant my SKR',
  'plant.instead': 'Plant my SKR instead',
  // build-written: what TalkBack says for the seed marker on the SKR row and plant card
  'plant.marker': 'SKR you can plant',
  'plant.all': 'All',
  'plant.amount': '{amount} SKR (about ${usd})',
  'plant.button': 'Plant {amount} SKR',
  'plant.line': 'Stakes this SKR in your garden, where it earns staking rewards. Taking it out later takes 48 hours.',
  // the steps as the top-up says them (build-written); done and sent are his (11-25); no fee wording
  'plant.waiting': 'Waiting for your wallet.',
  'plant.checking': 'Approved. Checking the chain.',
  'plant.done': 'Planted {amount} SKR. Your garden updates within a minute.',
  'plant.sent': 'Not confirmed yet. Check your SKR plant in a minute before trying again.',
  'plant.failedBefore': 'Could not start planting. Nothing moved. Try again.',
  'activity.planted': 'Planted {amount} SKR',
  'activity.planted.from': 'From this wallet.',
} as const

export type Key = keyof typeof en
