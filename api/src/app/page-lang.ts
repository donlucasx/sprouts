import { headers } from "next/headers";
import { langOf, type Lang } from "@/lib/i18n";

/**
 * 0.1.13 Spanish pass P9: the language a web page renders in, from the browser's Accept-Language (es, es-AR, es-419... -> "es";
 * anything else, or none, -> "en"). Reading the header makes the page render per request.
 */
export async function pageLang(): Promise<Lang> {
  return langOf((await headers()).get("accept-language"));
}
