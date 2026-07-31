'use client'
// src/app/admin/achats/AchatsClient.tsx
//
// Module Gestion Achat — tableau de bord d'optimisation des coûts (superadmin).
// Lit les factures fournisseurs Odoo via /api/admin/achats. MVP : dépense,
// tendance, concentration fournisseurs, catégories, doublons. Olivier 2026-07-31.

import { useEffect, useState } from 'react'
import { ShoppingCart, TrendingUp, Users, Receipt, AlertTriangle, PieChart, RefreshCw, Search, X, Link2, Ban, Undo2 } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'

const eur = (n: number) => n.toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' €'

export default function AchatsClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData]   = useState<any>(null)
  const [months, setMonths] = useState(12)
  const [loading, setLoading] = useState(true)
  const [err, setErr]     = useState('')
  const [manage, setManage] = useState(false)   // modal répertoire fournisseurs
  const [q, setQ]         = useState('')
  const [mergeSrc, setMergeSrc] = useState<{ id: number; name: string } | null>(null)
  const [busy, setBusy]   = useState(false)

  const load = (m: number) => {
    setLoading(true); setErr('')
    fetch(`/api/admin/achats?months=${m}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.error) setErr(j.error); else setData(j) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(months) }, [months])

  const act = async (payload: any) => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/achats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Erreur'); return }
      load(months)
    } finally { setBusy(false) }
  }

  const maxMonth = data ? Math.max(1, ...data.byMonth.map((m: any) => m.htva)) : 1
  const maxSup   = data?.topSuppliers?.[0]?.htva || 1
  const maxCat   = data?.byCategory?.[0]?.amount || 1

  return (
    <AppShell title="Gestion Achat" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
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
          <button onClick={() => { setManage(true); setQ(''); setMergeSrc(null) }} className="px-3 py-1.5 rounded-lg border text-sm text-ink-secondary hover:text-brand inline-flex items-center gap-1.5">
            <Users size={15} /> Fournisseurs
          </button>
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
            <Panel title="Dépense par catégorie" icon={<PieChart size={16} />} sub="provisoire · catégorisation IA à venir">
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

    {/* Répertoire fournisseurs — fusion (doublons) + exclusion (non-achat) */}
    {manage && (
      <div className="fixed inset-0 z-[200] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-surface border w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col">
          <div className="flex items-center gap-2 p-4 border-b">
            <Users size={18} className="text-brand" />
            <h3 className="font-semibold text-ink">Répertoire fournisseurs</h3>
            <button onClick={() => { setManage(false); setMergeSrc(null) }} className="ml-auto p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
          </div>

          {mergeSrc && (
            <div className="bg-info-soft border-b border-info px-4 py-2 text-sm text-info flex items-center gap-2">
              <Link2 size={15} /> <span>Fusion de « <b>{mergeSrc.name}</b> » → choisis la fiche à <b>garder</b></span>
              <button onClick={() => setMergeSrc(null)} className="ml-auto underline">annuler</button>
            </div>
          )}

          <div className="p-3 border-b">
            <div className="flex items-center gap-2 bg-white/5 border rounded-lg px-2.5">
              <Search size={15} className="text-ink-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un fournisseur…" className="flex-1 bg-transparent py-2 text-sm text-ink outline-none" />
            </div>
          </div>

          <div className="overflow-y-auto flex-1 divide-y divide-white/5">
            {(data?.allSuppliers || []).filter((s: any) => s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200).map((s: any) => (
              <div key={s.id} className={`flex items-center gap-2 px-4 py-2.5 ${s.excluded ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-ink text-sm truncate">{s.name}</span>
                    {s.mergedCount > 1 && <span title={`${s.mergedCount} fiches fusionnées`} className="text-[10px] text-brand inline-flex items-center gap-0.5"><Link2 size={11} />{s.mergedCount}</span>}
                    {s.excluded && <span className="text-[10px] px-1.5 rounded-full bg-white/10 text-ink-muted">non-achat</span>}
                  </div>
                  <div className="text-xs text-ink-muted tabular-nums">{eur(s.htva)} · {s.count} factures</div>
                </div>
                {mergeSrc ? (
                  mergeSrc.id !== s.id && (
                    <button disabled={busy} onClick={() => { act({ action: 'merge', childId: mergeSrc.id, canonicalId: s.id }); setMergeSrc(null) }}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-brand text-white disabled:opacity-50">← garder celui-ci</button>
                  )
                ) : (
                  <div className="flex items-center gap-1">
                    <button disabled={busy} onClick={() => setMergeSrc({ id: s.id, name: s.name })} className="p-1.5 text-ink-muted hover:text-brand" title="Fusionner dans un autre fournisseur"><Link2 size={15} /></button>
                    <button disabled={busy} onClick={() => act({ action: s.excluded ? 'include' : 'exclude', id: s.id })}
                      className={`p-1.5 ${s.excluded ? 'text-emerald-500' : 'text-ink-muted hover:text-red-400'}`} title={s.excluded ? 'Réintégrer' : 'Exclure (non-achat)'}>
                      {s.excluded ? <Undo2 size={15} /> : <Ban size={15} />}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="p-3 border-t text-xs text-ink-muted">
            <b>Fusionner</b> = regrouper des fiches doublon (ex. les deux « Herman Olivier »). <b>Exclure</b> = retirer une fiche qui n'est pas une dépense à suivre (ex. mouvement intercompagnie). Odoo n'est jamais modifié.
          </div>
        </div>
      </div>
    )}
    </AppShell>
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
