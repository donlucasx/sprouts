import { pageLang } from "../page-lang";
import { RevokeClient } from "./revoke-client";

/** /revoke in the browser's language (P9): the page itself is the client component; this server part only reads Accept-Language. */
export default async function RevokePage() {
  return <RevokeClient lang={await pageLang()} />;
}
