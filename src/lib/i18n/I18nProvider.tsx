'use client'

// Provider Client qui expose la langue active + helper t() a tous les
// composants client de l app. La langue est lue depuis la session NextAuth
// (users.language) au login, modifiable via /profil ou un selecteur en haut.
//
// Cf [[migration 202606012000_users_language]] pour le schema BDD.

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { Lang }                                                   from './types'
import { tString, tParts }                                             from './lookup'

interface I18nContextValue {
  lang: Lang
  t:    (key: string, params?: Record<string, string | number>) => string
  parts: (key: string, params?: Record<string, string | number>) => { primary: string; secondary: string | null }
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  initialLang = 'fr',
  children,
}: {
  initialLang?: Lang
  children: React.ReactNode
}) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  // Sync si la prop change (ex : user se reconnecte avec une autre langue)
  useEffect(() => { setLangState(initialLang) }, [initialLang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    // POST async vers /api/users/me/language — pas attendre, optimistic UI
    fetch('/api/users/me/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: next }),
    }).catch(() => {})
  }, [])

  const t      = useCallback((key: string, params?: Record<string, string | number>) => tString(lang, key, params), [lang])
  const parts  = useCallback((key: string, params?: Record<string, string | number>) => tParts(lang, key, params),  [lang])

  return (
    <I18nContext.Provider value={{ lang, t, parts, setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // Fallback gracieux : si on est en dehors d un Provider (ex : page legacy),
    // on retourne du francais brut sans bilingue. Evite de planter l app.
    return {
      lang: 'fr' as Lang,
      t: (key: string, params?: Record<string, string | number>) => tString('fr', key, params),
      parts: (key: string, params?: Record<string, string | number>) => tParts('fr', key, params),
      setLang: () => {},
    }
  }
  return ctx
}

/** Raccourci pour les composants qui n ont besoin que de t(). */
export function useT() {
  const { t, lang } = useI18n()
  return { t, lang }
}
