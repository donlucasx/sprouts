import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { api, type MeResponse } from "./api";
import { readLastMe, writeLastMe } from "./me";
import { notify } from "./notify";
import { refreshWidget } from "./widget-refresh";
import { normalizeMe } from "./me-state";
import { noticesFor } from "./notices";
import { readNotify } from "./prefs";
import { coalesce } from "./coalesce";

const TASK = "sprouts-refresh";

/** Every 60 minutes or so (perf 10-08: was 15; each read costs ~7 RPC reads per user) (Android decides): read the pot; say what changed since the last read (R161: plantings, a delivered withdrawal, the manager's move, the daily limit) and refresh the widget. */
TaskManager.defineTask(TASK, coalesce(async () => {
  try {
    const before = readLastMe();
    const me = normalizeMe(await api<MeResponse>("/api/me"));
    writeLastMe(me);
    for (const n of noticesFor(before, me, readNotify)) await notify(n.title, n.body);
    await refreshWidget(me);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}));

export async function registerBackgroundRefresh() {
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 });
}

/** Sign-out stops the polling (review I4). */
export async function unregisterBackgroundRefresh() {
  await BackgroundTask.unregisterTaskAsync(TASK);
}
