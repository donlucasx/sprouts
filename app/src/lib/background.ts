import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { api, type MeResponse } from "./api";
import { readLastMe, writeLastMe } from "./me";
import { notify } from "./notify";
import { refreshWidget } from "./widget-refresh";
import { formatSkr } from "./format";
import { plantingNotice } from "./notices";
import { readNotifyPlantings } from "./prefs";

const TASK = "sprouts-refresh";

/** Every 15 minutes or so (Android decides): read the pot; if a planting landed since the last read, say so and refresh the widget. */
TaskManager.defineTask(TASK, async () => {
  try {
    const before = readLastMe();
    const me = await api<MeResponse>("/api/me");
    writeLastMe(me);
    const newPlantings = me.history.plantings.filter((p) => !before?.history.plantings.some((q) => q.id === p.id));
    if (readNotifyPlantings()) for (const p of newPlantings) await notify("Planting landed", plantingNotice(p, me.pot));
    if (before?.basket && !me.basket) await notify("Withdrawal delivered", `${formatSkr(BigInt(before.basket.amountRaw), me.pot.skrUsd)} is in your Seeker's wallet.`);
    await refreshWidget(me);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundRefresh() {
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
}

/** Sign-out stops the polling (review I4). */
export async function unregisterBackgroundRefresh() {
  await BackgroundTask.unregisterTaskAsync(TASK);
}
