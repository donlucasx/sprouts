"use client";
/** A failed call: the API's own sentence as the message, with its status and machine `code` (api-error.ts) when it sent one. */
export class CallError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "CallError";
  }
}

/** One fetch for the pages: JSON out, the API's own sentence on failure. */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; code?: unknown };
  if (!r.ok) throw new CallError(j.error ?? `Request failed (${r.status}).`, r.status, typeof j.code === "string" ? j.code : undefined);
  return j;
}
