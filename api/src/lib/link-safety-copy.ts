/**
 * His ask 10-28 ("can we use the same copy / format for the disclosure that appears under the code box on the /link website page?"):
 * the app's Link a wallet lines, said the same way under the code box on /link and on /faqs (safety.tsx Safety; his
 * note 10-28: "match it so the messaging is always the same"). The app keeps its own copy in
 * app/src/lib/safety-copy.ts; app/tests/lib/safety-copy.test.ts fails if the two drift.
 */
// 11-25 (his ruling): three steps, the same as the app's Link a wallet.
export const LINK_STEPS: readonly string[] = ["Link a wallet that has a little USDC.", "Swap like you normally do.", "Sprouts rounds up each swap and plants the change once a day."];

// 11-25 (his ruling): two lines, the fee named.
export const CAN: readonly string[] = ["Plants up to $5 of USDC a day into your own savings", "Takes 0.5% per planting"];

export const CANT: readonly string[] = [
  "Can't send your money anywhere else",
  "Can't touch other tokens or sell your garden",
];

/** The wallet's "unlimited USDC" warning, said before the wallet says it (10-27; shortened 10-28 so the title fits one line on the Seeker). */
// 0.1.13 step 3 (his copy, 11-25), the same words as the app's last step before the wallet opens.
export const APPROVAL_WARN_TITLE = "One approval, then round-ups run on their own";
export const APPROVAL_WARN_BODY = "Your wallet will ask you to approve \"unlimited USDC\" so Sprouts can round up every swap without asking you to sign each time. Our on-chain program only lets Sprouts move up to $5 a day into your own account, less a 0.5% fee. Revoke it any time.";

/** The heading over the can / can't card on /link (the app's link.safety.heading). */
export const SAFETY_HEADING = "What Sprouts can and can't do";

/**
 * 0.1.13 Spanish pass P9: the same lines in Spanish, for /link and /faqs when the browser prefers Spanish. They are the app's es
 * lines word for word (app/src/i18n/es.ts link.*); app/tests/lib/safety-copy.test.ts fails if the two drift.
 */
export const SAFETY_ES = {
  heading: "Lo que Sprouts puede y no puede hacer",
  steps: ["Vincula una billetera que tenga algo de USDC.", "Haz swaps como siempre.", "Sprouts redondea cada swap y planta el cambio una vez al día."],
  can: ["Planta hasta $5 de USDC al día en tus propios ahorros", "Cobra 0,5% por plantación"],
  cant: ["No puede enviar tu dinero a ningún otro lugar", "No puede tocar otros tokens ni vender tu jardín"],
  warnTitle: "Una aprobación y los redondeos van solos",
  warnBody: "Tu billetera te pedirá aprobar \"USDC ilimitado\" para que Sprouts pueda redondear cada swap sin pedirte que firmes cada vez. Nuestro programa on-chain solo deja que Sprouts mueva hasta $5 al día a tu propia cuenta, menos una comisión del 0,5%. Revócalo cuando quieras.",
} as const;

/** The safety lines in one language: English is the constants above, exactly. */
export function safetyCopy(lang: "en" | "es") {
  return lang === "es"
    ? { heading: SAFETY_ES.heading, steps: SAFETY_ES.steps as readonly string[], can: SAFETY_ES.can as readonly string[], cant: SAFETY_ES.cant as readonly string[], warnTitle: SAFETY_ES.warnTitle, warnBody: SAFETY_ES.warnBody }
    : { heading: SAFETY_HEADING, steps: LINK_STEPS, can: CAN, cant: CANT, warnTitle: APPROVAL_WARN_TITLE, warnBody: APPROVAL_WARN_BODY };
}
