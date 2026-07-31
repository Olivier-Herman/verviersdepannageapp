'use client'
// src/app/admin/achats/AchatsClient.tsx
//
// Module Gestion Achat — tableau de bord d'optimisation des coûts (superadmin).
// Lit les factures fournisseurs Odoo via /api/admin/achats. MVP : dépense,
// tendance, concentration fournisseurs, catégories, doublons. Olivier 2026-07-31.

import { useEffect, useState } from 'react'
import { ShoppingCart, TrendingUp, Users, Receipt, AlertTriangle, PieChart, RefreshCw } from 'lucide-react'

const eur = (n: number) => n.toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' €'

export default function AchatsClient() {
  const [data, setData]   = useState<any>(null)
  const [months, setMonths] = useState(12)
  const [loading, setLoading] = useState(true)
  const [err, setErr]     = useState('')

  const load = (m: number) => {
    setLoading(true); setErr('')
    fetch(`/api/admin/achats?months=${m}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.error) setErr(j.error); else setData(j) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(months) }, [months])

  const maxMonth = data ? Math.max(1, ...data.byMonth.map((m: any) => m.htva)) : 1
  const maxSup   = data?.topSuppliers?.[0]?.htva || 1
  const maxCat   = data?.byCategory?.[0]?.amount || 1

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* En-tête */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><ShoppingCart size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-ink leading-tight">Gestion Achat</h1>
            <p className="text-ink-muted text-sm">Optimisation des coûts — factures fournisseurs Odoo</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden">
            {[6, 12, 24].map(m => (
              <button key={m} onClick={() => setMonths(m)}
                className={`px-3 py-1.5 text-sm font-medium ${months === m ? 'bg-brand text-white' : 'bg-surface text-ink-secondary hover:bg-white/5'}`}>
                {m} mois
              </button>
            ))}
          </div>
          <button onClick={() => load(months)} className="p-2 rounded-lg border text-ink-muted hover:text-brand" title="Rafraîchir">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {err && <div className="bg-critical-soft border border-critical rounded-xl px-4 py-3 text-critical text-sm mb-4">Erreur : {err}</div>}
      {loading && !data && <div className="text-ink-muted text-sm">Chargement des données Odoo…</div>}

      {data && (
        <div className="flex flex-col gap-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi icon={<Receipt size={16} />} label={`Dépense HTVA · ${months} mois`} value={eur(data.overview.totalHtva)} />
            <Kpi icon={<TrendingUp size={16} />} label="Factures" value={data.overview.count.toLocaleString('fr-BE')} sub={`ticket moyen ${eur(data.overview.avgTicket)}`} />
            <Kpi icon={<Users size={16} />} label="Fournisseurs actifs" value={String(data.overview.suppliers)} sub={`top 5 = ${data.concentrationTop5}%`} />
            <Kpi icon={<AlertTriangle size={16} />} label="Brouillons en attente" value={eur(data.overview.draftHtva)} sub={`${data.overview.draftCount} factures`} accent={data.overview.draftCount > 0} />
          </div>

          {/* Tendance mensuelle */}
          <Panel title="Tendance mensuelle (HTVA)" icon={<TrendingUp size={16} />}>
            <div className="flex items-end gap-1.5 h-40 mt-2">
              {data.byMonth.map((m: any) => (
                <div key={m.month} className="flex-1 flex flex-col items-center justify-end group">
                  <div className="w-full rounded-t bg-brand/70 group-hover:bg-brand transition-all relative"
                    style={{ height: `${Math.max(4, (m.htva / maxMonth) * 100)}%` }}>
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-ink-muted opacity-0 group-hover:opacity-100 whitespace-nowrap">{eur(m.htva)}</span>
                  </div>
                  <span className="text-[10px] text-ink-muted mt-1 truncate max-w-full">{String(m.month).replace(/ \d{4}/, '').slice(0, 4)}</span>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Top fournisseurs */}
            <Panel title="Top fournisseurs" icon={<Users size={16} />} sub={`concentration top 5 : ${data.concentrationTop5}%`}>
              <div className="flex flex-col gap-2 mt-2">
                {data.topSuppliers.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink truncate">{s.name}</span>
                        <span className="text-ink-secondary tabular-nums flex-shrink-0">{eur(s.htva)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 mt-1 overflow-hidden">
                        <div className="h-full bg-brand/70 rounded-full" style={{ width: `${(s.htva / maxSup) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-[11px] text-ink-muted tabular-nums w-10 text-right flex-shrink-0">{s.share}%</span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Par catégorie */}
            <Panel title="Dépense par catégorie" icon={<PieChart size={16} />} sub="compte de charge Odoo">
              <div className="flex flex-col gap-2 mt-2">
                {data.byCategory.slice(0, 12).map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink truncate" title={c.account}>{c.account}</span>
                        <span className="text-ink-secondary tabular-nums flex-shrink-0">{eur(c.amount)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 mt-1 overflow-hidden">
                        <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* Doublons */}
          <Panel title="Doublons potentiels" icon={<AlertTriangle size={16} />} sub="même fournisseur + même n° de facture (ref)">
            {data.duplicates.length === 0 ? (
              <p className="text-ink-muted text-sm italic mt-2">Aucun doublon détecté. 👍</p>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="text-ink-muted text-xs uppercase tracking-wide border-b">
                      <th className="text-left py-2">Fournisseur</th><th className="text-left">N° facture</th><th className="text-right">Montant</th><th className="text-center">×</th><th className="text-left pl-3">Dates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.duplicates.slice(0, 25).map((d: any, i: number) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="py-2 text-ink truncate max-w-[180px]">{d.supplier}</td>
                        <td className="text-ink-secondary">{d.ref}</td>
                        <td className="text-right tabular-nums text-ink">{eur(d.amount)}</td>
                        <td className="text-center"><span className="inline-block px-1.5 rounded-full bg-critical-soft text-critical text-xs font-semibold">{d.count}</span></td>
                        <td className="pl-3 text-ink-muted text-xs">{d.dates.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.duplicates.length > 25 && <p className="text-ink-muted text-xs mt-2">+ {data.duplicates.length - 25} autres…</p>}
              </div>
            )}
          </Panel>

          <p className="text-ink-muted text-xs text-center">
            Phase de test (superadmin). Prochaines briques : recommandations IA, dérive de prix, appels d'offres — cf. plan Achats.
          </p>
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'bg-critical-soft border-critical/40' : 'bg-surface'}`}>
      <div className="flex items-center gap-1.5 text-ink-muted text-xs mb-1.5">{icon}<span className="truncate">{label}</span></div>
      <div className="text-ink text-xl font-bold tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-ink-muted text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function Panel({ title, icon, sub, children }: { title: string; icon: React.ReactNode; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <span className="text-brand">{icon}</span>
        <h2 className="text-ink font-semibold text-sm">{title}</h2>
        {sub && <span className="text-ink-muted text-xs ml-auto">{sub}</span>}
      </div>
      {children}
    </div>
  )
}
