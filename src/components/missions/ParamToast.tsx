'use client'
// Message de confirmation affiché une fois quand l'adresse porte ?<param>=1 (pause remise au dispatch, reprise ;
// Olivier 29/10/2026). Le paramètre est retiré de l'adresse pour ne pas le revoir au rechargement.
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

export default function ParamToast({ param, k }: { param: string; k: string }) {
  const { t } = useT()
  const [on, setOn] = useState(false)
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get(param) !== '1') return
    setOn(true)
    u.searchParams.delete(param)
    window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash)
    const id = setTimeout(() => setOn(false), 8000)
    return () => clearTimeout(id)
  }, [param])
  if (!on) return null
  return (
    <div className="rounded-2xl border border-green-600 bg-green-50 dark:bg-green-500/10 text-green-800 dark:text-green-200 px-4 py-3 text-sm font-semibold flex items-start gap-3">
      <span className="flex-1">{t(k)}</span>
      <button type="button" onClick={() => setOn(false)} aria-label="✕" className="w-11 h-11 -my-2 -mr-2 rounded-xl text-lg">✕</button>
    </div>
  )
}
