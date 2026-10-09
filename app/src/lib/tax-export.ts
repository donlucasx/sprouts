import { Directory, File, Paths } from "expo-file-system";
import { shareAsync } from "expo-sharing";
import { loadSession } from "./session";
import { API_ORIGIN, API_UNANSWERED, ApiError } from "./api";

/**
 * R447: the tax record. GET /api/export/tax answers a CSV in Koinly's Universal import format, a record to import into a tax tool
 * (Koinly reads it as is), not tax advice and not a tax form. `api()` parses JSON, so this is its small text twin: the same origin,
 * the same session bearer, the API's own sentence on failure.
 */
export async function fetchTaxCsv(year?: number): Promise<{ csv: string; filename: string }> {
  const s = await loadSession();
  if (!s) throw new ApiError(401, "Sign in first.");
  const query = year === undefined ? "" : `?year=${year}`;
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${API_ORIGIN}/api/export/tax${query}`, { headers: { authorization: `Bearer ${s.token}` } });
    text = await res.text();
  } catch {
    throw new ApiError(0, API_UNANSWERED);
  }
  if (!res.ok) {
    let message = res.status >= 500 ? API_UNANSWERED : `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text) as { error?: unknown };
      if (typeof j.error === "string") message = j.error;
    } catch {
      // not JSON: the generic sentence stands
    }
    throw new ApiError(res.status, message);
  }
  // Audit 10-08: a 200 that is not the CSV (a captive portal's page) is refused, not saved as a .csv; the served name becomes a
  // plain file name before it touches the file system.
  if (!(res.headers.get("content-type") ?? "").includes("text/csv")) throw new ApiError(0, API_UNANSWERED);
  const named = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1]?.replace(/[^\w.-]/g, "_");
  return { csv: text, filename: named ?? `sprouts-tax-${year ?? "all"}.csv` };
}

export type TaxFile = { uri: string; filename: string; madeAt: number };

/** Audit 10-08: a prepared file is offered for 10 minutes; after that Download prepares a fresh one, so a shared record is never days old. */
export const TAX_FILE_FRESH_MS = 10 * 60_000;
export const taxFileFresh = (f: TaxFile | null, now = Date.now()): f is TaxFile => f !== null && now - f.madeAt < TAX_FILE_FRESH_MS;

/**
 * R463, request then notify: fetches the whole history's CSV and writes it as a real .csv file in the app's cache. Settings calls it
 * from "Request history", tells the phone when it is ready, then offers the file through shareTaxCsv (Drive, Files, email), so a tax
 * tool imports it as a file. expo-file-system + expo-sharing were added 10-08 with the release's native build.
 */
/** Audit 10-08: deletes every tax file this app wrote (a full financial history), before a new one and on sign-out. Best effort. */
export function clearTaxFiles(): void {
  try {
    for (const f of new Directory(Paths.cache).list()) if (f instanceof File && /^sprouts-tax-.*\.csv$/.test(f.name)) f.delete();
  } catch {
    // nothing to clear, or the cache is unreadable: the OS clears it in time
  }
}

export async function prepareTaxCsv(): Promise<TaxFile> {
  const { csv, filename } = await fetchTaxCsv();
  clearTaxFiles();
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(csv);
  return { uri: file.uri, filename, madeAt: Date.now() };
}

export const shareTaxCsv = (f: TaxFile) =>
  shareAsync(f.uri, { mimeType: "text/csv", dialogTitle: f.filename, UTI: "public.comma-separated-values-text" });
