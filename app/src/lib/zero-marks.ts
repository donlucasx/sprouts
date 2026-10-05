import { store } from "./store";
import type { MeResponse } from "./api";
import { nextZeroMarks, type ZeroMarks } from "./garden-input";

/** R360: the zero marks on this phone (lib/garden-input nextZeroMarks), kept beside the last read so Home and the widget agree. */
const KEY = "garden.zeroMarks";
export function readZeroMarks(): ZeroMarks {
  try {
    const raw = store.getString(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as ZeroMarks) : {};
  } catch {
    return {};
  }
}
/** Called on every good read, before anything draws from it; writes only when a mark moved. */
export function recordZeroMarks(me: MeResponse): ZeroMarks {
  const prev = readZeroMarks();
  const next = nextZeroMarks(me, prev);
  if (JSON.stringify(next) !== JSON.stringify(prev)) store.set(KEY, JSON.stringify(next));
  return next;
}
