'use client'
// src/app/prestations/PrestationsClient.tsx — Module Prestations (superadmin).
// Grille mensuelle travailleurs × jours, pré-remplie depuis la feuille EasyPay.
// Momo marque les écarts (absences), on enregistre. PDF signé + envoi = Phase 2.

import { useEffect, useState, useCallback, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'
import PersonnelTabs from '@/components/layout/PersonnelTabs'
import { applyHolidaysToDays } from '@/lib/prestations/belgian-holidays'
import { Clock, RefreshCw, Save, Check, X, FileText, Send, ShieldCheck, CalendarCheck, StickyNote, Settings, Unlock, Lock } from 'lucide-react'

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
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const noteTimers = useRef<Record<string, any>>({})
  const [editing, setEditing] = useState<{ sheetId: string; day: number; worker: string } | null>(null)

  // Auto-save d'une feuille (jours et/ou note).
  const persist = async (id: string, patch: any) => {
    setSaving(true)
    try {
      await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id, ...patch }) })
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500)
    } finally { setSaving(false) }
  }
  const [pinModal, setPinModal] = useState(false)
  const [pinAction, setPinAction] = useState<'sign' | 'unlock'>('sign')
  const [pin, setPin] = useState('')
  const [signing, setSigning] = useState(false)
  const [genNote, setGenNote] = useState('')
  const [settingsModal, setSettingsModal] = useState(false)
  const [mailTo, setMailTo] = useState('')
  const [mailCc, setMailCc] = useState('')

  const saveSettings = async () => {
    const r = await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_settings', to: mailTo, cc: mailCc }) })
    const j = await r.json()
    if (j.error) { alert(j.error); return }
    setSettingsModal(false); await load(period)
  }

  const saveGenNote = async () => {
    await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_general_note', period, note: genNote }) })
  }
  const setNote = (sheetId: string, note: string) => {
    setSheets(prev => prev.map(s => s.id === sheetId ? { ...s, note } : s))
    clearTimeout(noteTimers.current[sheetId])
    noteTimers.current[sheetId] = setTimeout(() => persist(sheetId, { note }), 700)
  }

  const signSend = async () => {
    setSigning(true)
    try {
      const r = await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sign_send', period, pin }) })
      const j = await r.json()
      if (j.error) { alert(j.error); return }
      setPinModal(false); setPin('')
      alert(`Feuille validée et envoyée à ${j.to}\nSignée par ${j.signedBy} le ${j.date}.`)
      await load(period)
    } finally { setSigning(false) }
  }

  const openSign   = () => { setPinAction('sign'); setPin(''); setPinModal(true) }
  const openUnlock = () => { setPinAction('unlock'); setPin(''); setPinModal(true) }

  const unlockConfirm = async () => {
    setSigning(true)
    try {
      const r = await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unlock', period, pin }) })
      const j = await r.json()
      if (j.error) { alert(j.error); return }
      setPinModal(false); setPin('')
      await load(period)
    } finally { setSigning(false) }
  }

  const load = useCallback(async (p?: string) => {
    const r = await fetch(`/api/prestations${p ? `?period=${p}` : ''}`, { cache: 'no-store' })
    const j = await r.json()
    // Les jours fériés sont déjà intégrés à l'import (server) → on affiche tel
    // quel, sans rien re-marquer, pour ne JAMAIS écraser une correction manuelle.
    setData(j); setPeriod(j.period || ''); setSheets(j.sheets || []); setGenNote(j.generalNote || '')
    setMailTo(j.settings?.to || ''); setMailCc(j.settings?.cc || '')
  }, [])
  useEffect(() => { load() }, [load])

  const daysInMonth = (() => { const [y, m] = (period || '').split('-').map(Number); return y && m ? new Date(y, m, 0).getDate() : 0 })()
  const dow = (d: number) => { const [y, m] = (period || '').split('-').map(Number); return new Date(y, m - 1, d).getDay() }
  const validated  = sheets.length > 0 && sheets.every((s: any) => s.validated)
  const locked     = validated
  const signedBy   = sheets[0]?.signed_by
  const signedDate = sheets[0]?.validated_at ? new Date(sheets[0].validated_at).toLocaleDateString('fr-BE') : ''

  const importMail = async () => {
    if (!confirm('Importer les feuilles de présence depuis les mails EasyPay ?\n(les jours déjà édités ne sont pas écrasés)')) return
    setBusy('import')
    try {
      const r = await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import' }) })
      const j = await r.json()
      if (j.error) { alert('Erreur : ' + j.error); return }
      const res = j.results || []
      const stored  = res.reduce((s: number, x: any) => s + (x.stored || 0), 0)
      const updated = res.reduce((s: number, x: any) => s + (x.updated || 0), 0)
      const notes   = res.filter((x: any) => x.error || x.note).map((x: any) => `• ${x.mail || x.period || '?'} : ${x.error || x.note}`)
      await load(period)
      alert(`Import terminé : ${stored} travailleur(s) ajouté(s), ${updated} mis à jour.` + (notes.length ? `\n\n${notes.join('\n')}` : (stored + updated === 0 ? '\n\nAucune feuille de présence trouvée dans le dernier ZIP.' : '')))
    } catch (e: any) {
      alert("L'import a échoué ou a expiré. Réessaie (la lecture de la feuille par l'IA peut prendre un moment).")
    } finally { setBusy('') }
  }

  const applyHolidays = async () => {
    const toSave: Array<{ id: string; days: any }> = []
    const updated = sheets.map((s: any) => {
      const { days, changed } = applyHolidaysToDays(s.days || {}, period)
      if (changed) { toSave.push({ id: s.id, days }); return { ...s, days } }
      return s
    })
    if (!toSave.length) { alert('Aucun jour férié à appliquer sur ce mois (ou déjà appliqués).'); return }
    setSheets(updated)
    setBusy('holidays')
    try {
      for (const t of toSave) await fetch('/api/prestations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: t.id, days: t.days }) })
      alert(`Jours fériés appliqués et enregistrés sur ${toSave.length} feuille(s).`)
    } finally { setBusy('') }
  }

  const setCell = (sheetId: string, day: number, val: any) => {
    setEditing(null)
    const s = sheets.find(x => x.id === sheetId); if (!s) return
    const days = { ...(s.days || {}) }
    if (val === null) delete days[String(day)]; else days[String(day)] = val
    setSheets(prev => prev.map(x => x.id === sheetId ? { ...x, days } : x))
    persist(sheetId, { days })   // auto-save
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
            <button onClick={() => setSettingsModal(true)} title="Paramètres (destinataire de l'envoi)"
              className="inline-flex items-center px-2.5 py-2 rounded-lg border text-ink-secondary hover:text-brand"><Settings size={15} /></button>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted min-w-[92px]">
              {saving ? <><RefreshCw size={13} className="animate-spin" /> Enregistrement…</>
                : savedFlash ? <><Check size={13} className="text-emerald-600" /> Enregistré</>
                : <><Save size={13} /> Auto-enregistré</>}
            </span>
            {sheets.length > 0 && !locked && (
              <button onClick={applyHolidays} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand disabled:opacity-50" title="Marquer les jours fériés belges du mois">
                {busy === 'holidays' ? <RefreshCw size={15} className="animate-spin" /> : <CalendarCheck size={15} />} Fériés
              </button>
            )}
            {sheets.length > 0 && (
              <a href={`/api/prestations/pdf?period=${period}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand"><FileText size={15} /> Aperçu PDF</a>
            )}
            {sheets.length > 0 && (
              <button onClick={openSign} disabled={!!busy || saving}
                title={saving ? 'Enregistrement en cours…' : ''}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">
                <Send size={15} /> {validated ? 'Renvoyer' : 'Valider & envoyer'}
              </button>
            )}
            <button onClick={importMail} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand disabled:opacity-50">
              {busy === 'import' ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />} Importer (mail)
            </button>
          </div>
        </div>

        {validated && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-800">
            <Lock size={15} /> Feuille <b>verrouillée</b> — validée{signedBy ? ` par ${signedBy}` : ''}{signedDate ? ` le ${signedDate}` : ''} et envoyée au secrétariat social.
            <button onClick={openUnlock} className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-emerald-500/50 hover:bg-emerald-100/50 dark:hover:bg-emerald-500/20">
              <Unlock size={13} /> Déverrouiller pour corriger
            </button>
          </div>
        )}

        {sheets.length === 0 && (
          <div className="bg-surface border rounded-2xl p-8 text-center">
            <p className="text-ink-muted text-sm">Aucune feuille de présence. Clique <b>« Importer (mail) »</b> pour récupérer la feuille EasyPay du mois.</p>
          </div>
        )}

        {sheets.length > 0 && (
          <div className="bg-surface border rounded-xl p-3 mb-4">
            <label className="text-xs font-medium text-ink-muted flex items-center gap-1.5"><StickyNote size={13} /> Note générale (à l'attention du secrétariat social)</label>
            <textarea value={genNote} onChange={e => setGenNote(e.target.value)} onBlur={saveGenNote} rows={2} readOnly={locked} disabled={locked}
              placeholder="Une précision, une question pour Jonathan…" className="w-full mt-1.5 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink disabled:opacity-60" />
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
                        <input value={s.note || ''} onChange={e => setNote(s.id, e.target.value)} placeholder="note…" readOnly={locked} disabled={locked}
                          className="mt-1 w-full bg-surface-2 border rounded px-1.5 py-0.5 text-[10px] text-ink placeholder:text-ink-muted/50 disabled:opacity-60" />
                      </td>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                        const we = dow(d) === 0 || dow(d) === 6
                        return (
                          <td key={d} className={`text-center p-0.5 ${we ? 'bg-white/5' : ''}`}>
                            <button onClick={() => !locked && setEditing({ sheetId: s.id, day: d, worker: s.worker_name })} disabled={locked}
                              className={`w-7 h-7 flex items-center justify-center rounded ${locked ? 'cursor-default' : 'hover:ring-1 hover:ring-brand/40'}`}>{cellOf(s, d)}</button>
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

      {pinModal && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={() => setPinModal(false)}>
          <div className="bg-surface border rounded-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              {pinAction === 'sign' ? <ShieldCheck size={18} className="text-emerald-600" /> : <Unlock size={18} className="text-amber-600" />}
              <h2 className="font-semibold text-ink text-sm flex-1">{pinAction === 'sign' ? 'Valider et envoyer' : 'Déverrouiller la feuille'}</h2>
              <button onClick={() => setPinModal(false)} className="p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>
            <p className="text-ink-muted text-xs mb-3">
              {pinAction === 'sign'
                ? <>Signe la feuille de <b>{periodLabel(period)}</b> avec ton code PIN. Elle sera envoyée au secrétariat social, signée à ton nom.</>
                : <>Déverrouille la feuille de <b>{periodLabel(period)}</b> avec ton code PIN pour la corriger. Elle repassera en modifiable (pense à la re-valider et la renvoyer ensuite).</>}
            </p>
            <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="Code PIN"
              className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink text-center tracking-widest" autoFocus />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPinModal(false)} className="px-3 py-2 rounded-lg border text-sm text-ink-secondary">Annuler</button>
              <button onClick={pinAction === 'sign' ? signSend : unlockConfirm} disabled={!pin || signing}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${pinAction === 'sign' ? 'bg-emerald-600' : 'bg-amber-600'}`}>
                {signing ? <RefreshCw size={15} className="animate-spin" /> : (pinAction === 'sign' ? <Send size={15} /> : <Unlock size={15} />)}
                {pinAction === 'sign' ? 'Signer & envoyer' : 'Déverrouiller'}
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsModal && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={() => setSettingsModal(false)}>
          <div className="bg-surface border rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <Settings size={18} className="text-brand" />
              <h2 className="font-semibold text-ink text-sm flex-1">Paramètres — envoi de la feuille</h2>
              <button onClick={() => setSettingsModal(false)} className="p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>
            <label className="block mb-3"><span className="text-ink-muted text-xs">E-mail du secrétariat social (destinataire)</span>
              <input value={mailTo} onChange={e => setMailTo(e.target.value)} placeholder="jonathan.junius@easypay-group.com" className="w-full mt-1 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" /></label>
            <label className="block mb-4"><span className="text-ink-muted text-xs">En copie (CC) — optionnel</span>
              <input value={mailCc} onChange={e => setMailCc(e.target.value)} placeholder="mobi@verviersdepannage.be" className="w-full mt-1 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" /></label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSettingsModal(false)} className="px-3 py-2 rounded-lg border text-sm text-ink-secondary">Annuler</button>
              <button onClick={saveSettings} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium"><Save size={15} /> Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
