'use client'
// src/app/prestations/PrestationsClient.tsx — Module Prestations (superadmin).
// Grille mensuelle travailleurs × jours, pré-remplie depuis la feuille EasyPay.
// Momo marque les écarts (absences), on enregistre. PDF signé + envoi = Phase 2.

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import PersonnelTabs from '@/components/layout/PersonnelTabs'
import { Clock, RefreshCw, Save, Check, X } from 'lucide-react'

const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const periodLabel = (p: string) => { const [y, m] = (p || '').split('-'); return m ? `${MONTHS[+m]} ${y}` : p }
const WD = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

// Types d'absence (libellés lisibles pour la feuille — EasyPay encode les codes).
const ABS: Record<string, { label: string; ab: string; cls: string }> = {
  conge:         { label: 'Congé légal',       ab: 'C',  cls: 'bg-blue-500 text-white' },
  maladie:       { label: 'Maladie',           ab: 'M',  cls: 'bg-red-500 text-white' },
  accident:      { label: 'Accident travail',  ab: 'AT', cls: 'bg-orange-500 text-white' },
  ferie:         { label: 'Jour férié',        ab: 'F',  cls: 'bg-purple-500 text-white' },
  recup:         { label: 'Récupération',      ab: 'R',  cls: 'bg-teal-500 text-white' },
  sans_solde:    { label: 'Congé sans solde',  ab: 'SS', cls: 'bg-gray-500 text-white' },
  petit_chomage: { label: 'Petit chômage',     ab: 'PC', cls: 'bg-amber-500 text-white' },
  chomage_temp:  { label: 'Chômage temp.',     ab: 'CT', cls: 'bg-pink-500 text-white' },
}

