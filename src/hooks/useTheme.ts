import { useCallback, useEffect, useState } from "react";
import type { ThemeMode } from "../types";

const STORAGE_KEY = "ocr-capture-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === "light" || value === "dark" || value === "system";

/**
 * "system" is kept as the stored preference so the Settings tab can show it as
 * selected, but it has to be resolved to a concrete palette before it reaches
 * the DOM: App.css only styles `:root` (light) and `[data-theme="dark"]`.
 */
export const resolveTheme = (mode: ThemeMode): "light" | "dark" =>
  mode === "system" ? (window.matchMedia(DARK_QUERY).matches ? "dark" : "light") : mode;

export const useTheme = (): [ThemeMode, (mode: ThemeMode) => void] => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(saved) ? saved : "system";
  });

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => {
      document.documentElement.setAttribute("data-theme", resolveTheme(theme));
    };

    apply();
    localStorage.setItem(STORAGE_KEY, theme);

    // Only "system" needs to react to OS-level changes while the app runs.
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setThemeMode = useCallback((mode: ThemeMode) => setTheme(mode), []);

  return [theme, setThemeMode];
};