'use client'
// src/app/personnel/rentabilite/RentabiliteClient.tsx
//
// Rentabilité par chauffeur : CA missions − coût salarial = marge de contribution.
// Superadmin. Olivier 2026-08-01.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import PersonnelTabs from '@/components/layout/PersonnelTabs'
import { TrendingUp, RefreshCw, Info, Plus, Trash2 } from 'lucide-react'

const eur = (n: number) => n.toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' €'

export default function RentabiliteClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData]   = useState<any>(null)
  const [preset, setPreset] = useState('3m')
  const [loading, setLd]  = useState(true)

  const monthStr = (off: number) => { const d = new Date(); d.setMonth(d.getMonth() - off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  const load = (p: string) => {
    setLd(true)
    const q = p === 'current' ? `only=${monthStr(0)}` : p === 'last' ? `only=${monthStr(1)}` : p === '3m' ? 'months=3' : 'months=12'
    fetch(`/api/rh/rentabilite?${q}`, { cache: 'no-store' })
      .then(r => r.json()).then(setData).catch(() => setData({ drivers: [] })).finally(() => setLd(false))
  }
  useEffect(() => { load(preset) }, [preset])

  const [caForm, setCaForm] = useState<any>({})
  const [adding, setAdding] = useState(false)
  const addCa = async () => {
    if (!caForm.personnel_id || !(caForm.period || monthStr(0)) || caForm.amount === undefined || caForm.amount === '') { alert('Chauffeur, période et montant requis.'); return }
    setAdding(true)
    try {
      const r = await fetch('/api/rh/rentabilite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_ca', personnel_id: caForm.personnel_id, period: caForm.period || monthStr(0), amount: Number(caForm.amount), label: caForm.label }) })
      const j = await r.json(); if (j.error) { alert(j.error); return }
      setCaForm({ period: caForm.period }); load(preset)
    } finally { setAdding(false) }
  }
  const deleteCa = async (id: string) => {
    if (!confirm('Supprimer cette ligne de CA ?')) return
    await fetch('/api/rh/rentabilite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_ca', id }) })
    load(preset)
  }

  const drivers = data?.drivers || []
  const totCa = drivers.reduce((s: number, d: any) => s + d.ca, 0)
  const totCout = drivers.reduce((s: number, d: any) => s + d.cout, 0)
  const totMarge = totCa - totCout

  return (
    <AppShell title="Rentabilité chauffeur" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <PersonnelTabs />
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><TrendingUp size={22} /></div>
            <div><h1 className="text-xl font-bold text-ink leading-tight">Rentabilité par chauffeur</h1>
              <p className="text-ink-muted text-sm">CA missions − coût salarial = marge de contribution</p></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border overflow-hidden">
              {[['current', 'Mois en cours'], ['last', 'Mois dernier'], ['3m', '3 mois'], ['12m', '12 mois']].map(([k, l]) => (
                <button key={k} onClick={() => setPreset(k)}
                  className={`px-3 py-1.5 text-sm font-medium whitespace-nowrap ${preset === k ? 'bg-brand text-white' : 'bg-surface text-ink-secondary hover:bg-white/5'}`}>{l}</button>
              ))}
            </div>
            <button onClick={() => load(preset)} className="p-2 rounded-lg border text-ink-muted hover:text-brand"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>

        {loading && !data && <p className="text-ink-muted text-sm">Chargement…</p>}

        {data && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="rounded-xl border bg-surface p-4"><div className="text-ink-muted text-xs">CA généré</div><div className="text-ink text-xl font-bold tabular-nums">{eur(totCa)}</div></div>
              <div className="rounded-xl border bg-surface p-4"><div className="text-ink-muted text-xs">Coût salarial</div><div className="text-ink text-xl font-bold tabular-nums">{eur(totCout)}</div></div>
              <div className={`rounded-xl border p-4 ${totMarge >= 0 ? 'bg-surface' : 'bg-critical-soft border-critical/40'}`}><div className="text-ink-muted text-xs">Marge contribution</div><div className={`text-xl font-bold tabular-nums ${totMarge >= 0 ? 'text-emerald-600' : 'text-critical'}`}>{eur(totMarge)}</div></div>
            </div>

            <div className="bg-surface border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead><tr className="text-ink-muted text-[11px] uppercase border-b">
                    <th className="text-left p-3">Chauffeur</th><th className="text-center">Missions</th><th className="text-right">CA HTVA</th><th className="text-right">Coût</th><th className="text-right p-3">Marge</th>
                  </tr></thead>
                  <tbody>
                    {drivers.map((d: any, i: number) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="p-3 text-ink">{d.name}</td>
                        <td className="text-center text-ink-secondary tabular-nums">{d.missions}</td>
                        <td className="text-right tabular-nums text-ink">{eur(d.ca)}{d.extraCa > 0 && <span className="text-ink-muted text-[10px] block">dont {eur(d.extraCa)} manuel</span>}</td>
                        <td className="text-right tabular-nums text-ink-secondary">{d.cout ? eur(d.cout) : <span className="text-ink-muted italic text-xs">—</span>}</td>
                        <td className={`text-right p-3 tabular-nums font-semibold ${d.marge >= 0 ? 'text-emerald-600' : 'text-critical'}`}>{eur(d.marge)}</td>
                      </tr>
                    ))}
                    {!drivers.length && <tr><td colSpan={5} className="p-4 text-ink-muted text-sm italic">Aucune donnée. Vérifie que les chauffeurs sont liés à un compte (répertoire) et que les fiches ont été re-traitées (montants).</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* CA manuel */}
            <div className="bg-surface border rounded-2xl p-5 mt-4">
              <div className="flex items-center gap-2 mb-1"><Plus size={16} className="text-brand" /><h2 className="font-semibold text-ink text-sm">CA manuel (courses non rattachées)</h2></div>
              <p className="text-ink-muted text-xs mb-3">Attribue à un chauffeur, pour un mois, le CA de courses facturées directement dans Odoo (incentive, aftersix…) et non rattachées. C'est ajouté à son CA.</p>
              <div className="grid sm:grid-cols-4 gap-2">
                <select value={caForm.personnel_id || ''} onChange={e => setCaForm({ ...caForm, personnel_id: e.target.value })} className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink">
                  <option value="">Chauffeur…</option>
                  {(data.caTargets || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input type="month" value={caForm.period || monthStr(0)} onChange={e => setCaForm({ ...caForm, period: e.target.value })} className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
                <input type="number" placeholder="Montant HTVA €" value={caForm.amount ?? ''} onChange={e => setCaForm({ ...caForm, amount: e.target.value })} className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
                <input placeholder="Libellé (ex. Incentive)" value={caForm.label || ''} onChange={e => setCaForm({ ...caForm, label: e.target.value })} className="bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink" />
              </div>
              <button onClick={addCa} disabled={adding} className="mt-3 inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"><Plus size={15} /> {adding ? 'Ajout…' : 'Ajouter'}</button>

              {(data.caLines || []).length > 0 && (
                <div className="mt-4 border-t pt-3 flex flex-col gap-1.5">
                  <div className="text-ink-muted text-xs mb-1">Lignes sur la période affichée</div>
                  {data.caLines.map((l: any) => (
                    <div key={l.id} className="flex items-center gap-2 text-sm bg-surface-2 rounded-lg px-3 py-2">
                      <span className="text-ink font-medium">{l.worker}</span>
                      <span className="text-ink-muted text-xs">{l.period} · {eur(Number(l.amount))}{l.label ? ` · ${l.label}` : ''}</span>
                      <button onClick={() => deleteCa(l.id)} className="ml-auto p-1 text-ink-muted hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-info-soft border border-info rounded-xl px-4 py-3 text-info text-xs mt-4 flex items-start gap-2">
              <Info size={16} className="flex-shrink-0 mt-0.5" />
              <div>Marge de <b>contribution</b> (CA missions attribuées − coût salarial). Ne déduit pas les frais généraux, carburant, amortissement. Coût employeur estimé (brut × {data.employerFactor}) quand la fiche ne l’indique pas. Trajets vides exclus du CA.</div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
