'use client'
// src/components/personnel/MyCalendar.tsx
//
// Calendrier PERSONNEL du travailleur (Mes Prestations) : ses gardes + ses congés.

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const TYPE_LABEL: Record<string, string> = { conge: 'Congé', recup: 'Récup', sans_solde: 'Sans solde' }
const pad2 = (n: number) => String(n).padStart(2, '0')
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
}

export default function MyCalendar({ conges }: { conges: any[] }) {
  const [garde, setGarde] = useState<Record<string, any>>({})
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })

  useEffect(() => {
    const from = `${cur.y}-${pad2(cur.m + 1)}-01`
    const last = new Date(cur.y, cur.m + 1, 0)
    const to = `${cur.y}-${pad2(cur.m + 1)}-${pad2(last.getDate())}`
    // Tout le monde voit les gardes de tout le monde (pas de filtre user).
    fetch(`/api/garde/plan?events=1&from=${from}&to=${to}`, { cache: 'no-store' }).then(r => r.json())
      .then(j => { const map: Record<string, any> = {}; for (const d of (j.days || [])) map[d.date] = d; setGarde(map) }).catch(() => {})
  }, [cur])
  const prenom = (name: string) => { const p = (name || '').trim().split(/\s+/); return p[p.length - 1] || name }

  const cg = (conges || []).filter(c => ['approved', 'pending', 'cancel_requested'].includes(c.status))
  const congeAt = (ds: string) => cg.filter(c => c.start_date <= ds && ds <= c.end_date)

  const first = new Date(cur.y, cur.m, 1)
  const startW = (first.getDay() + 6) % 7
  const nDays = new Date(cur.y, cur.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(startW).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  const today = new Date(); const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setCur(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })} className="p-1.5 rounded-lg border text-ink-muted hover:text-brand"><ChevronLeft size={15} /></button>
        <span className="text-sm font-semibold text-ink capitalize">{MONTHS_FR[cur.m]} {cur.y}</span>
        <button onClick={() => setCur(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })} className="p-1.5 rounded-lg border text-ink-muted hover:text-brand"><ChevronRight size={15} /></button>
      </div>
      <div className="grid gap-1 text-center text-[11px] text-ink-muted mb-1" style={{ gridTemplateColumns: '26px repeat(7, minmax(0, 1fr))' }}>
        <div />{['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((row, ri) => {
          const wk = isoWeek(new Date(cur.y, cur.m, ri * 7 - startW + 1))
          return (
            <div key={ri} className="grid gap-1" style={{ gridTemplateColumns: '26px repeat(7, minmax(0, 1fr))' }}>
              <div className="flex items-center justify-center text-[10px] text-ink-muted/70 font-medium">S{wk}</div>
              {row.map((d, di) => {
                if (d === null) return <div key={di} />
                const ds = `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}`
                const weekend = di >= 5
                const g = garde[ds]
                const cs = congeAt(ds)
                return (
                  <div key={di} className={`min-h-[58px] rounded-lg border p-1 ${weekend ? 'bg-surface-2/50' : 'bg-surface'} ${ds === todayStr ? 'ring-1 ring-brand' : ''}`}>
                    <div className={`text-[11px] mb-0.5 ${ds === todayStr ? 'text-brand font-bold' : 'text-ink-muted'}`}>{d}</div>
                    <div className="flex flex-col gap-0.5">
                      {g?.weekly_garde_name && <span className="text-[9px] leading-tight px-1 py-0.5 rounded bg-sky-500/15 text-sky-700 border border-sky-500/30 truncate" title={`Garde (jour + nuit, 2e départ) : ${g.weekly_garde_name}`}>🛡 {prenom(g.weekly_garde_name)}</span>}
                      {g?.night_first_name && <span className="text-[9px] leading-tight px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-700 border border-indigo-500/30 truncate" title={`1er départ nuit : ${g.night_first_name}`}>🌙 {prenom(g.night_first_name)}</span>}
                      {cs.map((c, j) => (
                        <span key={j} className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate border ${c.status === 'approved' ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' : 'bg-amber-500/15 text-amber-700 border-amber-500/30'}`} title={`${TYPE_LABEL[c.type] || c.type} (${c.status})`}>{TYPE_LABEL[c.type] || 'Congé'}</span>
                      ))}
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
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-500/30 border border-indigo-500/40" /> Nuit 1er départ</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" /> Congé approuvé</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/40" /> Congé en attente</span>
      </div>

      {/* Agenda du mois — lisible sur mobile (les cases sont trop petites pour les noms) */}
      {(() => {
        const WD = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
        const items: React.ReactNode[] = []
        for (let d = 1; d <= nDays; d++) {
          const ds = `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}`
          const g = garde[ds]
          const cs = congeAt(ds)
          const lines: { c: string; txt: string }[] = []
          if (g?.weekly_garde_name)  lines.push({ c: 'text-sky-700 dark:text-sky-300',   txt: `🛡 Garde (jour + nuit 2e départ) : ${g.weekly_garde_name}` })
          if (g?.night_first_name)   lines.push({ c: 'text-indigo-700 dark:text-indigo-300', txt: `🌙 Nuit 1er départ : ${g.night_first_name}` })
          for (const c of cs)        lines.push({ c: c.status === 'approved' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300', txt: `🌴 ${TYPE_LABEL[c.type] || 'Congé'} (${c.status === 'approved' ? 'approuvé' : 'en attente'})` })
          if (!lines.length) continue
          const wd = WD[new Date(cur.y, cur.m, d).getDay()]
          items.push(
            <div key={d} className="flex gap-3 py-2 border-t border-default/60 first:border-t-0">
              <div className="w-10 flex-shrink-0 text-center">
                <div className="text-ink font-bold text-sm leading-none">{d}</div>
                <div className="text-ink-muted text-[10px] uppercase">{wd}</div>
              </div>
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                {lines.map((l, i) => <span key={i} className={`text-xs font-medium ${l.c}`}>{l.txt}</span>)}
              </div>
            </div>
          )
        }
        return (
          <div className="mt-4">
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-1">Agenda du mois</p>
            {items.length ? <div>{items}</div> : <p className="text-ink-muted text-xs py-2">Aucune garde ni congé ce mois-ci.</p>}
          </div>
        )
      })()}
    </div>
  )
}
