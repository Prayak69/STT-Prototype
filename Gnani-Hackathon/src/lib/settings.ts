import type { AppSettings, TranslationLanguage } from "./types";

const STORAGE_KEY = "voxnote.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  targetLanguage: "en",
  autoTranslate: true,
};

export const TRANSLATION_LANGUAGES: Array<{
  value: TranslationLanguage;
  label: string;
  short: string;
}> = [
  { value: "en", label: "English", short: "EN" },
  { value: "hi", label: "Hindi", short: "HI" },
  { value: "hinglish", label: "Hinglish", short: "HI-EN" },
];

export function translationLanguageLabel(language: TranslationLanguage): string {
  return TRANSLATION_LANGUAGES.find((entry) => entry.value === language)?.label ?? "English";
}

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const validLanguage = TRANSLATION_LANGUAGES.some(
      (entry) => entry.value === parsed.targetLanguage,
    );
    return {
      targetLanguage: validLanguage
        ? (parsed.targetLanguage as TranslationLanguage)
        : DEFAULT_SETTINGS.targetLanguage,
      autoTranslate:
        typeof parsed.autoTranslate === "boolean"
          ? parsed.autoTranslate
          : DEFAULT_SETTINGS.autoTranslate,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preferences are a convenience; storage failures should never break the app.
  }
}
