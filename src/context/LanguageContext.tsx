import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { LanguageCode, LanguageOption, SUPPORTED_LANGUAGES } from '@/types/language';
import { translations } from '@/lib/translations';

import { mockDb } from '@/services/mock-db';

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
  currentLanguageOption: LanguageOption;
  languages: LanguageOption[];
  t: (key: string, fallback?: string) => string;
}

const STORAGE_KEY = 'agrisurvey_preferred_lang';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as LanguageCode | null;
      if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
        return saved;
      }
      if (mockDb?.currentUser?.preferred_language && SUPPORTED_LANGUAGES.some((l) => l.code === mockDb.currentUser.preferred_language)) {
        return mockDb.currentUser.preferred_language as LanguageCode;
      }
    } catch {
      // localStorage may fail in private mode
    }
    return 'mr';
  });

  const setLanguage = (code: LanguageCode) => {
    setLanguageState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
      // Also update html lang attribute for accessibility & browser font rendering
      document.documentElement.lang = code;
    } catch {
      // Ignore
    }

    try {
      if (mockDb && mockDb.currentUser) {
        mockDb.currentUser.preferred_language = code;
        const matchingProfile = mockDb.profiles.find((p) => p.id === mockDb.currentUser.id);
        if (matchingProfile) {
          matchingProfile.preferred_language = code;
        }
        mockDb.persistAll();
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const currentLanguageOption = useMemo(() => {
    return SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];
  }, [language]);

  const t = (path: string, fallback?: string): string => {
    const parts = path.split('.');
    
    // 1. Try to resolve in selected language
    let currentObj: unknown = translations[language];
    for (const part of parts) {
      if (currentObj && typeof currentObj === 'object' && part in currentObj) {
        currentObj = (currentObj as Record<string, unknown>)[part];
      } else {
        currentObj = undefined;
        break;
      }
    }

    if (typeof currentObj === 'string' && currentObj.trim().length > 0) {
      return currentObj;
    }

    // 2. Fallback to English
    let englishObj: unknown = translations.en;
    for (const part of parts) {
      if (englishObj && typeof englishObj === 'object' && part in englishObj) {
        englishObj = (englishObj as Record<string, unknown>)[part];
      } else {
        englishObj = undefined;
        break;
      }
    }

    if (typeof englishObj === 'string' && englishObj.trim().length > 0) {
      return englishObj;
    }

    // 3. Fallback to provided fallback or path itself
    return fallback || path;
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        currentLanguageOption,
        languages: SUPPORTED_LANGUAGES,
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

/** Same as useLanguage, but returns undefined instead of throwing outside a LanguageProvider. */
export const useOptionalLanguage = (): LanguageContextType | undefined => useContext(LanguageContext);
