'use client'
// src/app/personnel/PersonnelClient.tsx
//
// Console RH — Gestion du Personnel & fiches de paie (superadmin).
// Récup auto (mail info@) + import manuel + répertoire + fiches par période.
// Olivier 2026-08-01.

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Users, Mail, Upload, Download, RefreshCw, Trash2, FileText, Link2, AlertTriangle, Eye, X } from 'lucide-react'

const COMPANIES: Record<string, string> = { '438': 'Verviers Dépannage', '3068': 'DGJ VHU' }
const coLabel = (c: string) => COMPANIES[c] || c || '—'
const fmtPeriod = (p: string) => { const [y, m] = (p || '').split('-'); return m ? `${m}/${y}` : p }
const TYPE_LABELS: Record<string, string> = { salaire: 'Salaire', prime: 'Prime', vacances: 'Pécule de vacances', conge: 'Congé', autre: 'Autre' }
const ficheLabel = (s: any) => s.label || TYPE_LABELS[s.type] || (s.type || 'Salaire')

export default function PersonnelClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData]     = useState<any>(null)
  const [period, setPeriod] = useState<string>('')
  const [busy, setBusy]     = useState('')
  const [company, setCompany] = useState('438')
  const [fromP, setFromP]   = useState('2025-01')   // borne du backfill mail
  const [preview, setPreview] = useState<any>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/personnel', { cache: 'no-store' })
    const j = await r.json()
    if (j.error) { alert(j.error); return }
    setData(j)
    if (!period && j.periods?.length) setPeriod(j.periods[0])
  }, [period])
  useEffect(() => { load() }, [])   // eslint-disable-line

  const fetchMail = async (force = false) => {
    if (force && !confirm('Re-traiter les mois (depuis la période « depuis ») pour capter les primes/congés ajoutés ?\nRelance le découpage IA — les fiches déjà présentes ne sont pas dupliquées. Restreins « depuis » pour aller vite.')) return
    setBusy('mail')
    let total = 0, err = ''
    try {
      // Boucle : chaque appel traite les périodes manquantes (idempotent). Si un
      // appel dépasse le timeout, on relance jusqu'à ce qu'il n'y ait plus rien.
      for (let round = 0; round < 20; round++) {
        let j: any
        try {
          const r = await fetch(`/api/cron/paie-fetch?from=${encodeURIComponent(fromP)}${force ? '&force=1' : ''}`, { cache: 'no-store' })
          j = await r.json()
        } catch { continue }   // timeout → on relance
        if (j?.error) { err = j.error; break }
        const stored = (j.results || []).reduce((s: number, x: any) => s + (x.stored || 0), 0)
        total += stored
        await load()
        if (stored === 0) break   // plus rien de nouveau
      }
    } finally { setBusy('') }
    alert(err ? `Erreur : ${err}` : `${force ? 'Re-traitement' : 'Récupération'} terminé : ${total} fiche(s) ajoutée(s).`)
  }

  const upload = async (file: File) => {
    if (!period) { alert('Choisis d’abord une période (ex. 2026-07).'); return }
    setBusy('upload')
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1] || ''); rd.onerror = rej; rd.readAsDataURL(file)
      })
      const r = await fetch('/api/paie/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_b64: b64, filename: file.name, period, company_code: company }) })
      const j = await r.json()
      if (j.error) alert(j.error); else alert(`Import : ${j.stored} fiche(s) stockée(s), ${j.skipped} ignorée(s) (sur ${j.total}).`)
      await load()
    } finally { setBusy('') }
  }

  const post = async (payload: any) => { await fetch('/api/personnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await load() }

  const personnel = data?.personnel || []
  const slips = (data?.payslips || []).filter((s: any) => !period || s.period === period)
  const persById = new Map(personnel.map((p: any) => [p.id, p]))

  return (
    <AppShell title="Gestion du Personnel" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* En-tête + actions */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><Users size={22} /></div>
            <div><h1 className="text-xl font-bold text-ink leading-tight">Gestion du Personnel</h1>
              <p className="text-ink-muted text-sm">Fiches de paie EasyPay — récupération & répertoire</p></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-ink-muted text-xs">depuis</span>
            <input value={fromP} onChange={e => setFromP(e.target.value)} placeholder="AAAA-MM" className="bg-surface border rounded-lg px-2 py-1.5 text-sm w-24" title="Remonter jusqu'à cette période" />
            <button onClick={() => fetchMail(false)} disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
              {busy === 'mail' ? <RefreshCw size={15} className="animate-spin" /> : <Mail size={15} />} Récupérer (mail)
            </button>
            <button onClick={() => fetchMail(true)} disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand disabled:opacity-50" title="Re-traiter pour capter primes/congés ajoutés">
              <RefreshCw size={15} /> Re-traiter
            </button>
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand cursor-pointer">
              {busy === 'upload' ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />} Importer
              <input type="file" accept=".zip,.pdf" className="hidden" disabled={!!busy}
                onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = '' }} />
            </label>
            <a href="/personnel/rentabilite" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand">📈 Rentabilité</a>
          </div>
        </div>

        {/* Filtres import/période */}
        <div className="flex items-center gap-2 mb-5 text-sm flex-wrap">
          <span className="text-ink-muted">Période</span>
          <select value={period} onChange={e => setPeriod(e.target.value)} className="bg-surface border rounded-lg px-2 py-1.5">
            {(data?.periods || []).map((p: string) => <option key={p} value={p}>{fmtPeriod(p)}</option>)}
            {!(data?.periods || []).length && <option value="">—</option>}
          </select>
          <input value={period} onChange={e => setPeriod(e.target.value)} placeholder="AAAA-MM" className="bg-surface border rounded-lg px-2 py-1.5 w-28" />
          <span className="text-ink-muted ml-2">Société (import)</span>
          <select value={company} onChange={e => setCompany(e.target.value)} className="bg-surface border rounded-lg px-2 py-1.5">
            <option value="438">Verviers Dépannage (438)</option>
            <option value="3068">DGJ VHU (3068)</option>
          </select>
        </div>

        {!data && <p className="text-ink-muted text-sm">Chargement…</p>}

        {data && (
          <div className="flex flex-col gap-6">
            {/* Fiches de paie de la période */}
            <div className="bg-surface border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <FileText size={16} className="text-brand" />
                <h2 className="font-semibold text-ink text-sm">Fiches de paie · {fmtPeriod(period) || '—'}</h2>
                <span className="text-ink-muted text-xs ml-auto">{slips.length} fiche(s)</span>
              </div>
              {slips.length === 0 ? (
                <p className="text-ink-muted text-sm italic">Aucune fiche pour cette période. « Récupérer (mail) » ou « Importer ».</p>
              ) : (
                <div className="flex flex-col divide-y divide-white/5">
                  {slips.map((s: any) => {
                    const p: any = s.personnel_id ? persById.get(s.personnel_id) : null
                    return (
                      <div key={s.id} className="flex items-center gap-2 py-2 text-sm">
                        <FileText size={14} className="text-ink-muted flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-ink">{p?.name || s.worker_name || '—'}</span>
                          <span className="text-ink-secondary text-xs ml-2">· {ficheLabel(s)}</span>
                          <span className="text-ink-muted text-xs ml-2">{coLabel(s.company_code)}</span>
                          {!s.personnel_id && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 inline-flex items-center gap-0.5"><AlertTriangle size={10} />à rattacher</span>}
                        </div>
                        {!s.personnel_id && (
                          <select onChange={e => e.target.value && post({ action: 'reassign', payslip_id: s.id, personnel_id: e.target.value })}
                            className="bg-surface border rounded-lg px-2 py-1 text-xs" defaultValue="">
                            <option value="">Rattacher à…</option>
                            {personnel.map((pp: any) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                          </select>
                        )}
                        <button onClick={() => setPreview(s)} className="p-1.5 text-ink-muted hover:text-brand" title="Prévisualiser"><Eye size={15} /></button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Répertoire du personnel */}
            <div className="bg-surface border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className="text-brand" />
                <h2 className="font-semibold text-ink text-sm">Répertoire du personnel</h2>
                <span className="text-ink-muted text-xs ml-auto">{personnel.length} personne(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead><tr className="text-ink-muted text-[11px] uppercase border-b">
                    <th className="text-left py-2">Nom</th><th className="text-left">Société</th><th className="text-left">Compte app</th><th className="text-center">Fiches</th><th></th>
                  </tr></thead>
                  <tbody>
                    {personnel.map((p: any) => (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-2"><a href={`/personnel/${p.id}`} className="text-ink hover:text-brand font-medium">{p.name}</a></td>
                        <td className="text-ink-muted text-xs">{coLabel(p.company_code)}</td>
                        <td>
                          <select value={p.user_id || ''} onChange={e => post({ action: 'update', id: p.id, user_id: e.target.value || null })}
                            className="bg-surface border rounded-lg px-2 py-1 text-xs max-w-[180px]">
                            <option value="">— non lié —</option>
                            {(data.users || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </td>
                        <td className="text-center text-ink-secondary tabular-nums">{p.payslip_count}</td>
                        <td className="text-right">
                          <button onClick={() => { if (confirm(`Supprimer ${p.name} du répertoire ? (les fiches sont conservées, détachées)`)) post({ action: 'delete', id: p.id }) }}
                            className="p-1 text-ink-muted hover:text-red-400"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                    {!personnel.length && <tr><td colSpan={5} className="py-4 text-ink-muted text-sm italic">Le répertoire se remplit automatiquement au traitement des fiches.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-ink-muted text-xs text-center">
              Phase de test (superadmin). Ensuite : accès perso — chaque travailleur consultera ses propres fiches. Surveillance mail auto à activer.
            </p>
          </div>
        )}
      </div>

      {/* Prévisualisation in-app du PDF */}
      {preview && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 bg-surface border-b">
            <FileText size={18} className="text-brand" />
            <div className="flex-1 min-w-0">
              <div className="text-ink font-medium text-sm">{personnel.find((pp: any) => pp.id === preview.personnel_id)?.name || preview.worker_name} · {fmtPeriod(preview.period)}</div>
              <div className="text-ink-muted text-xs">{ficheLabel(preview)} · {coLabel(preview.company_code)}</div>
            </div>
            <a href={`/api/paie/pdf?id=${preview.id}`} download target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm text-ink-secondary hover:text-brand"><Download size={15} /> Télécharger</a>
            <button onClick={() => setPreview(null)} className="p-1.5 text-ink-muted hover:text-ink"><X size={20} /></button>
          </div>
          <iframe src={`/api/paie/pdf?id=${preview.id}`} className="flex-1 w-full bg-white" title="Fiche de paie" />
        </div>
      )}
    </AppShell>
  )
}
