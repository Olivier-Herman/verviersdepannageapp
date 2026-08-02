'use client'
// src/components/personnel/PersonnelCalendar.tsx
//
// Calendrier d'équipe (accueil Gestion du personnel) : congés + GARDE (planning),
// avec n° de semaine. Couches d'événements (kind: conge | garde_semaine | garde_nuit).

import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const TYPE_LABEL: Record<string, string> = { conge: 'Congé légal', recup: 'Récupération', sans_solde: 'Congé sans solde' }
const pad2 = (n: number) => String(n).padStart(2, '0')
const prenom = (name: string) => { const p = (name || '').trim().split(/\s+/); return p[p.length - 1] || name }
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
}

export default function PersonnelCalendar() {
  const [reqs, setReqs] = useState<any[]>([])
  const [garde, setGarde] = useState<Record<string, any>>({})
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })

  useEffect(() => { fetch('/api/conges', { cache: 'no-store' }).then(r => r.json()).then(j => setReqs(j.requests || [])).catch(() => {}) }, [])
  useEffect(() => {
    const from = `${cur.y}-${pad2(cur.m + 1)}-01`
    const last = new Date(cur.y, cur.m + 1, 0)
    const to = `${cur.y}-${pad2(cur.m + 1)}-${pad2(last.getDate())}`
    fetch(`/api/garde/plan?events=1&from=${from}&to=${to}`, { cache: 'no-store' }).then(r => r.json())
      .then(j => { const map: Record<string, any> = {}; for (const d of (j.days || [])) map[d.date] = d; setGarde(map) }).catch(() => {})
  }, [cur])

  const conges = reqs.filter(r => ['approved', 'pending', 'cancel_requested'].includes(r.status))
  const congesAt = (ds: string) => conges.filter(e => e.start_date <= ds && ds <= e.end_date)
  const congeCls = (s: string) => s === 'approved' ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30'
    : s === 'cancel_requested' ? 'bg-orange-500/15 text-orange-700 border border-orange-500/30'
    : 'bg-amber-500/15 text-amber-700 border border-amber-500/30'

  const first = new Date(cur.y, cur.m, 1)
  const startW = (first.getDay() + 6) % 7
  const nDays = new Date(cur.y, cur.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(startW).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  const today = new Date(); const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`

  return (
    <div className="bg-surface border rounded-2xl p-5 mt-6">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays size={16} className="text-brand" />
        <h2 className="font-semibold text-ink text-sm">Calendrier d'équipe</h2>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setCur(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })} className="p-1.5 rounded-lg border text-ink-muted hover:text-brand"><ChevronLeft size={15} /></button>
          <span className="text-sm font-medium text-ink capitalize w-28 text-center">{MONTHS_FR[cur.m]} {cur.y}</span>
          <button onClick={() => setCur(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })} className="p-1.5 rounded-lg border text-ink-muted hover:text-brand"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="grid gap-1 text-center text-[11px] text-ink-muted mb-1" style={{ gridTemplateColumns: '28px repeat(7, minmax(0, 1fr))' }}>
        <div />
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((row, ri) => {
          const mondayDay = ri * 7 - startW + 1
          const wk = isoWeek(new Date(cur.y, cur.m, mondayDay))
          return (
            <div key={ri} className="grid gap-1" style={{ gridTemplateColumns: '28px repeat(7, minmax(0, 1fr))' }}>
              <div className="flex items-center justify-center text-[10px] text-ink-muted/70 font-medium">S{wk}</div>
              {row.map((d, di) => {
                if (d === null) return <div key={di} />
                const ds = `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}`
                const weekend = di >= 5
                const g = garde[ds]
                const cg = congesAt(ds)
                return (
                  <div key={di} className={`min-h-[64px] rounded-lg border p-1 ${weekend ? 'bg-surface-2/50' : 'bg-surface'} ${ds === todayStr ? 'ring-1 ring-brand' : ''}`}>
                    <div className={`text-[11px] mb-0.5 ${ds === todayStr ? 'text-brand font-bold' : 'text-ink-muted'}`}>{d}</div>
                    <div className="flex flex-col gap-0.5">
                      {g?.weekly_garde_name && <span className="text-[9px] leading-tight px-1 py-0.5 rounded truncate bg-sky-500/15 text-sky-700 border border-sky-500/30" title={`Garde semaine (jour+nuit, 2e départ) : ${g.weekly_garde_name}`}>🛡 {prenom(g.weekly_garde_name)}</span>}
                      {g?.night_first_name && <span className="text-[9px] leading-tight px-1 py-0.5 rounded truncate bg-indigo-500/15 text-indigo-700 border border-indigo-500/30" title={`1er départ nuit : ${g.night_first_name}`}>🌙 {prenom(g.night_first_name)}</span>}
                      {cg.slice(0, 2).map((e, j) => (
                        <span key={j} className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate ${congeCls(e.status)}`} title={`${e.worker} — ${TYPE_LABEL[e.type] || e.type} (${e.status})`}>{prenom(e.worker)}</span>
                      ))}
                      {cg.length > 2 && <span className="text-[9px] text-ink-muted">+{cg.length - 2} congé</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-500/30 border border-sky-500/40" /> Garde semaine</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-500/30 border border-indigo-500/40" /> 1er départ nuit</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" /> Congé approuvé</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/40" /> Congé en attente</span>
      </div>
    </div>
  )
}
