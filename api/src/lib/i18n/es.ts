/**
 * 0.1.13 Spanish pass P9: the server's Spanish. Lucas reviews every line before release (his ruling 11-24); the review list is
 * research/new/2026-11-25-spanish-review-list.md (P9 table). Neutral Latin American Spanish, tú; glossary: billetera, swap, Agregar,
 * redondeo, plantar / plantación, jardín, canasta, plataforma (venue), comisión, vincular, revocar. No em dashes.
 *
 * ES_ERRORS: for each API_ERROR_CODES code, the English sentence(s) that code is sent with -> the Spanish. A key with {slots} is a
 * template matched against the English the route built; numbers in numeric slots are re-formatted Spanish style ($1.234,50, 0,5%).
 * An English sentence with no entry here is sent in English (the fallback). tests/lib/i18n.test.ts checks every key is a sentence
 * the server really sends. Ops, cron and webhook answers have no Spanish: no app shows them.
 */
export const ES_ERRORS = {
  // ---- Shared ----
  sign_in_first: {
    "Sign in first.": "Primero inicia sesión.",
  },
  bad_request: {
    "Bad request.": "Solicitud no válida.",
    "Bad request: {field}.": "Solicitud no válida: {field}.",
  },
  rate_limited: {
    "Too many requests. Try again in a minute.": "Demasiadas solicitudes. Inténtalo de nuevo en un minuto.",
    "Wait a minute and send it again.": "Espera un minuto y vuelve a enviarlo.",
    "Too many tries. Wait a minute, then try again.": "Demasiados intentos. Espera un minuto y vuelve a intentarlo.",
  },
  daily_limit: {
    "That is enough answers for today. Thank you.": "Ya son suficientes respuestas por hoy. Gracias.",
    "That is enough for today. The controls below still work.": "Es suficiente por hoy. Los controles de abajo siguen funcionando.",
    "You have sent 5 messages today. We read them all and will reply by email.": "Hoy enviaste 5 mensajes. Los leemos todos y te responderemos por correo.",
  },
  reauth_required: {
    "Raising your daily limit asks your Seeker to sign in again.": "Para subir tu límite diario, tu Seeker debe iniciar sesión de nuevo.",
    "Turning Sprouts back on asks your Seeker to sign in again.": "Para volver a activar Sprouts, tu Seeker debe iniciar sesión de nuevo.",
    "Resuming a wallet asks your Seeker to sign in again.": "Para reanudar una billetera, tu Seeker debe iniciar sesión de nuevo.",
    "That sign-in is for another Seeker.": "Ese inicio de sesión es de otro Seeker.",
    "The sign-in did not verify. Try again.": "No se pudo verificar el inicio de sesión. Inténtalo de nuevo.",
    "This sign-in request expired. Try again.": "Esta solicitud de inicio de sesión expiró. Inténtalo de nuevo.",
  },
  bad_address: {
    "That does not look like a Solana address.": "Eso no parece una dirección de Solana.",
  },
  bad_transaction: {
    "That is not a transaction.": "Eso no es una transacción.",
    "This transaction uses a lookup table Sprouts did not build.": "Esta transacción usa una tabla de búsqueda que Sprouts no armó.",
    "This transaction was not built for this wallet.": "Esta transacción no fue creada para esta billetera.",
    "The wallet has not signed this transaction.": "La billetera no firmó esta transacción.",
    "This transaction touches a program Sprouts does not use.": "Esta transacción toca un programa que Sprouts no usa.",
  },
  wrong_transaction: {
    "That cancel is for another position.": "Esa cancelación es de otra posición.",
    "That is not a cancel.": "Eso no es una cancelación.",
    "That is not a withdrawal.": "Eso no es un retiro.",
    "That is not an unstake.": "Eso no es un retiro de staking.",
    "That unstake is for another position.": "Ese retiro de staking es de otra posición.",
    "That withdrawal is not the one Sprouts built.": "Ese retiro no es el que armó Sprouts.",
    "That move is not the one Sprouts built. Try the move again.": "Ese movimiento no es el que armó Sprouts. Vuelve a intentar el movimiento.",
    "This approval is for another delegation. Get a new code in the app, then try again.": "Esta aprobación es de otra delegación. Pide un código nuevo en la app y vuelve a intentarlo.",
    "This approval is not the one Sprouts asked for. Nothing was linked; get a new code in the app.": "Esta aprobación no es la que pidió Sprouts. No se vinculó nada; pide un código nuevo en la app.",
    "This revoke is for another delegation.": "Esta revocación es de otra delegación.",
    "This approval is not the Sprouts re-link.": "Esta aprobación no es la nueva vinculación de Sprouts.",
    "This is not a Sprouts SKR planting, so nothing was sent.": "Esta no es una plantación de SKR de Sprouts, así que no se envió nada.",
    "Could not start planting. Nothing moved. Try again.": "No se pudo empezar a plantar. No se movió nada. Inténtalo de nuevo.",
    "This is not a Sprouts top-up, so nothing was sent.": "Este no es un swap a USDC de Sprouts, así que no se envió nada.",
    "Could not start the top-up. Nothing moved. Try again.": "No se pudo empezar el swap a USDC. No se movió nada. Inténtalo de nuevo.",
  },
  tx_failed: {
    "The move failed on chain. Nothing moved.": "El movimiento falló on-chain. No se movió nada.",
    "The withdrawal failed on chain. Nothing moved.": "El retiro falló on-chain. No se movió nada.",
    "The revoke failed on chain.": "La revocación falló on-chain.",
    "The cancel failed on chain. The basket stands.": "La cancelación falló on-chain. La canasta sigue igual.",
    "The planting failed on chain. Your SKR stayed in your wallet.": "La plantación falló on-chain. Tu SKR se quedó en tu billetera.",
    "The swap failed on chain. Your SOL stayed in your wallet, less the network fee.": "El swap falló on-chain. Tu SOL se quedó en tu billetera, menos la comisión de red.",
    "The swap failed on chain. Your coins stayed in your wallet, less the network fee.": "El swap falló on-chain. Tus monedas se quedaron en tu billetera, menos la comisión de red.",
  },
  tx_expired: {
    "It did not go through. Nothing moved. Try again.": "No se completó. No se movió nada. Inténtalo de nuevo.",
    "It did not go through. Nothing changed. Try again.": "No se completó. No cambió nada. Inténtalo de nuevo.",
    "It did not go through. Your SKR is still in the basket. Try again.": "No se completó. Tu SKR sigue en la canasta. Inténtalo de nuevo.",
    "The top-up did not go through. Nothing moved. Try again.": "El swap a USDC no se completó. No se movió nada. Inténtalo de nuevo.",
  },
  still_waiting: {
    "It may still go through. Check Activity in a minute before you try again.": "Todavía puede completarse. Revisa Actividad en un minuto antes de volver a intentarlo.",
    "It may still go through. Check the basket in a minute before you try again.": "Todavía puede completarse. Revisa la canasta en un minuto antes de volver a intentarlo.",
    "It may still go through. Check Settings in a minute before you try again.": "Todavía puede completarse. Revisa Ajustes en un minuto antes de volver a intentarlo.",
  },
  chain_catching_up: {
    "The chain has not shown the withdrawal yet. Check again in a minute.": "La blockchain aún no muestra el retiro. Vuelve a revisar en un minuto.",
    "The chain still shows the basket. Check again in a minute.": "La blockchain todavía muestra la canasta. Vuelve a revisar en un minuto.",
    "The chain still shows the delegation. Check again in a minute.": "La blockchain todavía muestra la delegación. Vuelve a revisar en un minuto.",
  },
  venue_unreadable: {
    "Could not read the venue just now. Try again in a minute.": "No se pudo leer la plataforma en este momento. Inténtalo de nuevo en un minuto.",
  },
  pool_full: {
    "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.": "Una plataforma puede pausar los retiros cuando su fondo está prestado por completo; tu dinero sigue siendo tuyo.",
  },
  // ---- Sign-in ----
  bad_signature: {
    "Bad signature.": "Firma no válida.",
  },
  signature_invalid: {
    "The signature did not verify.": "No se pudo verificar la firma.",
  },
  nonce_expired: {
    "This sign-in request expired. Try again.": "Esta solicitud de inicio de sesión expiró. Inténtalo de nuevo.",
  },
  no_genesis_token: {
    "This wallet holds no Genesis Token. The vault needs a Seeker or a Saga.": "Esta billetera no tiene un Genesis Token. Hace falta un Seeker o un Saga.",
  },
  phone_registered: {
    "This phone is already registered.": "Este teléfono ya está registrado.",
  },
  // ---- Link a wallet ----
  code_unknown: {
    "This code is unknown, expired or already used.": "Este código no existe, expiró o ya se usó.",
  },
  code_not_fetched: {
    "Fetch the approval for this code first.": "Primero obtén la aprobación para este código.",
  },
  code_other_wallet: {
    "This code was already used with another wallet. Get a new code in the app, then try again.": "Este código ya se usó con otra billetera. Pide un código nuevo en la app y vuelve a intentarlo.",
  },
  code_outdated: {
    "This code was made before Sprouts changed how links work. Get a new code in the app, then try again.": "Este código se creó antes de que Sprouts cambiara cómo funcionan las vinculaciones. Pide un código nuevo en la app y vuelve a intentarlo.",
  },
  wallet_taken: {
    "This wallet is linked to another Seeker. Revoke it there first.": "Esta billetera está vinculada a otro Seeker. Primero revócala allí.",
  },
  link_would_fail: {
    "This wallet needs a little SOL first: about 0.01 SOL covers the one-time rent and the fee. Nothing was signed.": "Esta billetera primero necesita un poco de SOL: unos 0,01 SOL cubren el depósito único (rent) y la comisión. No se firmó nada.",
    "This approval would fail on chain ({detail}), so no wallet was asked to sign it. Try again, or get a new code.": "Esta aprobación fallaría on-chain ({detail}), así que no se le pidió a ninguna billetera que la firmara. Inténtalo de nuevo o pide un código nuevo.",
  },
  // A 0.1.13 app matches this code, never the text; a 0.1.12 app sends no accept-language and so always gets the English stem.
  no_delegation: {
    "No delegation found yet: your approval was sent but is not on chain. Trying again is safe.": "Aún no se encontró la delegación: tu aprobación se envió pero no está on-chain. Puedes volver a intentarlo sin riesgo.",
    "No delegation found for this wallet yet. Sign the approval first.": "Aún no se encontró una delegación para esta billetera. Primero firma la aprobación.",
    "No delegation found: the network did not accept the approval ({reason}). Nothing was linked. Try again.": "No se encontró la delegación: la red no aceptó la aprobación ({reason}). No se vinculó nada. Inténtalo de nuevo.",
  },
  // ---- Re-link ----
  link_wallet_first: {
    "Link this phone's wallet first.": "Primero vincula la billetera de este teléfono.",
  },
  already_relinked: {
    "This wallet is already re-linked.": "Esta billetera ya está vinculada de nuevo.",
  },
  relink_keeps_old: {
    "This re-link does not revoke your current approval. Nothing was sent; start the re-link again.": "Esta nueva vinculación no revoca tu aprobación actual. No se envió nada; vuelve a vincular desde el principio.",
  },
  relink_would_fail: {
    "This re-link would fail on chain, so nothing was asked of your wallet. Try again in a minute.": "Esta nueva vinculación fallaría on-chain, así que no se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
  },
  relink_not_on_chain: {
    "No re-link found on chain yet. Check again in a minute.": "Aún no aparece la nueva vinculación on-chain. Vuelve a revisar en un minuto.",
  },
  wrong_mint: {
    "The approval on chain is not for USDC, so nothing was recorded. Start the re-link again.": "La aprobación on-chain no es para USDC, así que no se registró nada. Vuelve a vincular desde el principio.",
  },
  // ---- Wallets, revoke ----
  wallet_not_found: {
    "No such wallet.": "No existe esa billetera.",
  },
  wallet_revoked: {
    "This wallet was revoked. Link it again to plant from it.": "Esta billetera fue revocada. Vuelve a vincularla para plantar desde ella.",
  },
  nothing_to_revoke: {
    "Nothing to revoke.": "No hay nada que revocar.",
  },
  // ---- Moves ----
  move_not_found: {
    "No such move.": "No existe ese movimiento.",
  },
  move_not_open: {
    "This move is no longer open.": "Este movimiento ya no está abierto.",
  },
  move_in_flight: {
    "This move is on its way. Check Home in a minute.": "Este movimiento está en camino. Revisa tu jardín en un minuto.",
  },
  move_not_built: {
    "Build this move first.": "Primero arma este movimiento.",
  },
  move_unsure: {
    "It may still go through. Check Home in a minute before you try again.": "Todavía puede completarse. Revisa tu jardín en un minuto antes de volver a intentarlo.",
  },
  move_partial: {
    "Your {coin} is back in your wallet; the move did not finish.": "Tu {coin} volvió a tu billetera; el movimiento no terminó.",
  },
  nothing_to_move: {
    "Nothing to move here.": "No hay nada que mover aquí.",
  },
  move_unsized: {
    "Could not size this move just now. Try again tomorrow.": "No se pudo calcular este movimiento en este momento. Inténtalo de nuevo mañana.",
  },
  // ---- Withdraw, lend withdraw, basket ----
  min_withdrawal: {
    "The smallest withdrawal is {min}.": "El retiro mínimo es de {min}.",
  },
  withdraw_too_large: {
    "That is more than this position holds.": "Eso es más de lo que tiene esta posición.",
    "That withdrawal is larger than your position.": "Ese retiro es mayor que tu posición.",
    "That is more than your garden holds.": "Eso es más de lo que tiene tu jardín.",
  },
  withdraw_refused: {
    "You can withdraw once your earnings reach 1 SKR.": "Puedes retirar cuando tus ganancias lleguen a 1 SKR.",
    "The smallest withdrawal is 1 SKR.": "El retiro mínimo es de 1 SKR.",
  },
  nothing_to_withdraw: {
    "Nothing to withdraw here.": "No hay nada que retirar aquí.",
  },
  // {when} comes from the route in Spanish (esDayHourUtc); the English match only finds the line.
  basket_busy: {
    "One basket at a time.": "Una canasta a la vez.",
    "One basket at a time. Your Seeker's wallet is already ripening a withdrawal.": "Una canasta a la vez. La billetera de tu Seeker ya está madurando un retiro.",
    "One basket at a time. Your Seeker's wallet is already ripening a withdrawal; it arrives {when}.": "Una canasta a la vez. La billetera de tu Seeker ya está madurando un retiro; llega el {when}.",
    "One basket at a time. Your last withdrawal arrives {when}.": "Una canasta a la vez. Tu último retiro llega el {when}.",
  },
  basket_empty: {
    "Nothing in the basket.": "No hay nada en la canasta.",
  },
  // ---- Plant my SKR ----
  plant_off: {
    "Planting SKR from your wallet is paused right now. Nothing was asked of your wallet.": "Plantar SKR desde tu billetera está en pausa por ahora. No se le pidió nada a tu billetera.",
  },
  plant_bad_amount: {
    "Pick an amount of SKR to plant.": "Elige cuánto SKR plantar.",
  },
  plant_refused: {
    "Pick an amount of SKR to plant.": "Elige cuánto SKR plantar.",
    "Your SKR balance changed. Nothing was asked of your wallet. Pick an amount again.": "Tu saldo de SKR cambió. No se le pidió nada a tu billetera. Vuelve a elegir un monto.",
    "Sprouts could not build this just now. Nothing was asked of your wallet. Try again in a minute.": "Sprouts no pudo armar esto en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
    "This would fail on chain, so nothing was asked of your wallet. Try again in a minute.": "Esto fallaría on-chain, así que no se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
  },
  plant_not_now: {
    "Sprouts could not build this just now. Nothing was asked of your wallet. Try again in a minute.": "Sprouts no pudo armar esto en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
  },
  // ---- Top-up (Agregar USDC: a coin swapped to USDC inside the wallet; never "to the garden") ----
  topup_bad_amount: {
    "Pick an amount from $2 to $25.": "Elige un monto de $2 a $25.",
  },
  topup_bad_source: {
    "Sprouts cannot add USDC from this coin. Pick another coin.": "Sprouts no puede agregar USDC desde esta moneda. Elige otra moneda.",
  },
  topup_refused: {
    "Sprouts can't swap SOL to USDC right now. Nothing was asked of your wallet. Try again in a few minutes.": "Sprouts no puede hacer el swap de SOL a USDC en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en unos minutos.",
    "Sprouts can't swap {symbol} to USDC right now. Nothing was asked of your wallet. Try SOL, or try again later.": "Sprouts no puede hacer el swap de {symbol} a USDC en este momento. No se le pidió nada a tu billetera. Prueba con SOL o inténtalo más tarde.",
    "Not enough SOL. Adding {usd} of USDC needs about {need} SOL plus 0.01 SOL kept for fees, and this wallet has {have} SOL.": "No hay suficiente SOL. Agregar {usd} en USDC necesita unos {need} SOL más 0,01 SOL reservados para comisiones, y esta billetera tiene {have} SOL.",
    "Sprouts couldn't get a {symbol} price just now. Nothing was asked of your wallet. Try again in a minute.": "Sprouts no pudo obtener el precio de {symbol} en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
    "Not enough SOL for the network fee. Adding USDC from {symbol} needs about {sol} SOL in this wallet.": "No hay suficiente SOL para la comisión de red. Agregar USDC desde {symbol} necesita unos {sol} SOL en esta billetera.",
    "Not enough {symbol}. Adding {usd} of USDC needs more than this wallet holds.": "No hay suficiente {symbol}. Agregar {usd} en USDC necesita más de lo que tiene esta billetera.",
    "Sprouts cannot add USDC from this coin. Pick another coin.": "Sprouts no puede agregar USDC desde esta moneda. Elige otra moneda.",
    "Sprouts could not build the top-up just now. Nothing was asked of your wallet. Try again in a minute.": "Sprouts no pudo armar el swap a USDC en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
    "This wallet holds none of this coin. Pick another coin.": "Esta billetera no tiene nada de esta moneda. Elige otra moneda.",
    "Sprouts could not get a fair {symbol} to USDC price right now. Nothing was asked of your wallet. Try again later.": "Sprouts no pudo obtener un precio justo de {symbol} a USDC en este momento. No se le pidió nada a tu billetera. Inténtalo más tarde.",
    "Sprouts could not fit this swap in one transaction just now. Nothing was asked of your wallet. Try again in a minute.": "Sprouts no pudo hacer caber este swap en una sola transacción en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
    "This top-up would fail on chain, so nothing was asked of your wallet. Try again in a minute.": "Este swap a USDC fallaría on-chain, así que no se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
  },
  topup_not_now: {
    "Sprouts could not build the top-up just now. Nothing was asked of your wallet. Try again in a minute.": "Sprouts no pudo armar el swap a USDC en este momento. No se le pidió nada a tu billetera. Inténtalo de nuevo en un minuto.",
  },
  // ---- Rules, terms, preview, feedback, export, watcher ----
  pin_invalid: {
    "Your coins add up to more than 100%.": "Tus monedas suman más de 100%.",
    "Pins go up to 100%.": "Los porcentajes fijos llegan hasta 100%.",
    "Keep at least one coin on.": "Deja al menos una moneda activada.",
  },
  rules_not_saved: {
    "Your rules could not be saved right now. Try again in a minute.": "No se pudieron guardar tus reglas en este momento. Inténtalo de nuevo en un minuto.",
  },
  nothing_to_undo: {
    "Nothing to undo.": "No hay nada que deshacer.",
  },
  terms_outdated: {
    "That is not the current Terms. Reload and read them again.": "Estos no son los Términos actuales. Vuelve a cargarlos y léelos otra vez.",
  },
  has_wallet: {
    "Only for a user with no wallet linked.": "Solo para quien no tiene una billetera vinculada.",
  },
  preview_unavailable: {
    "The preview is not available right now.": "La vista previa no está disponible en este momento.",
  },
  pick_answer: {
    "Pick one of the answers.": "Elige una de las respuestas.",
  },
  bad_year: {
    "year must be four digits, like 2026.": "El año (year) debe tener cuatro dígitos, como 2026.",
  },
  export_too_long: {
    "Your history is too long for one export yet. Contact support for the full file.": "Tu historial todavía es demasiado largo para una sola exportación. Escríbenos para recibir el archivo completo.",
  },
  watcher_resting: {
    "The watcher is resting this month. The controls below still work.": "El vigilante descansa este mes. Los controles de abajo siguen funcionando.",
  },
  watcher_unreadable: {
    "The watcher could not read that. Use the controls below.": "El vigilante no pudo leer eso. Usa los controles de abajo.",
  },
} as const satisfies Partial<Record<import("../api-error").ApiErrorCode, Record<string, string>>>;

