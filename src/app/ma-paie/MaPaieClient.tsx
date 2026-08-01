'use client'
// src/app/ma-paie/MaPaieClient.tsx
//
// Écran travailleur : mes fiches de paie (accès perso). Le PDF n'est servi que
// si l'utilisateur est bien le propriétaire (cf /api/paie/pdf). Olivier 2026-08-01.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { FileText, Download, Wallet, Info, Eye, X, CalendarClock, Save, UserCog, Check, CalendarDays, Send } from 'lucide-react'
import { normalizeEtatCivil } from '@/lib/paie/compare-infos'

const CONGE_TYPE_LABEL: Record<string, string> = { conge: 'Congé légal', recup: 'Récupération', sans_solde: 'Congé sans solde' }
const fmtDate = (d: string) => { const [y, m, j] = (d || '').split('-'); return j ? `${j}/${m}` : d }
function CongeStatus({ s }: { s: string }) {
  const map: any = { approved: ['bg-emerald-500/10 text-emerald-700', 'Approuvé'], refused: ['bg-red-500/10 text-red-600', 'Refusé'], pending: ['bg-amber-500/10 text-amber-700', 'En attente'] }
  const [cls, lbl] = map[s] || map.pending
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${cls} flex-shrink-0`}>{lbl}</span>
}

// Champ défini au niveau module (sinon perte de focus à chaque frappe).
function MeInput({ label, k, form, onChange, type = 'text', full }: any) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-ink-muted text-xs">{label}</span>
      <input type={type} value={form[k] ?? ''} onChange={e => onChange(k, e.target.value)}
        className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink" />
    </label>
  )
}

const COMPANIES: Record<string, string> = { '438': 'Verviers Dépannage', '3068': 'DGJ VHU' }
const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const monthLabel = (p: string) => { const m = parseInt((p || '').split('-')[1]); return MONTHS[m] || p }
const TYPE_LABELS: Record<string, string> = { salaire: 'Salaire', prime: 'Prime', vacances: 'Pécule de vacances', conge: 'Congé', autre: 'Autre' }
export const ficheLabel = (s: any) => s.label || TYPE_LABELS[s.type] || (s.type ? s.type : 'Salaire')

export default function MaPaieClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData]   = useState<any>(null)
  const [loading, setLd]  = useState(true)
  const [preview, setPreview] = useState<any>(null)
  const [meForm, setMeForm] = useState<any>({})
  const [savingInfo, setSavingInfo] = useState(false)
  const [savedInfo, setSavedInfo] = useState(false)
  const [congeForm, setCongeForm] = useState<any>({ type: 'conge' })
  const [submittingConge, setSubmittingConge] = useState(false)

  const loadMine = () => fetch('/api/paie/mine', { cache: 'no-store' }).then(r => r.json())
    .then(d => { setData(d); if (d?.me) { if (d.me.etat_civil) d.me.etat_civil = normalizeEtatCivil(d.me.etat_civil); setMeForm(d.me) } })

  useEffect(() => { loadMine().catch(() => setData({ payslips: [], linked: false })).finally(() => setLd(false)) }, [])

  const submitConge = async () => {
    if (!congeForm.start_date || !congeForm.end_date) { alert('Indique les dates de début et de fin.'); return }
    setSubmittingConge(true)
    try {
      const r = await fetch('/api/conges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request', ...congeForm }) })
      const j = await r.json()
      if (j.error) { alert(j.error); return }
      alert('Demande de congé envoyée. Tu seras notifié de la décision.')
      setCongeForm({ type: 'conge' }); await loadMine()
    } finally { setSubmittingConge(false) }
  }

  const setMe = (k: string, v: any) => { setMeForm((f: any) => ({ ...f, [k]: v })); setSavedInfo(false) }
  const saveInfos = async () => {
    setSavingInfo(true)
    try {
      const r = await fetch('/api/paie/mes-infos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meForm) })
      const j = await r.json()
      if (j.error) { alert(j.error); return }
      setSavedInfo(true)
      if (j.changed > 0) alert(`Modification${j.changed > 1 ? 's' : ''} enregistrée${j.changed > 1 ? 's' : ''} et transmise${j.changed > 1 ? 's' : ''} à l'administration.`)
    } finally { setSavingInfo(false) }
  }

  const slips: any[] = data?.payslips || []
  const multiCompany = new Set(slips.map(s => s.company_code)).size > 1
  // Groupé par année (desc).
  const byYear: Record<string, any[]> = {}
  for (const s of slips) { const y = (s.period || '').split('-')[0]; (byYear[y] = byYear[y] || []).push(s) }
  const years = Object.keys(byYear).sort().reverse()

  return (
    <AppShell title="Mes Prestations" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><Wallet size={24} /></div>
          <div>
            <h1 className="text-xl font-bold text-ink leading-tight">Mes Prestations</h1>
            <p className="text-ink-muted text-sm">{data?.name || userName}</p>
          </div>
        </div>

        {/* Solde congés (dernier compteur connu) */}
        {!loading && data?.vacation && (data.vacation.available != null || data.vacation.total != null) && (
          <div className="bg-surface border rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock size={18} className="text-brand" />
              <h2 className="font-semibold text-ink text-sm">Solde congés</h2>
              <span className="text-ink-muted text-xs ml-auto">au {monthLabel(data.vacation.period)} {(data.vacation.period || '').split('-')[0]}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-2xl font-bold text-brand tabular-nums">{data.vacation.available ?? '—'}</div><div className="text-ink-muted text-xs mt-0.5">disponibles (h)</div></div>
              <div><div className="text-2xl font-bold text-ink tabular-nums">{data.vacation.used ?? '—'}</div><div className="text-ink-muted text-xs mt-0.5">prises (h)</div></div>
              <div><div className="text-2xl font-bold text-ink-secondary tabular-nums">{data.vacation.total ?? '—'}</div><div className="text-ink-muted text-xs mt-0.5">total (h)</div></div>
            </div>
          </div>
        )}

        {/* Mes congés : demande + suivi */}
        {!loading && data?.linked && (
          <div className="bg-surface border rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-3"><CalendarDays size={18} className="text-brand" /><h2 className="font-semibold text-ink text-sm">Mes congés</h2></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-ink-muted text-xs">Type</span>
                <select value={congeForm.type} onChange={e => setCongeForm({ ...congeForm, type: e.target.value })} className="w-full mt-1 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink">
                  {Object.entries(CONGE_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <div className="hidden sm:block" />
              <label className="block"><span className="text-ink-muted text-xs">Du</span>
                <input type="date" value={congeForm.start_date || ''} onChange={e => setCongeForm({ ...congeForm, start_date: e.target.value })} className="w-full mt-1 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" /></label>
              <label className="block"><span className="text-ink-muted text-xs">Au</span>
                <input type="date" value={congeForm.end_date || ''} onChange={e => setCongeForm({ ...congeForm, end_date: e.target.value })} className="w-full mt-1 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" /></label>
            </div>
            <input value={congeForm.reason || ''} onChange={e => setCongeForm({ ...congeForm, reason: e.target.value })} placeholder="Motif (optionnel)" className="w-full mt-3 bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
            <button onClick={submitConge} disabled={submittingConge} className="mt-3 inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"><Send size={15} /> {submittingConge ? 'Envoi…' : 'Envoyer la demande'}</button>

            {(data.conges || []).length > 0 && (
              <div className="mt-5 border-t pt-4 flex flex-col gap-1.5">
                <div className="text-ink-muted text-xs mb-1">Mes demandes</div>
                {data.conges.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm bg-surface-2 rounded-lg px-3 py-2">
                    <span className="text-ink">{CONGE_TYPE_LABEL[c.type] || c.type}</span>
                    <span className="text-ink-muted text-xs">{fmtDate(c.start_date)}→{fmtDate(c.end_date)} · {c.days}j</span>
                    <span className="ml-auto"><CongeStatus s={c.status} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Self-service : mes informations personnelles */}
        {!loading && data?.linked && (
          <div className="bg-surface border rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-1">
              <UserCog size={18} className="text-brand" />
              <h2 className="font-semibold text-ink text-sm">Mes informations</h2>
            </div>
            <p className="text-ink-muted text-xs mb-4">Tiens tes coordonnées à jour. Toute modification est transmise à l'administration pour mise à jour auprès du secrétariat social.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <MeInput label="Adresse (rue + n°)" k="adresse" form={meForm} onChange={setMe} full />
              <MeInput label="Code postal" k="code_postal" form={meForm} onChange={setMe} />
              <MeInput label="Ville" k="ville" form={meForm} onChange={setMe} />
              <label className="block"><span className="text-ink-muted text-xs">État civil</span>
                <select value={meForm.etat_civil || ''} onChange={e => setMe('etat_civil', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                  <option value="">—</option>{['Célibataire', 'Marié(e)', 'Cohabitant(e) légal(e)', 'Divorcé(e)', 'Séparé(e)', 'Veuf/Veuve'].map(t => <option key={t} value={t}>{t}</option>)}
                </select></label>
              <MeInput label="Personnes à charge" k="personnes_charge" type="number" form={meForm} onChange={setMe} />
              <MeInput label="IBAN (versement du salaire)" k="iban" form={meForm} onChange={setMe} full />
              <MeInput label="Téléphone" k="phone" form={meForm} onChange={setMe} />
              <MeInput label="E-mail" k="email" form={meForm} onChange={setMe} />
              <MeInput label="Contact d'urgence (nom)" k="contact_urgence_nom" form={meForm} onChange={setMe} />
              <MeInput label="Contact d'urgence (tél.)" k="contact_urgence_tel" form={meForm} onChange={setMe} />
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button onClick={saveInfos} disabled={savingInfo}
                className="inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                <Save size={15} /> {savingInfo ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              {savedInfo && <span className="inline-flex items-center gap-1 text-emerald-600 text-xs"><Check size={14} /> Transmis à l'administration</span>}
            </div>
          </div>
        )}

        {loading && <p className="text-ink-muted text-sm">Chargement…</p>}

        {!loading && !data?.linked && (
          <div className="bg-info-soft border border-info rounded-2xl p-5 flex items-start gap-3">
            <Info size={20} className="text-info flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink">
              <p className="font-medium mb-1">Aucune fiche liée à ton compte pour l’instant.</p>
              <p className="text-ink-secondary">Tes fiches de paie apparaîtront ici dès qu’elles seront rattachées à ton compte. Contacte l’administration si besoin.</p>
            </div>
          </div>
        )}

        {!loading && data?.linked && slips.length === 0 && (
          <p className="text-ink-muted text-sm italic">Aucune fiche disponible pour le moment.</p>
        )}

        {!loading && slips.length > 0 && (
          <div className="flex flex-col gap-6">
            {years.map(year => (
              <div key={year}>
                <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-wide mb-2">{year}</h2>
                <div className="flex flex-col gap-2">
                  {byYear[year].map((s: any) => (
                    <button key={s.id} onClick={() => setPreview(s)}
                      className="flex items-center gap-3 bg-surface border rounded-xl px-4 py-3 hover:border-brand/40 transition group text-left w-full">
                      <div className="w-9 h-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center flex-shrink-0"><FileText size={18} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-ink font-medium"><span className="capitalize">{monthLabel(s.period)}</span> {year}</div>
                        <div className="text-ink-muted text-xs">
                          {ficheLabel(s)}{multiCompany ? ` · ${COMPANIES[s.company_code] || s.company_code}` : ''}
                        </div>
                      </div>
                      <Eye size={18} className="text-ink-muted group-hover:text-brand flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prévisualisation in-app du PDF */}
      {preview && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 bg-surface border-b">
            <FileText size={18} className="text-brand" />
            <div className="flex-1 min-w-0">
              <div className="text-ink font-medium text-sm"><span className="capitalize">{monthLabel(preview.period)}</span> {(preview.period || '').split('-')[0]}</div>
              <div className="text-ink-muted text-xs">{ficheLabel(preview)}</div>
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
