'use client'
// src/components/personnel/NightSwitchCard.tsx
//
// Interrupteur « Garde de nuit automatique » sur le tableau de bord (Olivier
// 30/09/2026), visible pour le dispatcher de garde et les superadmins. Le dispatch
// l'active quand il va dormir : les missions libres sont alors proposées au 1er
// départ (appel après 2 min), puis à la réserve. Il se désactive tout seul à 8 h.
// Cf /api/garde/night-proposals et lib/missions/market-proposals.ts.

import { useEffect, useState } from 'react'
import { Moon, Loader2 } from 'lucide-react'

interface State { on: boolean; inNight: boolean; byName: string | null; at: string | null }
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

export default function NightSwitchCard() {
  const [st, setSt] = useState<State | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/garde/night-proposals', { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (j?.canToggle) setSt({ on: !!j.on, inNight: !!j.inNight, byName: j.byName, at: j.at }) })
      .catch(() => {})
  }, [])

  if (!st) return null

  async function toggle() {
    if (saving || !st) return
    setSaving(true); setErr(null)
    try {
      const r = await fetch('/api/garde/night-proposals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !st.on }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Réglage non enregistré, réessaie.')
      setSt({ on: !!j.on, inNight: !!j.inNight, byName: j.byName, at: j.at })
    } catch (e: any) {
      setErr(e?.message || 'Réglage non enregistré, réessaie.')
    } finally { setSaving(false) }
  }

  const who = st.byName && st.at ? ` — par ${st.byName} à ${hhmm(st.at)}` : ''
  return (
    <div className={`mb-4 rounded-xl border px-4 py-2.5 ${st.on ? 'border-indigo-400/60 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 dark:border-slate-600 bg-surface'}`}>
      <button type="button" onClick={toggle} disabled={saving}
        className="w-full min-h-[44px] flex items-center gap-3 text-left disabled:opacity-70">
        <Moon size={18} className={`flex-shrink-0 ${st.on ? 'text-indigo-600' : 'text-slate-500'}`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${st.on ? 'text-indigo-800 dark:text-indigo-300' : 'text-ink'}`}>Garde de nuit automatique</span>
          <span className={`block text-xs ${st.on ? 'text-indigo-700/90 dark:text-indigo-300/80' : 'text-ink-muted'}`}>
            {st.on
              ? `Activée${st.inNight ? '' : ' pour cette nuit (dès 18 h)'} : les missions libres sont proposées au 1er départ, puis à la réserve. Se désactive toute seule à 8 h${who}.`
              : `Désactivée : c’est le dispatch qui attribue ; le 1er départ reçoit une simple info. Active-la quand tu vas dormir${who}.`}
          </span>
          {err && <span className="block text-xs font-medium text-red-700 dark:text-red-300 mt-0.5">{err}</span>}
        </span>
        {saving ? <Loader2 size={18} className="animate-spin text-indigo-600 flex-shrink-0" /> : (
          <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${st.on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${st.on ? 'translate-x-5' : ''}`} />
          </span>
        )}
      </button>
    </div>
  )
}
