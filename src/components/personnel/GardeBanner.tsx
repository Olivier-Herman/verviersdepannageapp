'use client'
// src/components/personnel/GardeBanner.tsx
//
// Bandeau affiché en haut du dashboard au chauffeur concerné quand il est de
// garde (semaine) ou de 1er départ de nuit aujourd'hui.

import { useEffect, useState } from 'react'
import { ShieldCheck, Moon } from 'lucide-react'

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`

export default function GardeBanner() {
  const [info, setInfo] = useState<{ role: string; end?: string } | null>(null)

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
    <div className={`mb-4 rounded-xl border px-4 py-3 flex items-center gap-3 ${info.role === 'semaine' ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-400/50' : 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-400/50'}`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${info.role === 'semaine' ? 'bg-sky-500/15 text-sky-600' : 'bg-indigo-500/15 text-indigo-600'}`}>
        {info.role === 'semaine' ? <ShieldCheck size={18} /> : <Moon size={18} />}
      </div>
      <div className="min-w-0">
        {info.role === 'semaine'
          ? <><p className="text-sm font-semibold text-sky-800 dark:text-sky-300">Tu es de garde cette semaine 🛡</p>
              <p className="text-xs text-sky-700/80 dark:text-sky-300/70">Jour + nuit (2e départ) jusqu'au dimanche {info.end}.</p></>
          : <><p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Tu es de 1er départ de nuit ce soir 🌙</p>
              <p className="text-xs text-indigo-700/80 dark:text-indigo-300/70">Tu pars en premier sur les appels de nuit.</p></>}
      </div>
      <a href="/ma-paie" className="ml-auto text-xs font-medium text-brand hover:underline flex-shrink-0">Mon calendrier</a>
    </div>
  )
}
