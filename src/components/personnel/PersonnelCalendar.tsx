'use client'
// src/components/personnel/PersonnelCalendar.tsx
//
// Calendrier d'équipe (accueil Gestion du personnel). Couches d'événements :
// congés aujourd'hui, GARDES à venir (module garde). Conçu pour superposer
// plusieurs types via le champ `kind`.

import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const TYPE_LABEL: Record<string, string> = { conge: 'Congé légal', recup: 'Récupération', sans_solde: 'Congé sans solde' }
const pad2 = (n: number) => String(n).padStart(2, '0')
const prenom = (name: string) => { const p = (name || '').trim().split(/\s+/); return p[p.length - 1] || name }

interface CalEvent { start: string; end: string; label: string; status: string; kind: 'conge' | 'garde'; title?: string }

export default function PersonnelCalendar() {
  const [reqs, setReqs] = useState<any[]>([])
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })

  useEffect(() => {
    fetch('/api/conges', { cache: 'no-store' }).then(r => r.json()).then(j => setReqs(j.requests || [])).catch(() => {})
  }, [])

  // Couche congés (les gardes viendront s'ajouter ici avec kind:'garde').
  const events: CalEvent[] = reqs.filter(r => ['approved', 'pending', 'cancel_requested'].includes(r.status))
    .map(r => ({ start: r.start_date, end: r.end_date, label: prenom(r.worker), status: r.status, kind: 'conge' as const, title: `${r.worker} — ${TYPE_LABEL[r.type] || r.type} (${r.status})` }))

  const first = new Date(cur.y, cur.m, 1)
  const startW = (first.getDay() + 6) % 7
  const nDays = new Date(cur.y, cur.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(startW).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)]
  const evAt = (d: number) => { const ds = `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}`; return events.filter(e => e.start <= ds && ds <= e.end) }
  const evCls = (e: CalEvent) => e.kind === 'garde' ? 'bg-sky-500/15 text-sky-700 border border-sky-500/30'
    : e.status === 'approved' ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30'
    : e.status === 'cancel_requested' ? 'bg-orange-500/15 text-orange-700 border border-orange-500/30'
    : 'bg-amber-500/15 text-amber-700 border border-amber-500/30'
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
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-muted mb-1">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const ds = `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}`
          const weekend = ((startW + d - 1) % 7) >= 5
          const evs = evAt(d)
          return (
            <div key={i} className={`min-h-[62px] rounded-lg border p-1 ${weekend ? 'bg-surface-2/50' : 'bg-surface'} ${ds === todayStr ? 'ring-1 ring-brand' : ''}`}>
              <div className={`text-[11px] mb-0.5 ${ds === todayStr ? 'text-brand font-bold' : 'text-ink-muted'}`}>{d}</div>
              <div className="flex flex-col gap-0.5">
                {evs.slice(0, 4).map((e, j) => (
                  <span key={j} className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate ${evCls(e)}`} title={e.title}>{e.label}</span>
                ))}
                {evs.length > 4 && <span className="text-[9px] text-ink-muted">+{evs.length - 4}</span>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" /> Congé approuvé</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/40" /> En attente</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-500/30 border border-sky-500/40" /> Garde (à venir)</span>
      </div>
    </div>
  )
}
