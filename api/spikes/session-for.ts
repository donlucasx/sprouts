// Mints a seven-day session for a registered Seeker, as the app's sign-in would, and prints the token once for a curl from this
// Terminal. The token is a live credential: never paste it into a chat or a log. The device recorded is the user's Genesis mint.
// Run from api/: pnpm tsx --env-file=.env.local spikes/session-for.ts <seed vault pubkey>
import { getRepo } from "../src/db/repo";
import { issueSession } from "../src/lib/session";

const pubkey = (process.argv[2] ?? "").trim();
if (!pubkey) { console.log("usage: session-for.ts <seed vault pubkey>"); process.exit(1); }
const user = await (await getRepo()).getUser(pubkey);
if (!user) { console.log("no user row; sign in once first"); process.exit(1); }
console.log(await issueSession(pubkey, user.sgtMint));
