import type { Key } from './en'

/** Spanish. Lucas reviews every line before release (his ruling 11-24). Missing keys fall back to English. */
export const es: Partial<Record<Key, string>> = {
  'settings.language': 'Idioma',
  'settings.language.auto': 'Automático (teléfono)',
  'settings.language.en': 'English',
  'settings.language.es': 'Español',
  'link.approval.title': 'Una aprobación y los redondeos van solos',
  'link.approval.body': 'Tu wallet te pedirá aprobar "USDC ilimitado" para que Sprouts pueda redondear cada swap sin pedirte que firmes cada vez. Nuestro programa on-chain solo deja que Sprouts mueva hasta $5 al día a tu propia cuenta, menos una comisión del 0,5%. Revócalo cuando quieras.',
  'link.approval.continue': 'Continuar a la wallet',
  'link.approval.back': 'Volver',
  'link.can.plants': 'Planta hasta $5 de USDC al día en tus propios ahorros',
  'link.can.fee': 'Cobra 0,5% por plantación',
  'promise.public': 'Aunque hackeen nuestro servidor, ni él ni la IA pueden mover más que tu redondeo diario (máx. $5), y solo a tus propios ahorros, menos una comisión del 0,5%.',
  'topup.fee': 'El swap no tiene comisión. Sprouts cobra 0,5% al plantar.',
  'topup.solCheaper': 'Tu reparto vuelve a plantar el {pct}% en {symbol}, así que SOL cuesta menos.',
  'activity.topup.coin': 'Desde {coin} en esta wallet. Sin comisión de Sprouts.',
  'activity.topup.coinNamed': 'Desde {coin} en tu {wallet}. Sin comisión de Sprouts.',
  'activity.topup.plain': 'Desde esta wallet. Sin comisión de Sprouts.',
  'activity.topup.plainNamed': 'Desde tu {wallet}. Sin comisión de Sprouts.',
}
