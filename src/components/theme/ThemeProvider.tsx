'use client'

/**
 * ThemeProvider — pilote la classe `theme-light` / `theme-dark` sur <html>.
 *
 * Source de vérité : le DOM (classe sur <html>), pas le state React.
 * - Au premier rendu côté serveur, on initialise sur 'light' (défaut, décision verrouillée).
 * - Au mount côté client, on synchronise le state avec ce qui est déjà sur <html>
 *   (le script anti-FOUC dans layout.tsx a fait son travail avant React).
 * - Les changements ultérieurs (toggle) mettent à jour <html> + localStorage.
 *
 * Hook : `useTheme()` → { theme, setTheme, toggleTheme, mounted }
 *   `mounted` permet d'éviter les mismatch SSR/CSR pour les éléments dépendant du theme
 *   (ex: icône Moon vs Sun sur le toggle).
 *
 * Exemple d'usage :
 *   const { theme, toggleTheme, mounted } = useTheme()
 *   <button onClick={toggleTheme}>
 *     {mounted && (theme === 'light' ? <Moon /> : <Sun />)}
 *   </button>
 */

import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'vd_theme'

interface ThemeContextValue {
  theme:        Theme
  setTheme:     (t: Theme) => void
  toggleTheme:  () => void
  mounted:      boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR: 'light' par défaut. Le script anti-FOUC dans layout.tsx applique la
  // classe correcte sur <html> AVANT que React s'hydrate, donc pas de flash.
  const [theme, setThemeState] = useState<Theme>('light')
  const [mounted, setMounted]  = useState(false)

  // Au mount : lire la classe déjà posée par le script anti-FOUC, synchroniser le state.
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('theme-dark')
    setThemeState(isDark ? 'dark' : 'light')
    setMounted(true)
  }, [])

  // À chaque changement de thème (toggle ou setTheme), maj DOM + localStorage.
  useEffect(() => {
    if (!mounted) return
    const html = document.documentElement
    html.classList.remove('theme-light', 'theme-dark')
    html.classList.add(`theme-${theme}`)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* private browsing */ }
  }, [theme, mounted])

  const setTheme    = (t: Theme) => setThemeState(t)
  const toggleTheme = () => setThemeState(t => (t === 'light' ? 'dark' : 'light'))

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, mounted }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme() doit être appelé dans un <ThemeProvider>')
  return ctx
}