export default function PrestationsClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData]     = useState<any>(null)
  const [period, setPeriod] = useState<string>('')
  const [busy, setBusy]     = useState('')
  const [sheets, setSheets] = useState<any[]>([])
  const [dirty, setDirty]   = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ sheetId: string; day: number; worker: string } | null>(null)

  const load = useCallback(async (p?: string) => {
    const r = await fetch(`/api/prestations${p ? `?period=${p}` : ''}`, { cache: 'no-store' })
    const j = await r.json()
    setData(j); setPeriod(j.period || ''); setSheets(j.sheets || []); setDirty(new Set())
  }, [])
  useEffect(() => { load() }, [load])

  const daysInMonth = (() => { const [y, m] = (period || '').split('-').map(Number); return y && m ? new Date(y, m, 0).getDate() : 0 })()
  const dow = (d: number) => { const [y, m] = (period || '').split('-').map(Number); return new Date(y, m - 1, d).getDay() }

  const importMail = async () => {
    if (!confirm('Importer les feuilles de présence depuis les mails EasyPay ?\n(les jours déjà édités ne sont pas écrasés)')) return
    setBusy('import')
    try {
      const r = await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import' }) })
      const j = await r.json()
      if (j.error) alert(j.error)
      else { const tot = (j.results || []).reduce((s: number, x: any) => s + (x.stored || 0), 0); alert(`Import terminé : ${tot} feuille(s) importée(s).`) }
      await load(period)
    } finally { setBusy('') }
  }

  const setCell = (sheetId: string, day: number, val: any) => {
    setSheets(prev => prev.map(s => {
      if (s.id !== sheetId) return s
      const days = { ...(s.days || {}) }
      if (val === null) delete days[String(day)]; else days[String(day)] = val
      return { ...s, days }
    }))
    setDirty(prev => new Set(prev).add(sheetId))
    setEditing(null)
  }

  const saveAll = async () => {
    setBusy('save')
    try {
      for (const id of dirty) {
        const s = sheets.find(x => x.id === id); if (!s) continue
        await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id, days: s.days || {} }) })
      }
      setDirty(new Set())
      alert('Modifications enregistrées.')
    } finally { setBusy('') }
  }

  const totalHours = (s: any) => Object.values(s.days || {}).reduce((t: number, v: any) => t + (v?.h || 0), 0)

  const cellOf = (s: any, d: number) => {
    const v = (s.days || {})[String(d)]
    const weekend = dow(d) === 0 || dow(d) === 6
    if (v?.abs) { const a = ABS[v.abs]; return <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold ${a?.cls || 'bg-gray-400 text-white'}`}>{a?.ab || '?'}</span> }
    if (v?.h > 0) return <span className="text-ink text-xs tabular-nums">{v.h}</span>
    return <span className={weekend ? 'text-ink-muted/30' : 'text-ink-muted/50'}>·</span>
  }

  return (
    <AppShell title="Prestations" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-full mx-auto px-4 py-6">
        <PersonnelTabs />
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><Clock size={22} /></div>
            <div><h1 className="text-xl font-bold text-ink leading-tight">Prestations</h1>
              <p className="text-ink-muted text-sm">Feuilles de présence — à valider et renvoyer au secrétariat social</p></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={period} onChange={e => { setPeriod(e.target.value); load(e.target.value) }} className="bg-surface border rounded-lg px-3 py-2 text-sm">
              {(data?.periods || []).length === 0 && <option value="">—</option>}
              {(data?.periods || []).map((p: string) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
            {dirty.size > 0 && (
              <button onClick={saveAll} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
                {busy === 'save' ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />} Enregistrer ({dirty.size})
              </button>
            )}
            <button onClick={importMail} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand disabled:opacity-50">
              {busy === 'import' ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />} Importer (mail)
            </button>
          </div>
        </div>

        {sheets.length === 0 && (
          <div className="bg-surface border rounded-2xl p-8 text-center">
            <p className="text-ink-muted text-sm">Aucune feuille de présence. Clique <b>« Importer (mail) »</b> pour récupérer la feuille EasyPay du mois.</p>
          </div>
        )}

        {sheets.length > 0 && (
          <div className="bg-surface border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse">
                <thead>
                  <tr className="text-ink-muted text-[10px] border-b">
                    <th className="text-left px-3 py-2 sticky left-0 bg-surface z-10 min-w-[180px]">Travailleur</th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                      const we = dow(d) === 0 || dow(d) === 6
                      return <th key={d} className={`px-1 py-1 text-center w-8 ${we ? 'bg-white/5' : ''}`}><div>{WD[dow(d)]}</div><div className="tabular-nums">{d}</div></th>
                    })}
                    <th className="px-2 py-2 text-center">Tot.</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map(s => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 sticky left-0 bg-surface z-10">
                        <div className="text-ink font-medium text-xs">{s.worker_name}</div>
                        <div className="text-ink-muted text-[10px]">{[s.matricule && `#${s.matricule}`, s.qs && `Q/S ${s.qs}`].filter(Boolean).join(' · ')}</div>
                      </td>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                        const we = dow(d) === 0 || dow(d) === 6
                        return (
                          <td key={d} className={`text-center p-0.5 ${we ? 'bg-white/5' : ''}`}>
                            <button onClick={() => setEditing({ sheetId: s.id, day: d, worker: s.worker_name })}
                              className="w-7 h-7 flex items-center justify-center rounded hover:ring-1 hover:ring-brand/40">{cellOf(s, d)}</button>
                          </td>
                        )
                      })}
                      <td className="px-2 text-center text-ink-secondary text-xs tabular-nums font-medium">{totalHours(s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-t text-[10px] text-ink-muted">
              {Object.entries(ABS).map(([k, a]) => (
                <span key={k} className="inline-flex items-center gap-1"><span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[8px] font-bold ${a.cls}`}>{a.ab}</span>{a.label}</span>
              ))}
            </div>
          </div>
        )}

        <p className="text-ink-muted text-xs mt-3">Phase 2 à venir : génération du PDF « Feuille de présence » signé + envoi direct à Jonathan (secrétariat social).</p>
      </div>

      {/* Éditeur de cellule */}
      {editing && (() => {
        const s = sheets.find(x => x.id === editing.sheetId)
        return (
          <div className="fixed inset-0 z-[200] bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setEditing(null)}>
            <div className="bg-surface border rounded-2xl p-4 w-full sm:max-w-md m-0 sm:m-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1"><div className="text-ink font-semibold text-sm">{editing.worker}</div>
                  <div className="text-ink-muted text-xs">{editing.day} {periodLabel(period)}</div></div>
                <button onClick={() => setEditing(null)} className="p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
              </div>
              <div className="mb-3">
                <div className="text-ink-muted text-xs mb-1.5">Heures prestées</div>
                <div className="flex flex-wrap gap-1.5">
                  {[0, 4, 6, 7.6, 8, 9, 10].map(h => (
                    <button key={h} onClick={() => setCell(editing.sheetId, editing.day, { h })}
                      className="px-3 py-1.5 rounded-lg border text-sm text-ink hover:border-brand/50 hover:text-brand">{h}h</button>
                  ))}
                </div>
              </div>
              <div className="mb-3">
                <div className="text-ink-muted text-xs mb-1.5">Absence</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(ABS).map(([k, a]) => (
                    <button key={k} onClick={() => setCell(editing.sheetId, editing.day, { abs: k })}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${a.cls}`}>{a.ab} · {a.label}</button>
                  ))}
                </div>
              </div>
              <button onClick={() => setCell(editing.sheetId, editing.day, null)} className="text-xs text-ink-muted hover:text-red-400">Effacer ce jour</button>
            </div>
          </div>
        )
      })()}
    </AppShell>
  )
}
