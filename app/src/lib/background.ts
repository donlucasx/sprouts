import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { api, type MeResponse } from "./api";
import { readLastMe, writeLastMe } from "./me";
import { notify } from "./notify";
import { refreshWidget } from "./widget-refresh";
import { normalizeMe } from "./me-state";
import { lowUsdcNotice, noticesFor } from "./notices";
import { readLastAvg, readWasLow, writeWasLow } from "./usdc-watch";
import { readNotify } from "./prefs";
import { coalesce } from "./coalesce";

const TASK = "sprouts-refresh";

/** Every 60 minutes or so (perf 10-08: was 15; each read costs ~7 RPC reads per user) (Android decides): read the pot; say what changed since the last read (R161: plantings, a delivered withdrawal, the manager's move, the daily limit, a wallet paused for want of USDC) and refresh the widget. */
TaskManager.defineTask(TASK, coalesce(async () => {
  try {
    const before = readLastMe();
    const me = normalizeMe(await api<MeResponse>("/api/me"));
    writeLastMe(me);
    for (const n of noticesFor(before, me, readNotify)) await notify(n.title, n.body);
    // 10-27: this phone's wallet running low on USDC, once per low spell (a failed balance read changes nothing)
    const usdc = await api<{ usdcRaw: string | null }>("/api/me/usdc").catch(() => null);
    const usdcCents = usdc?.usdcRaw != null ? Number(BigInt(usdc.usdcRaw) / 10_000n) : null;
    const phone = me.wallets.find((w) => w.pubkey === me.user.pubkey);
    const low = lowUsdcNotice(usdcCents, readLastAvg(), readWasLow(), phone?.status === "paused" || !phone);
    if (low.notice && readNotify(low.notice.kind)) await notify(low.notice.title, low.notice.body);
    writeWasLow(low.low);
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
