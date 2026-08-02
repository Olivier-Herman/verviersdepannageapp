'use client'
// src/app/personnel/conges/CongesManagerClient.tsx — Validation des congés (RH/superadmin).

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import PersonnelTabs from '@/components/layout/PersonnelTabs'
import { CalendarDays, Check, X, ShieldCheck, RefreshCw, Clock, ChevronLeft, ChevronRight, List, LayoutGrid } from 'lucide-react'

const TYPE_LABEL: Record<string, string> = { conge: 'Congé légal', recup: 'Récupération', sans_solde: 'Congé sans solde' }
const fmtD = (d: string) => { const [y, m, j] = (d || '').split('-'); return j ? `${j}/${m}/${y}` : d }
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const pad2 = (n: number) => String(n).padStart(2, '0')
const prenom = (name: string) => { const p = (name || '').trim().split(/\s+/); return p[p.length - 1] || name }

export default function CongesManagerClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [reqs, setReqs] = useState<any[]>([])
  const [loading, setLd] = useState(true)
  const [modal, setModal] = useState<{ id: string; decision: 'approve' | 'refuse' | 'cancel'; worker: string } | null>(null)
  const [pin, setPin] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })

  const load = useCallback(async () => {
    setLd(true)
    const r = await fetch('/api/conges', { cache: 'no-store' })
    const j = await r.json(); setReqs(j.requests || []); setLd(false)
  }, [])
  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!modal) return
    setBusy(true)
    try {
      const payload = modal.decision === 'cancel'
        ? { action: 'cancel', id: modal.id, pin }
        : { action: 'decide', id: modal.id, decision: modal.decision, pin, note }
      const r = await fetch('/api/conges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json()
      if (j.error) { alert(j.error); return }
      if (modal.decision === 'approve' && j.applied?.missing?.length)
        alert(`Approuvé. ${j.applied.applied} jour(s) posé(s). Mois sans feuille de présence (posés au prochain import) : ${j.applied.missing.join(', ')}.`)
      setModal(null); setPin(''); setNote(''); await load()
    } finally { setBusy(false) }
  }

  const refuseCancel = async (id: string) => {
    const r = await fetch('/api/conges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refuse_cancel', id }) })
    const j = await r.json(); if (j.error) { alert(j.error); return }
    await load()
  }

  const pending = reqs.filter(r => r.status === 'pending' || r.status === 'cancel_requested')
  const history = reqs.filter(r => r.status === 'approved' || r.status === 'refused')

  const StatusBadge = ({ s }: { s: string }) => {
    const map: any = { approved: ['bg-emerald-500/10 text-emerald-700', 'Approuvé'], refused: ['bg-red-500/10 text-red-600', 'Refusé'], pending: ['bg-amber-500/10 text-amber-700', 'En attente'], cancel_requested: ['bg-orange-500/10 text-orange-700', 'Annulation demandée'] }
    const [cls, lbl] = map[s] || map.pending
    return <span className={`text-[11px] px-2 py-0.5 rounded-full ${cls}`}>{lbl}</span>
  }

  return (
    <AppShell title="Congés" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <PersonnelTabs />
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><CalendarDays size={22} /></div>
          <div><h1 className="text-xl font-bold text-ink leading-tight">Congés</h1>
            <p className="text-ink-muted text-sm">Demandes des travailleurs — à valider</p></div>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-lg border overflow-hidden">
              <button onClick={() => setView('list')} className={`px-2.5 py-1.5 text-sm inline-flex items-center gap-1 ${view === 'list' ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-white/5'}`}><List size={15} /> Liste</button>
              <button onClick={() => setView('calendar')} className={`px-2.5 py-1.5 text-sm inline-flex items-center gap-1 ${view === 'calendar' ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-white/5'}`}><LayoutGrid size={15} /> Calendrier</button>
            </div>
            <button onClick={load} className="p-2 text-ink-muted hover:text-brand"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>

        {view === 'calendar' && (() => {
          const first = new Date(cur.y, cur.m, 1)
          const startW = (first.getDay() + 6) % 7
          const nDays = new Date(cur.y, cur.m + 1, 0).getDate()
          const cells: (number | null)[] = [...Array(startW).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)]
          const events = reqs.filter(r => ['approved', 'pending', 'cancel_requested'].includes(r.status))
          const evAt = (d: number) => { const ds = `${cur.y}-${pad2(cur.m + 1)}-${pad2(d)}`; return events.filter(e => e.start_date <= ds && ds <= e.end_date) }
          const evCls = (s: string) => s === 'approved' ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30'
            : s === 'cancel_requested' ? 'bg-orange-500/15 text-orange-700 border border-orange-500/30'
            : 'bg-amber-500/15 text-amber-700 border border-amber-500/30'
          const today = new Date(); const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`
          return (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setCur(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })} className="p-1.5 rounded-lg border text-ink-muted hover:text-brand"><ChevronLeft size={16} /></button>
                <span className="font-semibold text-ink capitalize">{MONTHS_FR[cur.m]} {cur.y}</span>
                <button onClick={() => setCur(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })} className="p-1.5 rounded-lg border text-ink-muted hover:text-brand"><ChevronRight size={16} /></button>
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
                    <div key={i} className={`min-h-[64px] rounded-lg border p-1 ${weekend ? 'bg-surface-2/50' : 'bg-surface'} ${ds === todayStr ? 'ring-1 ring-brand' : ''}`}>
                      <div className={`text-[11px] mb-0.5 ${ds === todayStr ? 'text-brand font-bold' : 'text-ink-muted'}`}>{d}</div>
                      <div className="flex flex-col gap-0.5">
                        {evs.slice(0, 4).map((e, j) => (
                          <span key={j} className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate ${evCls(e.status)}`} title={`${e.worker} — ${TYPE_LABEL[e.type] || e.type} (${e.status})`}>{prenom(e.worker)}</span>
                        ))}
                        {evs.length > 4 && <span className="text-[9px] text-ink-muted">+{evs.length - 4}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-ink-muted">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/40" /> Approuvé</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500/40" /> En attente</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500/30 border border-orange-500/40" /> Annulation demandée</span>
                <span className="text-ink-muted/60">· Les gardes s'ajouteront ici prochainement.</span>
              </div>
            </div>
          )
        })()}

        {view === 'list' && (<>

        {/* En attente */}
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2 flex items-center gap-1.5"><Clock size={13} /> À valider ({pending.length})</h2>
        {pending.length === 0 && <p className="text-ink-muted text-sm italic mb-6">Aucune demande en attente.</p>}
        <div className="flex flex-col gap-2 mb-8">
          {pending.map(r => (
            <div key={r.id} className="bg-surface border rounded-xl p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-ink text-sm">{r.worker}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand">{TYPE_LABEL[r.type] || r.type}</span>
                <span className="text-ink-muted text-xs">· {r.days} j{r.hours != null ? ` · ${r.hours} h` : ''}</span>
                {r.status === 'cancel_requested' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-700">Annulation demandée</span>}
              </div>
              <div className="text-ink-secondary text-sm mt-1">Du <b>{fmtD(r.start_date)}</b> au <b>{fmtD(r.end_date)}</b></div>
              {r.reason && <div className="text-ink-muted text-xs mt-1 italic">« {r.reason} »</div>}
              {r.status === 'pending' ? (
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={() => setModal({ id: r.id, decision: 'approve', worker: r.worker })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium"><Check size={15} /> Approuver</button>
                  <button onClick={() => setModal({ id: r.id, decision: 'refuse', worker: r.worker })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-ink-secondary text-sm hover:text-red-500"><X size={15} /> Refuser</button>
                  <button onClick={() => setModal({ id: r.id, decision: 'cancel', worker: r.worker })}
                    className="ml-auto text-xs text-ink-muted hover:text-red-400 underline">Annuler la demande</button>
                </div>
              ) : (
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={() => setModal({ id: r.id, decision: 'cancel', worker: r.worker })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium"><Check size={15} /> Confirmer l'annulation</button>
                  <button onClick={() => refuseCancel(r.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-ink-secondary text-sm hover:text-brand"><X size={15} /> Refuser l'annulation</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Historique */}
        {history.length > 0 && (
          <>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">Historique</h2>
            <div className="flex flex-col gap-1.5">
              {history.map(r => (
                <div key={r.id} className="flex items-center gap-2 flex-wrap bg-surface border rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{r.worker}</span>
                  <span className="text-ink-muted text-xs">{TYPE_LABEL[r.type] || r.type} · {fmtD(r.start_date)}→{fmtD(r.end_date)} · {r.hours != null ? `${r.hours} h` : `${r.days}j`}</span>
                  <span className="ml-auto"><StatusBadge s={r.status} /></span>
                  <div className="w-full flex items-center gap-3 mt-0.5">
                    {r.decided_by && <span className="text-ink-muted text-[11px]">par {r.decided_by}{r.decision_note ? ` — ${r.decision_note}` : ''}</span>}
                    <div className="ml-auto flex gap-3">
                      {r.status === 'approved' && <button onClick={() => setModal({ id: r.id, decision: 'refuse', worker: r.worker })} className="text-[11px] text-ink-muted hover:text-brand underline">Passer en refusé</button>}
                      {r.status === 'refused' && <button onClick={() => setModal({ id: r.id, decision: 'approve', worker: r.worker })} className="text-[11px] text-ink-muted hover:text-brand underline">Passer en approuvé</button>}
                      <button onClick={() => setModal({ id: r.id, decision: 'cancel', worker: r.worker })} className="text-[11px] text-ink-muted hover:text-red-400 underline">Annuler</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        </>)}
      </div>

      {modal && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-surface border rounded-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={18} className={modal.decision === 'approve' ? 'text-emerald-600' : 'text-red-500'} />
              <h2 className="font-semibold text-ink text-sm flex-1">{modal.decision === 'approve' ? 'Approuver le congé' : modal.decision === 'refuse' ? 'Refuser le congé' : 'Annuler le congé'}</h2>
              <button onClick={() => setModal(null)} className="p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>
            <p className="text-ink-muted text-xs mb-3">{modal.worker} — confirme avec ton code PIN.{
              modal.decision === 'approve' ? ' Le congé sera posé sur la feuille de présence et le travailleur notifié.'
              : modal.decision === 'cancel' ? ' La demande sera supprimée (et le congé retiré de la feuille de présence s\'il était posé).'
              : ' Le travailleur sera notifié.'}</p>
            <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="Code PIN" autoFocus
              className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink text-center tracking-widest" />
            {modal.decision !== 'cancel' && (
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optionnel)"
                className="w-full mt-2 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setModal(null)} className="px-3 py-2 rounded-lg border text-sm text-ink-secondary">Fermer</button>
              <button onClick={submit} disabled={!pin || busy}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${modal.decision === 'approve' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                {busy ? <RefreshCw size={15} className="animate-spin" /> : (modal.decision === 'approve' ? <Check size={15} /> : <X size={15} />)}
                {modal.decision === 'approve' ? 'Approuver' : modal.decision === 'refuse' ? 'Refuser' : 'Annuler'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
