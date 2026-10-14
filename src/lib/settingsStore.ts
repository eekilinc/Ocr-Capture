import { Store } from "@tauri-apps/plugin-store";

let pending: Promise<Store> | null = null;

/**
 * Opens the settings store once and shares the handle.
 *
 * TranslationProvider, App and SettingsModal all used to call `Store.load` separately,
 * which meant three handles to the same file and three independent save cycles.
 */
export const getSettingsStore = (): Promise<Store> => {
  if (!pending) {
    pending = Store.load("settings.json").catch((err) => {
      console.error("Could not open the settings store:", err);
      pending = null; // let the next caller retry
      throw err;
    });
  }
  return pending;
};