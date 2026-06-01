'use client'

// Selecteur de langue dans /profil. POST /api/users/me/language + update
// state I18nProvider pour switch UI immediat. La session NextAuth se
// resync au prochain check (callback session() fetch DB).
//
// Olivier 2026-06-01.

import { useI18n }   from '@/lib/i18n/I18nProvider'
import { LANGUAGES } from '@/lib/i18n/types'
import { T }         from '@/lib/i18n/T'

export function LanguageSelector() {
  const { lang, setLang } = useI18n()

  return (
    <div className="grid grid-cols-2 gap-3">
      {LANGUAGES.map(l => {
        const active = lang === l.code
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => setLang(l.code)}
            className={`py-3 px-4 rounded-xl font-semibold text-sm transition border-2 ${
              active
                ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                : 'bg-surface text-ink border-gray-200 hover:border-blue-400'
            }`}
          >
            <div className="text-lg">{l.native}</div>
            <div className={`text-xs ${active ? 'text-blue-100' : 'text-ink-muted'}`}>
              {l.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}
