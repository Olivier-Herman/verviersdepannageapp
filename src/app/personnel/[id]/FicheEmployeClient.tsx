'use client'
// src/app/personnel/[id]/FicheEmployeClient.tsx — Fiche employé (superadmin).

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, User, Save, FileText, Eye, Download, X, CalendarClock, Building2, CheckCircle2, AlertTriangle } from 'lucide-react'

const COMPANIES: Record<string, string> = { '438': 'Verviers Dépannage', '3068': 'DGJ VHU' }
const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const monthLabel = (p: string) => { const m = parseInt((p || '').split('-')[1]); return MONTHS[m] || p }
const TYPE_LABELS: Record<string, string> = { salaire: 'Salaire', prime: 'Prime', vacances: 'Pécule de vacances', conge: 'Congé', autre: 'Autre' }
const ficheLabel = (s: any) => s.label || TYPE_LABELS[s.type] || (s.type || 'Salaire')

// Champ texte — défini au niveau module (sinon il est recréé à chaque render →
// l'input perd le focus à chaque frappe). Reçoit form/set en props.
function Fld({ label, k, form, set, type = 'text', ph }: any) {
  return (
    <label className="block">
      <span className="text-ink-muted text-xs">{label}</span>
      <input type={type} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={ph}
        className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink" />
    </label>
  )
}

