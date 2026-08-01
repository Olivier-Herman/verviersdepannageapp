'use client'
// src/app/ma-paie/MaPaieClient.tsx
//
// Écran travailleur : mes fiches de paie (accès perso). Le PDF n'est servi que
// si l'utilisateur est bien le propriétaire (cf /api/paie/pdf). Olivier 2026-08-01.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import AnnouncementModal from './AnnouncementModal'
import { FileText, Download, Wallet, Info, Eye, X, CalendarClock, Save, UserCog, Check, CalendarDays, Send, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react'
import { normalizeEtatCivil } from '@/lib/paie/compare-infos'
import { hoursForRange } from '@/lib/conges/apply'

const CONGE_TYPE_LABEL: Record<string, string> = { conge: 'Congé légal', recup: 'Récupération', sans_solde: 'Congé sans solde' }
const fmtDate = (d: string) => { const [y, m, j] = (d || '').split('-'); return j ? `${j}/${m}` : d }
function CongeStatus({ s }: { s: string }) {
  const map: any = { approved: ['bg-emerald-500/10 text-emerald-700', 'Approuvé'], refused: ['bg-red-500/10 text-red-600', 'Refusé'], pending: ['bg-amber-500/10 text-amber-700', 'En attente'], cancel_requested: ['bg-orange-500/10 text-orange-700', 'Annulation demandée'] }
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
  const [tab, setTab] = useState<'home' | 'fiches' | 'conges' | 'infos'>('home')
  const [fyear, setFyear] = useState<string>('')

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

  const cancelMine = async (id: string) => {
    if (!confirm('Annuler cette demande de congé ?')) return
    const r = await fetch('/api/conges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id }) })
    const j = await r.json(); if (j.error) { alert(j.error); return }
    await loadMine()
  }
  const requestCancelMine = async (id: string) => {
    if (!confirm("Demander l'annulation de ce congé ? Un responsable devra la confirmer.")) return
    const r = await fetch('/api/conges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request_cancel', id }) })
    const j = await r.json(); if (j.error) { alert(j.error); return }
    await loadMine()
  }

  const congeHours = (congeForm.start_date && congeForm.end_date) ? hoursForRange(data?.dayHours || {}, congeForm.start_date, congeForm.end_date) : 0

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
  const dispName = data?.name || userName || ''
  // Nom stocké « NOM Prénom » → prénom = dernier mot, joliment capitalisé.
  const prenom = (dispName.split(/\s+/).slice(-1)[0] || '').toLowerCase().replace(/(^|[-'])([a-zà-ÿ])/g, (_: string, s: string, c: string) => s + c.toUpperCase())
  const hello = (typeof window !== 'undefined' && new Date().getHours() >= 18) ? 'Bonsoir' : 'Bonjour'
  const initials = (dispName || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('')
  const congesPending = (data?.conges || []).filter((c: any) => c.status === 'pending' || c.status === 'cancel_requested').length
  const multiCompany = new Set(slips.map(s => s.company_code)).size > 1
  // Groupé par année (desc).
  const byYear: Record<string, any[]> = {}
  for (const s of slips) { const y = (s.period || '').split('-')[0]; (byYear[y] = byYear[y] || []).push(s) }
  const years = Object.keys(byYear).sort().reverse()
  const activeYear = fyear && years.includes(fyear) ? fyear : years[0]

  return (
    <AppShell title="Mes Prestations" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <AnnouncementModal />
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand/15 via-brand/5 to-transparent border border-brand/10 p-6 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-brand text-white flex items-center justify-center font-bold text-xl shadow-sm flex-shrink-0">{initials || <Wallet size={26} />}</div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-ink leading-tight flex items-center gap-2 flex-wrap">{hello}{prenom ? ` ${prenom}` : ''} <Sparkles size={18} className="text-brand" /></h1>
              <p className="text-ink-muted text-sm">Bienvenue dans ton espace personnel</p>
            </div>
          </div>
        </div>

        {/* Solde congés (dernier compteur connu) — accueil */}
        {!loading && tab === 'home' && data?.vacation && (data.vacation.available != null || data.vacation.total != null) && (
          <div className="bg-gradient-to-br from-brand/10 to-brand/[0.03] border border-brand/20 rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock size={18} className="text-brand" />
              <h2 className="font-semibold text-ink text-sm">Solde congés</h2>
              <span className="text-ink-muted text-xs ml-auto">au {monthLabel(data.vacation.period)} {(data.vacation.period || '').split('-')[0]}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-3xl font-bold text-brand tabular-nums">{data.vacation.available ?? '—'}</div><div className="text-ink-muted text-xs mt-0.5">disponibles (h)</div></div>
              <div><div className="text-2xl font-bold text-ink tabular-nums">{data.vacation.used ?? '—'}</div><div className="text-ink-muted text-xs mt-0.5">prises (h)</div></div>
              <div><div className="text-2xl font-bold text-ink-secondary tabular-nums">{data.vacation.total ?? '—'}</div><div className="text-ink-muted text-xs mt-0.5">total (h)</div></div>
            </div>
          </div>
        )}

        {/* Accueil : 3 grands boutons colorés */}
        {!loading && data?.linked && tab === 'home' && (
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { k: 'infos',  title: 'Mes infos',          desc: 'Coordonnées, IBAN, contact', Icon: UserCog,      from: 'from-sky-500/15',    to: 'to-sky-500/5',    ring: 'hover:border-sky-500/40',    ic: 'bg-sky-500/15 text-sky-500' },
              { k: 'fiches', title: 'Mes fiches de paie', desc: `${slips.length} fiche${slips.length > 1 ? 's' : ''} disponible${slips.length > 1 ? 's' : ''}`, Icon: FileText, from: 'from-brand/15', to: 'to-brand/5', ring: 'hover:border-brand/40', ic: 'bg-brand/15 text-brand' },
              { k: 'conges', title: 'Mes congés',         desc: congesPending ? `${congesPending} en cours` : 'Demander un congé', Icon: CalendarDays, from: 'from-amber-500/15', to: 'to-amber-500/5', ring: 'hover:border-amber-500/40', ic: 'bg-amber-500/15 text-amber-500' },
            ].map(c => (
              <button key={c.k} onClick={() => setTab(c.k as any)}
                className={`group relative flex flex-col gap-4 bg-gradient-to-br ${c.from} ${c.to} border rounded-2xl p-5 text-left transition-all hover:shadow-lg hover:-translate-y-1 ${c.ring}`}>
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${c.ic}`}><c.Icon size={24} /></div>
                <div>
                  <div className="flex items-center gap-1 text-ink font-bold text-lg">{c.title}<ChevronRight size={18} className="text-ink-muted group-hover:text-ink group-hover:translate-x-0.5 transition-transform" /></div>
                  <p className="text-ink-muted text-sm mt-0.5">{c.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Retour à l'accueil */}
        {!loading && data?.linked && tab !== 'home' && (
          <button onClick={() => setTab('home')} className="inline-flex items-center gap-1.5 text-ink-muted hover:text-brand text-sm mb-4"><ChevronLeft size={16} /> Mes Prestations</button>
        )}

        {/* Mes congés : demande + suivi */}
        {!loading && data?.linked && tab === 'conges' && (
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
            <div className="flex items-center gap-3 mt-3">
              <button onClick={submitConge} disabled={submittingConge} className="inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"><Send size={15} /> {submittingConge ? 'Envoi…' : 'Envoyer la demande'}</button>
              {congeHours > 0 && <span className="text-xs text-ink-muted">≈ <b className="text-ink-secondary">{congeHours} h</b> décomptées</span>}
            </div>

            {(data.conges || []).length > 0 && (
              <div className="mt-5 border-t pt-4 flex flex-col gap-1.5">
                <div className="text-ink-muted text-xs mb-1">Mes demandes</div>
                {data.conges.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm bg-surface-2 rounded-lg px-3 py-2">
                    <span className="text-ink">{CONGE_TYPE_LABEL[c.type] || c.type}</span>
                    <span className="text-ink-muted text-xs">{fmtDate(c.start_date)}→{fmtDate(c.end_date)} · {c.hours != null ? `${c.hours} h` : `${c.days} j`}</span>
                    {c.status === 'pending' && <button onClick={() => cancelMine(c.id)} className="text-[11px] text-ink-muted hover:text-red-400 underline">annuler</button>}
                    {c.status === 'approved' && <button onClick={() => requestCancelMine(c.id)} className="text-[11px] text-ink-muted hover:text-orange-500 underline">demander l'annulation</button>}
                    <span className="ml-auto"><CongeStatus s={c.status} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Self-service : mes informations personnelles */}
        {!loading && data?.linked && tab === 'infos' && (
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

        {!loading && data?.linked && tab === 'fiches' && slips.length === 0 && (
          <p className="text-ink-muted text-sm italic">Aucune fiche disponible pour le moment.</p>
        )}

        {!loading && tab === 'fiches' && slips.length > 0 && (
          <div className="flex flex-col gap-4">
            {years.length > 1 && (
              <div className="inline-flex gap-1 p-1 bg-surface border rounded-xl self-start max-w-full overflow-x-auto">
                {years.map(y => (
                  <button key={y} onClick={() => setFyear(y)}
                    className={`px-3.5 py-1.5 rounded-lg text-sm whitespace-nowrap ${activeYear === y ? 'bg-brand text-white font-medium' : 'text-ink-muted hover:text-ink'}`}>{y}</button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              {(byYear[activeYear] || []).map((s: any) => (
                <button key={s.id} onClick={() => setPreview(s)}
                  className="flex items-center gap-3 bg-surface border rounded-xl px-4 py-3 hover:border-brand/40 transition group text-left w-full">
                  <div className="w-9 h-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center flex-shrink-0"><FileText size={18} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-ink font-medium"><span className="capitalize">{monthLabel(s.period)}</span> {activeYear}</div>
                    <div className="text-ink-muted text-xs">
                      {ficheLabel(s)}{multiCompany ? ` · ${COMPANIES[s.company_code] || s.company_code}` : ''}
                    </div>
                  </div>
                  <Eye size={18} className="text-ink-muted group-hover:text-brand flex-shrink-0" />
                </button>
              ))}
            </div>
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