/**
 * Non-error lines the app shows as received: the reminders and the one-time note (/api/me), the confirm routes' "not confirmed yet"
 * message, the venue table's note. English -> Spanish, matched the same way as ES_ERRORS.
 */
export const ES_LINES: Record<string, string> = {
  // Reminders (domain/reminders.ts A1-A9)
  "Your garden is ready to plant": "Tu jardín está listo para plantar",
  "Link a wallet and your swaps start rounding up. It takes about 30 seconds.": "Vincula una billetera y tus swaps empiezan a redondearse. Toma unos 30 segundos.",
  "Round-ups start with a wallet": "Los redondeos empiezan con una billetera",
  "Link a wallet in Settings and your swaps start rounding up into your garden.": "Vincula una billetera en Ajustes y tus swaps empiezan a redondearse en tu jardín.",
  "One step left": "Falta un paso",
  "Link a wallet whenever you're ready. We won't remind you again.": "Vincula una billetera cuando quieras. No te lo volveremos a recordar.",
  "Your round-ups are still waiting": "Tus redondeos siguen esperando",
  "Add USDC to your wallet and plantings start again by themselves.": "Agrega USDC a tu billetera y las plantaciones vuelven a empezar solas.",
  "Your wallet is still unlinked": "Tu billetera sigue desvinculada",
  "Link your wallet again to pick up where you left off.": "Vuelve a vincular tu billetera para seguir donde lo dejaste.",
  "Your garden is waiting": "Tu jardín te espera",
  "Swap as usual and Sprouts rounds up the change into your garden.": "Haz swaps como siempre y Sprouts redondea y planta el cambio en tu jardín.",
  "Linking didn't finish": "La vinculación no terminó",
  "Want to try again? Open Settings > Link a wallet. If it keeps failing, tap Message us.": "¿Quieres intentarlo de nuevo? Abre Ajustes > Vincular una billetera. Si sigue fallando, toca Escríbenos.",
  // The one-time note (domain/messages.ts)
  "From Lucas": "De Lucas",
  "You're one of the first people using Sprouts. If you have any questions, ideas or feedback, please reach out!": "Eres de las primeras personas en usar Sprouts. Si tienes preguntas, ideas o comentarios, ¡escríbeme!",
  // 202 "not confirmed yet" (the app's own plant.sent / topup.sent words)
  "Not confirmed yet. Check your SKR plant in a minute before trying again.": "Aún no está confirmado. Revisa tu planta de SKR en un minuto antes de volver a intentarlo.",
  "Your top-up was sent but is not confirmed yet. Check Home in a minute before you try again.": "Tu swap a USDC se envió pero aún no está confirmado. Revisa tu jardín en un minuto antes de intentarlo de nuevo.",
  // The venue table's note (api/venues)
  "rate unavailable": "tasa no disponible",
};
