import { useState, useEffect } from 'react';

export interface LanguageSettingsReturn {
  language: string;
  setLanguage: (lang: string) => void;
}

const STORAGE_KEY = 'starfit_language';
const DEFAULT_LANGUAGE = 'zh';

const SUPPORTED_LANGUAGES = {
  'zh': '中文',
  'en': 'English'
} as const;

type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

export const useLanguageSettings = (): LanguageSettingsReturn => {
  const [language, setLanguageState] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && Object.keys(SUPPORTED_LANGUAGES).includes(saved)) {
      return saved;
    }
    return DEFAULT_LANGUAGE;
  });

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const newLanguage = localStorage.getItem(STORAGE_KEY);
        if (newLanguage && newLanguage !== language) {
          setLanguageState(newLanguage);
          updateDocumentLanguage(newLanguage);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [language]);

  useEffect(() => {
    updateDocumentLanguage(language);
  }, [language]);

  const setLanguage = (newLanguage: string) => {
    if (Object.keys(SUPPORTED_LANGUAGES).includes(newLanguage)) {
      localStorage.setItem(STORAGE_KEY, newLanguage);
      setLanguageState(newLanguage);
      updateDocumentLanguage(newLanguage);
      
      const event = new CustomEvent('languageChanged', { detail: { language: newLanguage } });
      window.dispatchEvent(event);
    }
  };

  return {
    language,
    setLanguage
  };
};

function updateDocumentLanguage(lang: string): void {
  document.documentElement.lang = lang;
}

export { SUPPORTED_LANGUAGES };
export type { LanguageCode };
