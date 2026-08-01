'use client'
// src/app/personnel/[id]/FicheEmployeClient.tsx — Fiche employé (superadmin).

import { useEffect, useState, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, User, Save, FileText, Eye, Download, X, CalendarClock } from 'lucide-react'

const COMPANIES: Record<string, string> = { '438': 'Verviers Dépannage', '3068': 'DGJ VHU' }
const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const monthLabel = (p: string) => { const m = parseInt((p || '').split('-')[1]); return MONTHS[m] || p }
const TYPE_LABELS: Record<string, string> = { salaire: 'Salaire', prime: 'Prime', vacances: 'Pécule de vacances', conge: 'Congé', autre: 'Autre' }
const ficheLabel = (s: any) => s.label || TYPE_LABELS[s.type] || (s.type || 'Salaire')

export default function FicheEmployeClient({ id, userRole, userName, userEmail, userModules }: {
  id: string; userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData] = useState<any>(null)
  const [tab, setTab]   = useState<'infos' | 'paie' | 'conges'>('infos')
  const [form, setForm] = useState<any>({})
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<any>(null)

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
          name: form.name, poste: form.poste, type_contrat: form.type_contrat, matricule: form.matricule,
          company_code: form.company_code, date_entree: form.date_entree || null, date_sortie: form.date_sortie || null,
          phone: form.phone, email: form.email, odoo_partner_id: form.odoo_partner_id || null,
          user_id: form.user_id || null, notes: form.notes, active: form.active }) })
      const j = await r.json()
      if (j.error) alert(j.error); else await load()
    } finally { setBusy(false) }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const Fld = ({ label, k, type = 'text', ph }: any) => (
    <label className="block">
      <span className="text-ink-muted text-xs">{label}</span>
      <input type={type} value={form[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph}
        className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink" />
    </label>
  )

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

            <div className="flex gap-1 border-b mb-5">
              {[['infos', 'Infos'], ['paie', `Paie (${slips.length})`], ['conges', 'Congés']].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k as any)} className={`text-sm px-3 py-2 border-b-2 ${tab === k ? 'border-brand text-brand font-semibold' : 'border-transparent text-ink-muted'}`}>{l}</button>
              ))}
            </div>

            {tab === 'infos' && (
              <div className="flex flex-col gap-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Fld label="Nom" k="name" />
                  <Fld label="Poste" k="poste" ph="Chauffeur dépanneur" />
                  <label className="block"><span className="text-ink-muted text-xs">Type de contrat</span>
                    <select value={form.type_contrat || ''} onChange={e => set('type_contrat', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                      <option value="">—</option>{['CDI', 'CDD', 'Intérim', 'Étudiant', 'Flexi'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select></label>
                  <Fld label="Matricule EasyPay" k="matricule" />
                  <label className="block"><span className="text-ink-muted text-xs">Société</span>
                    <select value={form.company_code || ''} onChange={e => set('company_code', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                      <option value="">—</option><option value="438">Verviers Dépannage</option><option value="3068">DGJ VHU</option>
                    </select></label>
                  <label className="block"><span className="text-ink-muted text-xs">Compte app</span>
                    <select value={form.user_id || ''} onChange={e => set('user_id', e.target.value)} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
                      <option value="">— non lié —</option>{(data.users || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select></label>
                  <Fld label="Date d'entrée" k="date_entree" type="date" />
                  <Fld label="Date de sortie" k="date_sortie" type="date" />
                  <Fld label="Téléphone" k="phone" />
                  <Fld label="E-mail" k="email" />
                  <Fld label="ID contact Odoo" k="odoo_partner_id" ph="ex : 1234" />
                </div>
                <label className="block"><span className="text-ink-muted text-xs">Notes</span>
                  <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} className="w-full mt-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink" /></label>
                <div className="flex items-center gap-3">
                  <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"><Save size={15} /> Enregistrer</button>
                  <span className="text-ink-muted text-xs">L'ID Odoo renseigné → les infos (nom, tél, e-mail) sont synchronisées vers le contact Odoo.</span>
                </div>
              </div>
            )}

            {tab === 'paie' && (
              <div className="flex flex-col gap-2">
                {slips.length === 0 && <p className="text-ink-muted text-sm italic">Aucune fiche.</p>}
                {slips.map((s: any) => (
                  <button key={s.id} onClick={() => setPreview(s)} className="flex items-center gap-3 bg-surface border rounded-xl px-4 py-3 hover:border-brand/40 text-left w-full">
                    <FileText size={16} className="text-brand flex-shrink-0" />
                    <div className="flex-1 min-w-0"><div className="text-ink text-sm"><span className="capitalize">{monthLabel(s.period)}</span> {(s.period || '').split('-')[0]}</div>
                      <div className="text-ink-muted text-xs">{ficheLabel(s)}{s.montant_net != null ? ` · net ${Math.round(s.montant_net)} €` : ''}</div></div>
                    <Eye size={16} className="text-ink-muted flex-shrink-0" />
                  </button>
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