export default function FicheEmployeClient({ id, userRole, userName, userEmail, userModules }: {
  id: string; userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData] = useState<any>(null)
  const [tab, setTab]   = useState<'infos' | 'paie' | 'conges'>('infos')
  const [form, setForm] = useState<any>({})
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [pushing, setPushing] = useState<string | null>(null)
  const [ensuring, setEnsuring] = useState(false)

  const ensureOdoo = async () => {
    setEnsuring(true)
    try {
      const r = await fetch('/api/personnel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ensure_odoo', id }) })
      const j = await r.json()
      if (j.error) alert(j.error)
      else { alert(j.created ? `Contact Odoo créé (id ${j.partnerId}).` : `Rattaché au fournisseur Odoo existant (id ${j.partnerId}).`); await load() }
    } finally { setEnsuring(false) }
  }

  const pushOne = async (slip: any) => {
    setPushing(slip.id)
    try {
      const r = await fetch('/api/paie/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payslip_id: slip.id }) })
      const j = await r.json()
      if (j.error) alert(j.error)
      else await load()
    } finally { setPushing(null) }
  }

  const load = useCallback(async () => {
    const r = await fetch(`/api/personnel/${id}`, { cache: 'no-store' })
    const j = await r.json()
    if (j.error) { alert(j.error); return }
    setData(j); setForm(j.person || {})
  }, [id])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/personnel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id,
          name: form.name, poste: form.poste, statut: form.statut, type_contrat: form.type_contrat, matricule: form.matricule,
          company_code: form.company_code, date_entree: form.date_entree || null, date_sortie: form.date_sortie || null,
          phone: form.phone, email: form.email, odoo_partner_id: form.odoo_partner_id || null,
          user_id: form.user_id || null, notes: form.notes, active: form.active }) })
      const j = await r.json()
      if (j.error) alert(j.error); else await load()
    } finally { setBusy(false) }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  const p = data?.person
  const slips = data?.payslips || []
  const vac = data?.vacation

  return (
    <AppShell title="Fiche employé" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <a href="/personnel" className="inline-flex items-center gap-1.5 text-ink-muted hover:text-brand text-sm mb-4"><ArrowLeft size={15} /> Répertoire</a>

        {!data && <p className="text-ink-muted text-sm">Chargement…</p>}
        {p && (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold">{(p.name || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</div>
              <div>
                <h1 className="text-xl font-bold text-ink leading-tight">{p.name}</h1>
                <p className="text-ink-muted text-sm">{[p.poste, COMPANIES[p.company_code] || p.company_code, p.matricule && `matr. ${p.matricule}`].filter(Boolean).join(' · ')}</p>
              </div>
              {p.active === false && <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-ink-muted">inactif</span>}
            </div>

            {(data.mismatches?.length > 0) && (
              <div className="mb-5 rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 mb-1 text-amber-800">
                  <AlertTriangle size={16} />
                  <span className="font-semibold text-sm">Incohérence avec la fiche de paie{data.mismatchPeriod ? ` (${monthLabel(data.mismatchPeriod)} ${(data.mismatchPeriod || '').split('-')[0]})` : ''}</span>
                </div>
                <p className="text-amber-800/90 text-xs mb-2">Ces infos diffèrent entre VD Soft et la dernière fiche de paie reçue — à vérifier (une modif pas encore adaptée par le secrétariat social ?).</p>
                <ul className="flex flex-col gap-1">
                  {data.mismatches.map((m: any) => (
                    <li key={m.key} className="text-xs text-amber-900 flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold">{m.label} —</span>
                      <span>VD Soft : « {String(m.vdsoft ?? '—')} »</span>
                      <span className="text-amber-700">vs</span>
                      <span>Fiche : « {String(m.fiche ?? '—')} »</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-1 border-b mb-5">
              {[['infos', 'Infos'], ['paie', `Paie (${slips.length})`], ['conges', 'Congés']].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k as any)} className={`text-sm px-3 py-2 border-b-2 ${tab === k ? 'border-brand text-brand font-semibold' : 'border-transparent text-ink-muted'}`}>{l}</button>
              ))}
            </div>

            {tab === 'infos' && (
              <div className="flex flex-col gap-6">

                <section className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Identité</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Fld label="Nom" k="name" form={form} set={set} />
                    <Fld label="Date de naissance" k="birth_date" type="date" form={form} set={set} />
                    <Fld label="Lieu de naissance" k="birth_place" form={form} set={set} />
                    <Fld label="Nationalité" k="nationalite" ph="Belge" form={form} set={set} />
                    <Fld label="N° national (NISS)" k="national_number" ph="00.00.00-000.00" form={form} set={set} />
                    <label className="block"><span className="text-ink-muted text-xs">État civil</span>
                      <select value={form.etat_civil || ''} onChange={e => set('etat_civil', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                        <option value="">—</option>{['Célibataire', 'Marié(e)', 'Cohabitant(e) légal(e)', 'Divorcé(e)', 'Séparé(e)', 'Veuf/Veuve'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select></label>
                    <Fld label="Personnes à charge" k="personnes_charge" type="number" ph="0" form={form} set={set} />
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Coordonnées</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2"><Fld label="Adresse (rue + n°)" k="adresse" form={form} set={set} /></div>
                    <Fld label="Code postal" k="code_postal" form={form} set={set} />
                    <Fld label="Ville" k="ville" form={form} set={set} />
                    <Fld label="Pays" k="pays" ph="Belgique" form={form} set={set} />
                    <Fld label="Téléphone" k="phone" form={form} set={set} />
                    <Fld label="E-mail" k="email" form={form} set={set} />
                    <Fld label="Contact d'urgence (nom)" k="contact_urgence_nom" form={form} set={set} />
                    <Fld label="Contact d'urgence (tél.)" k="contact_urgence_tel" form={form} set={set} />
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Emploi</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Fld label="Poste" k="poste" ph="Chauffeur dépanneur" form={form} set={set} />
                    <label className="block"><span className="text-ink-muted text-xs">Statut (compte de charge Odoo)</span>
                      <select value={form.statut || ''} onChange={e => set('statut', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                        <option value="">Ouvrier (défaut · 620300)</option>
                        <option value="ouvrier">Ouvrier · 620300</option>
                        <option value="employe">Employé · 620200</option>
                        <option value="gerant">Gérant / dirigeant · 620000</option>
                      </select></label>
                    <label className="block"><span className="text-ink-muted text-xs">Type de contrat</span>
                      <select value={form.type_contrat || ''} onChange={e => set('type_contrat', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                        <option value="">—</option>{['CDI', 'CDD', 'Intérim', 'Étudiant', 'Flexi'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select></label>
                    <Fld label="Matricule EasyPay" k="matricule" form={form} set={set} />
                    <label className="block"><span className="text-ink-muted text-xs">Société</span>
                      <select value={form.company_code || ''} onChange={e => set('company_code', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                        <option value="">—</option><option value="438">Verviers Dépannage</option><option value="3068">DGJ VHU</option>
                      </select></label>
                    <label className="block"><span className="text-ink-muted text-xs">Compte app</span>
                      <select value={form.user_id || ''} onChange={e => set('user_id', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                        <option value="">— non lié —</option>{(data.users || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select></label>
                    <Fld label="Date d'entrée" k="date_entree" type="date" form={form} set={set} />
                    <Fld label="Date de sortie" k="date_sortie" type="date" form={form} set={set} />
                    <div className="flex flex-col gap-1">
                      <Fld label="ID contact Odoo" k="odoo_partner_id" ph="ex : 1234" form={form} set={set} />
                      {!form.odoo_partner_id && (
                        <button type="button" onClick={ensureOdoo} disabled={ensuring}
                          className="self-start inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border text-ink-secondary hover:text-brand hover:border-brand/40 disabled:opacity-50">
                          <Building2 size={12} /> {ensuring ? 'Création…' : 'Créer / lier le contact Odoo'}
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Bancaire</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2"><Fld label="IBAN (versement du salaire)" k="iban" ph="BE00 0000 0000 0000" form={form} set={set} /></div>
                  </div>
                </section>

                <label className="block"><span className="text-ink-muted text-xs">Notes</span>
                  <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink" /></label>

                <div className="flex items-center gap-3">
                  <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"><Save size={15} /> Enregistrer</button>
                  <span className="text-ink-muted text-xs">L'ID Odoo renseigné → nom, tél., e-mail et adresse sont synchronisés vers le contact Odoo.</span>
                </div>
              </div>
            )}

            {tab === 'paie' && (
              <div className="flex flex-col gap-2">
                {slips.length === 0 && <p className="text-ink-muted text-sm italic">Aucune fiche.</p>}
                {slips.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 bg-surface border rounded-xl px-4 py-3">
                    <button onClick={() => setPreview(s)} className="flex items-center gap-3 flex-1 min-w-0 text-left hover:text-brand">
                      <FileText size={16} className="text-brand flex-shrink-0" />
                      <div className="flex-1 min-w-0"><div className="text-ink text-sm"><span className="capitalize">{monthLabel(s.period)}</span> {(s.period || '').split('-')[0]}</div>
                        <div className="text-ink-muted text-xs">{ficheLabel(s)}{s.montant_net != null ? ` · net ${Math.round(s.montant_net)} €` : ''}</div></div>
                    </button>
                    {s.odoo_move_id ? (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-700" title={`Facture Odoo #${s.odoo_move_id}`}><CheckCircle2 size={13} /> Dans Odoo</span>
                    ) : s.type === 'salaire' || s.montant_net != null ? (
                      <button onClick={() => pushOne(s)} disabled={pushing === s.id || s.montant_net == null}
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border text-ink-secondary hover:text-brand hover:border-brand/40 disabled:opacity-40"
                        title={s.montant_net == null ? 'Montant net manquant — relancer « Re-traiter »' : 'Créer la facture fournisseur dans Odoo'}>
                        <Building2 size={13} /> {pushing === s.id ? '…' : 'Odoo'}
                      </button>
                    ) : null}
                    <button onClick={() => setPreview(s)} className="p-1 text-ink-muted hover:text-ink flex-shrink-0"><Eye size={16} /></button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'conges' && (
              vac ? (
                <div className="bg-surface border rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3"><CalendarClock size={18} className="text-brand" /><h2 className="font-semibold text-ink text-sm">Solde congés</h2><span className="text-ink-muted text-xs ml-auto">au {monthLabel(vac.period)} {(vac.period || '').split('-')[0]}</span></div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><div className="text-2xl font-bold text-brand tabular-nums">{vac.available ?? '—'}</div><div className="text-ink-muted text-xs">disponibles (h)</div></div>
                    <div><div className="text-2xl font-bold text-ink tabular-nums">{vac.used ?? '—'}</div><div className="text-ink-muted text-xs">prises (h)</div></div>
                    <div><div className="text-2xl font-bold text-ink-secondary tabular-nums">{vac.total ?? '—'}</div><div className="text-ink-muted text-xs">total (h)</div></div>
                  </div>
                </div>
              ) : <p className="text-ink-muted text-sm italic">Pas de compteur de congés lu sur les fiches (relance « Re-traiter » si besoin).</p>
            )}
          </>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 bg-surface border-b">
            <FileText size={18} className="text-brand" />
            <div className="flex-1 min-w-0"><div className="text-ink font-medium text-sm"><span className="capitalize">{monthLabel(preview.period)}</span> {(preview.period || '').split('-')[0]}</div><div className="text-ink-muted text-xs">{ficheLabel(preview)}</div></div>
            <a href={`/api/paie/pdf?id=${preview.id}`} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm text-ink-secondary hover:text-brand"><Download size={15} /> Télécharger</a>
            <button onClick={() => setPreview(null)} className="p-1.5 text-ink-muted hover:text-ink"><X size={20} /></button>
          </div>
          <iframe src={`/api/paie/pdf?id=${preview.id}`} className="flex-1 w-full bg-white" title="Fiche de paie" />
        </div>
      )}
    </AppShell>
  )
}
