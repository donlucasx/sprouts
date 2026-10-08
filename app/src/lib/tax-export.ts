import { Share } from "react-native";
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
  const named = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  return { csv: text, filename: named ?? `sprouts-tax-${year ?? "all"}.csv` };
}

/**
 * Fetches the CSV and opens the share sheet with it. No native file module is installed (expo-sharing and expo-file-system are
 * not dependencies, and adding one needs a new native build), so this uses React Native's built-in Share: the CSV goes as the
 * message text, with the filename as the title. The user saves it from the sheet (Drive, Files, email) and imports it as a CSV.
 * Returns what the sheet reported. Settings calls it from its "Export for taxes" row, e.g. `onPress={() => exportTaxCsv(2026)}`
 * inside a try/catch that shows the ApiError's message.
 */
export async function exportTaxCsv(year?: number): Promise<{ filename: string; action: string }> {
  const { csv, filename } = await fetchTaxCsv(year);
  const r = await Share.share({ message: csv, title: filename }, { dialogTitle: filename, subject: filename });
  return { filename, action: r.action };
}
