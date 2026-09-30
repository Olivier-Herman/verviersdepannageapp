'use client'
// src/components/personnel/GardeBanner.tsx
//
// Bandeau affiché en haut du dashboard au chauffeur concerné quand il est de
// garde (semaine) ou de 1er départ de nuit aujourd'hui.
// Garde de la semaine = réserve de nuit : toggle « me prévenir des missions libres
// quand le 1er départ est occupé » (idée de Franck, Olivier 30/09/2026 ; coupé par
// défaut, clé notif_preferences.market_reserve, cf lib/missions/market-notify.ts).

import { useEffect, useState } from 'react'
import { ShieldCheck, Moon, BellRing, Loader2 } from 'lucide-react'

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`

export default function GardeBanner() {
  const [info, setInfo] = useState<{ role: string; end?: string } | null>(null)
  const [reserveOn, setReserveOn] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (info?.role !== 'semaine') return
    fetch('/api/users/me/notif-preferences', { cache: 'no-store' }).then(r => r.json())
      .then(j => setReserveOn(j?.preferences?.market_reserve === true))
      .catch(() => setReserveOn(false))
  }, [info?.role])

  async function toggleReserve() {
    if (saving || reserveOn === null) return
    const next = !reserveOn
    setSaving(true); setErr(null); setReserveOn(next)
    try {
      const r = await fetch('/api/users/me/notif-preferences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market_reserve: next }),
      })
      if (!r.ok) throw new Error()
    } catch {
      setReserveOn(!next); setErr('Réglage non enregistré, réessaie.')
    } finally { setSaving(false) }
  }

  useEffect(() => {
    const f = new Date(), t = new Date(); t.setDate(t.getDate() + 7)
    const p = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    fetch(`/api/garde/plan?events=1&from=${p(f)}&to=${p(t)}&mine=1`, { cache: 'no-store' }).then(r => r.json()).then(j => {
      const today = p(new Date())
      const days = j.days || []
      const t0 = days.find((d: any) => d.date === today)
      if (!t0) return
      if (t0.mine_role === 'semaine') {
        // fin de semaine = dimanche
        const d = new Date(); const toSun = (7 - ((d.getDay() + 6) % 7 + 1)); d.setDate(d.getDate() + toSun)
        setInfo({ role: 'semaine', end: fmt(d) })
      } else setInfo({ role: t0.mine_role })
    }).catch(() => {})
  }, [])

  if (!info) return null

  return (
    <div className="mb-4">
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${info.role === 'semaine' ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-400/50' : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-400/50'}`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${info.role === 'semaine' ? 'bg-sky-500/15 text-sky-600' : 'bg-indigo-500/15 text-indigo-600'}`}>
        {info.role === 'semaine' ? <ShieldCheck size={18} /> : <Moon size={18} />}
      </div>
      <div className="min-w-0">
        {info.role === 'semaine'
          ? <><p className="text-sm font-semibold text-sky-800 dark:text-sky-300">Tu es de garde cette semaine 🛡</p>
              <p className="text-xs text-sky-700/80 dark:text-sky-300/70">Jour + nuit (2e départ) jusqu'au dimanche {info.end}.</p></>
          : <><p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Tu es de 1er départ de nuit ce soir 🌙</p>
              <p className="text-xs text-indigo-700/80 dark:text-indigo-300/70">Tu pars en premier sur les appels de nuit. De 18 h à 8 h, tu es prévenu de chaque mission libre dans Momo Market.</p></>}
      </div>
      <a href="/ma-paie" className="ml-auto text-xs font-medium text-brand hover:underline flex-shrink-0">Mon calendrier</a>
    </div>
    {info.role === 'semaine' && (
      <button type="button" onClick={toggleReserve} disabled={saving || reserveOn === null}
        className="mt-2 w-full min-h-[44px] rounded-xl border border-sky-400/50 bg-sky-50 dark:bg-sky-500/10 px-4 py-2.5 flex items-center gap-3 text-left disabled:opacity-60">
        <BellRing size={18} className="text-sky-600 flex-shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-sky-800 dark:text-sky-300">Réserve de nuit : me prévenir des missions libres</span>
          <span className="block text-xs text-sky-700/80 dark:text-sky-300/70">
            {reserveOn === null ? 'Chargement…'
              : reserveOn ? 'Activé : de 18 h à 8 h, tu es prévenu quand une mission attend dans Momo Market et que le 1er départ est déjà en mission.'
              : 'Désactivé : tu n’es pas prévenu des missions libres la nuit.'}
          </span>
          {err && <span className="block text-xs font-medium text-red-700 dark:text-red-300 mt-0.5">{err}</span>}
        </span>
        {saving ? <Loader2 size={18} className="animate-spin text-sky-600 flex-shrink-0" /> : (
          <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${reserveOn ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${reserveOn ? 'translate-x-5' : ''}`} />
          </span>
        )}
      </button>
    )}
    </div>
  )
}
