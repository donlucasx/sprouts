import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });

/** The "plantings" channel and one permission prompt; asked once, on the first open after sign-in. */
export async function askNotificationPermissionOnce() {
  await Notifications.setNotificationChannelAsync("plantings", { name: "Plantings", importance: Notifications.AndroidImportance.DEFAULT });
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") await Notifications.requestPermissionsAsync();
}

/** "Planting landed: $0.23 of change became 12.48 SKR ($0.23), locked to your Seeker." Local, no push service, no FCM. */
export async function notify(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
}
