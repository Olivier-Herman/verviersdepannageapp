'use client'
// src/components/personnel/GardeBanner.tsx
//
// Bandeau affiché en haut du dashboard au chauffeur concerné quand il est de
// garde (semaine) ou de 1er départ de nuit aujourd'hui.
// Garde de la semaine = réserve de nuit : toggle « me prévenir des missions libres
// quand le 1er départ est occupé » (idée de Franck, Olivier 30/09/2026). Actif par
// défaut et réactivé chaque soir à 18 h ; le couper prévient les dispatchers.
// Cf /api/garde/reserve-notif et lib/missions/market-notify.ts.

import { useEffect, useState } from 'react'
import { ShieldCheck, Moon, BellRing, Loader2 } from 'lucide-react'

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`

export default function GardeBanner() {
  const [info, setInfo] = useState<{ role: string; end?: string } | null>(null)
  // Réserve de la nuit courante (null = pas de réserve cette nuit / pas encore chargé)
  const [reserveOn, setReserveOn] = useState<boolean | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/garde/reserve-notif', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (j?.isReserve) setReserveOn(j.enabled !== false) })
      .catch(() => {})
  }, [])

  async function saveReserve(next: boolean) {
    if (saving) return
    setSaving(true); setErr(null)
    try {
      const r = await fetch('/api/garde/reserve-notif', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Réglage non enregistré, réessaie.')
      setReserveOn(next); setConfirmOff(false)
    } catch (e: any) {
      setErr(e?.message || 'Réglage non enregistré, réessaie.')
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

  if (!info && reserveOn === null) return null

  return (
    <div className="mb-4">
    {info && (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${info.role === 'semaine' ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-400/50' : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-400/50'}`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${info.role === 'semaine' ? 'bg-sky-500/15 text-sky-600' : 'bg-indigo-500/15 text-indigo-600'}`}>
        {info.role === 'semaine' ? <ShieldCheck size={18} /> : <Moon size={18} />}
      </div>
      <div className="min-w-0">
        {info.role === 'semaine'
          ? <><p className="text-sm font-semibold text-sky-800 dark:text-sky-300">Tu es de garde cette semaine 🛡</p>
              <p className="text-xs text-sky-700/80 dark:text-sky-300/70">Jour + nuit (2e départ) jusqu'au dimanche {info.end}.</p></>
          : <><p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Tu es de 1er départ de nuit ce soir 🌙</p>
              <p className="text-xs text-indigo-700/80 dark:text-indigo-300/70">Tu pars en premier sur les appels de nuit. De 18 h à 8 h, chaque mission libre t’est proposée ; sans réponse après 2 min, tu reçois un appel.</p></>}
      </div>
      <a href="/ma-paie" className="ml-auto text-xs font-medium text-brand hover:underline flex-shrink-0">Mon calendrier</a>
    </div>
    )}
    {reserveOn !== null && (
      <div className={`mt-2 rounded-xl border px-4 py-2.5 ${reserveOn ? 'border-sky-400/50 bg-sky-50 dark:bg-sky-500/10' : 'border-amber-400/60 bg-amber-50 dark:bg-amber-500/10'}`}>
        <button type="button" onClick={() => reserveOn ? setConfirmOff(true) : saveReserve(true)} disabled={saving || confirmOff}
          className="w-full min-h-[44px] flex items-center gap-3 text-left disabled:opacity-100">
          <BellRing size={18} className={`flex-shrink-0 ${reserveOn ? 'text-sky-600' : 'text-amber-600'}`} />
          <span className="min-w-0 flex-1">
            <span className={`block text-sm font-semibold ${reserveOn ? 'text-sky-800 dark:text-sky-300' : 'text-amber-800 dark:text-amber-300'}`}>Réserve de nuit : me proposer les missions libres</span>
            <span className={`block text-xs ${reserveOn ? 'text-sky-700/80 dark:text-sky-300/70' : 'text-amber-700 dark:text-amber-300/80'}`}>
              {reserveOn
                ? 'Activé : de 18 h à 8 h, une mission t’est proposée quand le 1er départ ne peut pas la prendre ou ne répond pas.'
                : 'Désactivé pour cette nuit : aucune mission ne t’est proposée. Se réactive tout seul à 18 h, pour la nuit suivante.'}
            </span>
          </span>
          {saving ? <Loader2 size={18} className="animate-spin text-sky-600 flex-shrink-0" /> : (
            <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${reserveOn ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${reserveOn ? 'translate-x-5' : ''}`} />
            </span>
          )}
        </button>
        {confirmOff && (
          <div className="mt-2 border-t border-sky-400/30 pt-2">
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Désactiver pour cette nuit ? Le dispatcher de garde sera prévenu qu’aucune mission libre ne te sera proposée.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => saveReserve(false)} disabled={saving}
                className="flex-1 min-h-[44px] rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-60">Oui, désactiver</button>
              <button type="button" onClick={() => setConfirmOff(false)} disabled={saving}
                className="flex-1 min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-sm font-medium">Annuler</button>
            </div>
          </div>
        )}
        {err && <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{err}</p>}
      </div>
    )}
    </div>
  )
}
