'use client'
// src/app/personnel/PersonnelClient.tsx
//
// Console RH — Gestion du Personnel & fiches de paie (superadmin).
// Récup auto (mail info@) + import manuel + répertoire + fiches par période.
// Olivier 2026-08-01.

import { useEffect, useState, useCallback, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'
import PersonnelTabs from '@/components/layout/PersonnelTabs'
import { Users, Mail, Upload, Download, RefreshCw, Trash2, FileText, Link2, AlertTriangle, Eye, X, Building2, Send, Check } from 'lucide-react'

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
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const stopRef = useRef(false)

  // Liste des périodes AAAA-MM de `from` jusqu'au mois courant (inclus).
  const monthsFrom = (from: string): string[] => {
    const [fy, fm] = from.split('-').map(Number)
    if (!fy || !fm) return []
    const now = new Date(), cy = now.getFullYear(), cm = now.getMonth() + 1
    const out: string[] = []
    let y = fy, m = fm
    while (y < cy || (y === cy && m <= cm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
    return out
  }

  const load = useCallback(async () => {
    const r = await fetch('/api/personnel', { cache: 'no-store' })
    const j = await r.json()
    if (j.error) { alert(j.error); return }
    setData(j)
    if (!period && j.periods?.length) setPeriod(j.periods[0])
  }, [period])
  useEffect(() => { load() }, [])   // eslint-disable-line

  const fetchMail = async (force = false) => {
    if (force && !confirm('Re-traiter mois par mois (depuis « depuis ») ?\nRelance le découpage IA — les fiches déjà présentes ne sont pas dupliquées.')) return
    const periods = monthsFrom(fromP)
    if (!periods.length) { alert('Période « depuis » invalide (format AAAA-MM).'); return }
    stopRef.current = false
    setBusy('mail')
    let total = 0, totalUpd = 0, credit = false
    const errNotes: string[] = []
    try {
      // Un appel COURT par mois → pas de timeout, progression visible, pas de
      // reprise depuis zéro (chaque mois est indépendant et idempotent).
      for (let i = 0; i < periods.length; i++) {
        if (stopRef.current) break
        setProgress({ done: i, total: periods.length, label: fmtPeriod(periods[i]) })
        let j: any
        try {
          const r = await fetch(`/api/cron/paie-fetch?only=${periods[i]}${force ? '&force=1' : ''}`, { cache: 'no-store' })
          j = await r.json()
        } catch { errNotes.push(`${periods[i]} : interrompu`); continue }
        if (j?.error) {
          if (/credit balance/i.test(String(j.error))) { credit = true; break }
          errNotes.push(`${periods[i]} : ${String(j.error).slice(0, 70)}`); continue
        }
        total    += (j.results || []).reduce((s: number, x: any) => s + (x.stored || 0), 0)
        totalUpd += (j.results || []).reduce((s: number, x: any) => s + (x.updated || 0), 0)
        for (const x of (j.results || [])) {
          if (x.error && /credit balance/i.test(String(x.error))) { credit = true; break }
          if (x.error && errNotes.length < 12) errNotes.push(`${x.company || ''} ${x.period || ''} : ${String(x.error).slice(0, 70)}`)
        }
        if (credit) break
        await load()
      }
    } finally { setProgress(null); setBusy('') }
    if (credit) {
      alert('⚠️ Crédits IA (Anthropic) épuisés.\n\nRecharge le solde sur console.anthropic.com → Billing, puis relance. Ce qui est déjà traité est conservé.')
    } else {
      alert(`${force ? 'Re-traitement' : 'Récupération'} terminé : ${total} ajoutée(s)${totalUpd ? `, ${totalUpd} mise(s) à jour` : ''}.`
        + (errNotes.length ? `\n\n⚠️ Mois en erreur (relance) :\n${errNotes.join('\n')}` : ''))
    }
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

  const ensureAllOdoo = async () => {
    if (!confirm('Créer / lier le contact Odoo pour toutes les personnes actives sans ID ?\n(rattache un fournisseur existant au même nom, sinon crée le contact)')) return
    setBusy('odoo')
    try {
      const r = await fetch('/api/personnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ensure_odoo_all' }) })
      const j = await r.json()
      if (j.error) alert(j.error)
      else alert(`Contacts Odoo : ${j.created} créé(s), ${j.linked} rattaché(s)${j.errors?.length ? `, ${j.errors.length} en erreur` : ''}.`)
      await load()
    } finally { setBusy('') }
  }

  const personnel = data?.personnel || []
  const slips = (data?.payslips || []).filter((s: any) => !period || s.period === period)
  const persById = new Map(personnel.map((p: any) => [p.id, p]))

  return (
    <AppShell title="Gestion du Personnel" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <PersonnelTabs />
        {/* En-tête + actions */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><Users size={22} /></div>
            <div><h1 className="text-xl font-bold text-ink leading-tight">Répertoire du personnel</h1>
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
            <button onClick={ensureAllOdoo} disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand disabled:opacity-50" title="Créer / lier les contacts Odoo manquants">
              {busy === 'odoo' ? <RefreshCw size={15} className="animate-spin" /> : <Building2 size={15} />} Contacts Odoo
            </button>
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand cursor-pointer">
              {busy === 'upload' ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />} Importer
              <input type="file" accept=".zip,.pdf" className="hidden" disabled={!!busy}
                onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = '' }} />
            </label>
            <a href="/personnel/rentabilite" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-ink-secondary hover:text-brand">📈 Rentabilité</a>
          </div>
        </div>

        {progress && (
          <div className="flex items-center gap-3 mb-4 bg-surface border rounded-xl px-4 py-2.5">
            <RefreshCw size={15} className="animate-spin text-brand flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs text-ink-muted mb-1"><span>Traitement · {progress.label}</span><span className="tabular-nums">{progress.done}/{progress.total}</span></div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
            </div>
            <button onClick={() => { stopRef.current = true }} className="text-xs px-2.5 py-1 rounded-lg border text-ink-secondary hover:text-red-400 flex-shrink-0">Arrêter</button>
          </div>
        )}

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
            {/* Modifications self-service à transmettre au secrétariat social */}
            {(data?.pendingChanges?.length > 0) && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-400/50 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Send size={16} className="text-amber-700" />
                  <h2 className="font-semibold text-amber-900 text-sm">À transmettre au secrétariat social</h2>
                  <span className="text-amber-800 text-xs">{data.pendingChanges.length} modif(s)</span>
                  <button onClick={() => post({ action: 'transmit_change', id: 'all' })}
                    className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-amber-400/60 text-amber-800 hover:bg-amber-100/50">
                    <Check size={13} /> Tout marquer transmis
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {data.pendingChanges.map((c: any) => (
                    <div key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-amber-900 bg-white/40 dark:bg-white/5 rounded-lg px-3 py-2">
                      <span className="font-semibold">{c.worker}</span>
                      <span className="text-amber-700">·</span>
                      <span className="font-medium">{c.label} :</span>
                      <span className="text-amber-700 line-through">{c.old_value ?? '—'}</span>
                      <span>→</span>
                      <span className="font-semibold">{c.new_value ?? '—'}</span>
                      <button onClick={() => post({ action: 'transmit_change', id: c.id })}
                        className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-amber-400/60 hover:bg-amber-100/50" title="Marquer transmis">
                        <Check size={12} /> transmis
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Répertoire du personnel */}
            <div className="bg-surface border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className="text-brand" />
                <h2 className="font-semibold text-ink text-sm">Répertoire du personnel</h2>
                {personnel.filter((p: any) => p.mismatch_count > 0).length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 border border-amber-400/50">
                    <AlertTriangle size={12} /> {personnel.filter((p: any) => p.mismatch_count > 0).length} à vérifier
                  </span>
                )}
                <span className="text-ink-muted text-xs ml-auto">{personnel.length} personne(s)</span>
              </div>
              {!personnel.length && <p className="py-4 text-ink-muted text-sm italic">Le répertoire se remplit automatiquement au traitement des fiches.</p>}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {personnel.map((p: any) => {
                  const initials = (p.name || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('')
                  return (
                    <div key={p.id} className="group relative bg-surface-2 border rounded-xl p-4 hover:border-brand/40 hover:shadow-md transition-all">
                      <button onClick={() => { if (confirm(`Supprimer ${p.name} du répertoire ? (les fiches sont conservées, détachées)`)) post({ action: 'delete', id: p.id }) }}
                        className="absolute top-2 right-2 p-1 text-ink-muted/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Retirer du répertoire"><Trash2 size={14} /></button>
                      <a href={`/personnel/${p.id}`} className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold flex-shrink-0">{initials}</div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-ink font-semibold text-sm truncate group-hover:text-brand">{p.name}</span>
                            {p.mismatch_count > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 border border-amber-400/50 flex-shrink-0"
                                title={`Diffère de la fiche de paie : ${(p.mismatch_fields || []).join(', ')}`}><AlertTriangle size={10} /> {p.mismatch_count}</span>
                            )}
                          </div>
                          <div className="text-ink-muted text-xs truncate">{[coLabel(p.company_code), p.matricule && `#${p.matricule}`].filter(Boolean).join(' · ')}</div>
                        </div>
                      </a>
                      <div className="flex items-center gap-2 mt-3">
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-white/5 text-ink-secondary flex-shrink-0"><FileText size={11} /> {p.payslip_count}</span>
                        <select value={p.user_id || ''} onChange={e => post({ action: 'update', id: p.id, user_id: e.target.value || null })}
                          className="flex-1 min-w-0 bg-surface border rounded-lg px-2 py-1 text-xs text-ink" title="Compte app lié">
                          <option value="">— non lié —</option>
                          {(data.users || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

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
