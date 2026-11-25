import { pageLang } from "../page-lang";
import { LinkClient } from "./link-client";

/** /link in the browser's language (P9): the page itself is the client component; this server part only reads Accept-Language. */
export default async function LinkPage() {
  return <LinkClient lang={await pageLang()} />;
}
