import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { translations, Language, TranslationKeys, interpolate } from './translations';
import { getSettingsStore } from "../lib/settingsStore";

interface TranslationContextType {
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  lang: Language;
  setLang: (newLang: Language) => Promise<void>;
}

const TranslationContext = createContext<TranslationContextType | undefined>(undefined);

const isLanguage = (value: unknown): value is Language => value === "tr" || value === "en";

export const TranslationProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Language>("tr");

  useEffect(() => {
    const loadLang = async () => {
      try {
        const store = await getSettingsStore();
        const savedLang = await store.get<string>("app-lang");
        // A hand-edited or corrupted store used to set an arbitrary string, after which
        // every `translations[lang][key]` lookup threw and the whole app fell into the
        // error boundary on every launch -- with no way out but editing the file.
        if (isLanguage(savedLang)) {
          setLangState(savedLang);
        } else if (savedLang !== undefined && savedLang !== null) {
          console.warn(`Ignoring unknown app-lang value: ${String(savedLang)}`);
        }
      } catch (e) {
        console.error("Failed to load language:", e);
      }
    };
    loadLang();
  }, []);

  const t = useCallback(
    (key: TranslationKeys, params?: Record<string, string | number>): string => {
      // Fall back to Turkish rather than indexing an unknown dictionary and throwing.
      const dictionary = translations[lang] ?? translations.tr;
      const translation = dictionary[key] ?? key;
      if (params) {
        return interpolate(translation, params);
      }
      return translation;
    },
    [lang]
  );

  const setLang = useCallback(async (newLang: Language) => {
    setLangState(newLang);
    try {
      const store = await getSettingsStore();
      await store.set("app-lang", newLang);
      await store.save();
    } catch (e) {
      console.error("Failed to save language:", e);
    }
  }, []);

  // Without memo the provider hands every consumer a fresh context object on each
  // render, so no component under it can bail out of re-rendering.
  const value = useMemo(() => ({ t, lang, setLang }), [t, lang, setLang]);

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslationContext = () => {
  const context = useContext(TranslationContext);
  if (context === undefined) {
    throw new Error('useTranslationContext must be used within a TranslationProvider');
  }
  return context;
};