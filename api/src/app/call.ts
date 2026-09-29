"use client";
/** One fetch for the pages: JSON out, the API's own sentence on failure. */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status}).`);
  return j;
}
