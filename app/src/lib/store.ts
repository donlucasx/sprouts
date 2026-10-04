import { createMMKV } from "react-native-mmkv"; // v4: a factory, and MMKV is a type only [A5]

/** The app's one key-value store on the phone (the last read, preferences, the last watering). Its own module so that small readers
 * (lib/last-watering) need not import lib/me and its query client. */
export const store = createMMKV({ id: "sprouts" });
