import * as Notifications from "expo-notifications";
import { subscribeLang, t } from "@/i18n";

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });

/** The one Android channel. Its id never changes (the user's on/off, sound and importance for it are kept under the id); 0.1.13
 *  localizes only its visible name, which Android lets an app update on an existing channel. */
export const CHANNEL_ID = "plantings";
const channel = () => Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: t("notify.channel"), importance: Notifications.AndroidImportance.DEFAULT });

/** The "plantings" channel and one permission prompt; asked once, on the first open after sign-in. Each signed-in start re-sends the
 *  channel, so its name follows the app's language (the same importance: Android ignores a raise and the user's own choice stands). */
export async function askNotificationPermissionOnce() {
  await channel();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") await Notifications.requestPermissionsAsync();
}

/** 0.1.13: a language change renames the channel at once, when it exists (never creates it: on Android 13+ the first channel can
 *  bring up the permission prompt, which stays tied to sign-in). */
export async function renameChannel() {
  if (!(await Notifications.getNotificationChannelAsync(CHANNEL_ID))) return;
  await channel();
}
subscribeLang(() => void renameChannel().catch(() => {}));

/** "Planted: Your change was planted: $0.23 became 12.48 SKR ($0.23)." Local, no push service, no FCM. The caller builds title and
 *  body with t() at send time (lib/notices.ts), so a headless run speaks the language chosen when it runs. */
export async function notify(title: string, body: string, route?: string) {
  await Notifications.scheduleNotificationAsync({ content: { title, body, ...(route ? { data: { route } } : {}) }, trigger: null });
}
