'use client'
// src/app/admin/achats/AchatsClient.tsx
//
// Module Gestion Achat — tableau de bord d'optimisation des coûts (superadmin).
// Lit les factures fournisseurs Odoo via /api/admin/achats. MVP : dépense,
// tendance, concentration fournisseurs, catégories, doublons. Olivier 2026-07-31.

import { useEffect, useState } from 'react'
import { ShoppingCart, TrendingUp, Users, Receipt, AlertTriangle, PieChart, RefreshCw, Search, X, Link2, Ban, Undo2, Sparkles, Truck, Lightbulb, Loader2, ChevronRight, MessageCircle, Send } from 'lucide-react'
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
  const [parsing, setParsing] = useState(false)
  const [parseProg, setParseProg] = useState<{ done: number; remaining: number | null } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<{ role: string; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [catDetail, setCatDetail] = useState<{ name: string; invoices: any[] | null } | null>(null)
  const [vehDetail, setVehDetail] = useState<{ plate: string; truck: string | null; total?: number; cats?: Record<string, number>; invoices: any[] | null } | null>(null)
  const [supDetail, setSupDetail] = useState<{ id: number; name: string; invoices: any[] | null } | null>(null)

  const load = (m: number) => {
    setLoading(true); setErr('')
    fetch(`/api/admin/achats?months=${m}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.error) setErr(j.error); else setData(j) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(months) }, [months])

  // Temps réel : rafraîchit la couverture + les catégories (cache Supabase,
  // aucun appel Odoo) toutes les 12 s → la progression du parsing s'affiche live.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/admin/achats?light=1&months=${months}`, { cache: 'no-store' })
        const j = await r.json()
        if (j.ok) setData((prev: any) => prev ? { ...prev, aiCategories: j.aiCategories, coverage: j.coverage, byVehicle: j.byVehicle } : prev)
      } catch {}
    }, 12000)
    return () => clearInterval(id)
  }, [months])

  const act = async (payload: any) => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/achats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Erreur'); return }
      load(months)
    } finally { setBusy(false) }
  }

  // Catégorisation IA : boucle par lots de 30 jusqu'à épuisement (progression
  // live). Sync la 1re fois si le cache est vide.
  const runParse = async () => {
    setParsing(true); setParseProg({ done: 0, remaining: null })
    try {
      let first = true, done = 0
      for (let i = 0; i < 200; i++) {
        const needSync = first && (!data?.coverage || data.coverage.total === 0)
        const r = await fetch(`/api/cron/achats-parse?limit=30${needSync ? '&sync=1' : ''}`, { cache: 'no-store' })
        const j = await r.json()
        first = false
        if (j.error) { alert(j.error); break }
        done += (j.parsed || 0) + (j.failed || 0)
        setParseProg({ done, remaining: j.remaining ?? null })
        if (!j.remaining || j.remaining <= 0) break
      }
      load(months)
    } catch (e: any) { alert(e.message) } finally { setParsing(false); setParseProg(null) }
  }

  // Tout recatégoriser : reset des factures déjà traitées puis relance en boucle.
  const recategorizeAll = async () => {
    if (!confirm('Tout recatégoriser ? Les factures déjà traitées repasseront à l’IA (analyse par ligne). Coût one-time.')) return
    setParsing(true); setParseProg({ done: 0, remaining: null })
    try {
      await fetch('/api/cron/achats-parse?reset=all', { cache: 'no-store' })
      let done = 0
      for (let i = 0; i < 200; i++) {
        const r = await fetch('/api/cron/achats-parse?sync=1&limit=30', { cache: 'no-store' })
        const j = await r.json()
        if (j.error) { alert(j.error); break }
        done += (j.parsed || 0) + (j.failed || 0)
        setParseProg({ done, remaining: j.remaining ?? null })
        if (!j.remaining || j.remaining <= 0) break
      }
      load(months)
    } catch (e: any) { alert(e.message) } finally { setParsing(false); setParseProg(null) }
  }

  // Détail d'une catégorie : liste des factures qui composent le chiffre.
  const openCategory = async (name: string) => {
    setCatDetail({ name, invoices: null })
    try {
      const r = await fetch(`/api/admin/achats?category=${encodeURIComponent(name)}&months=${months}`, { cache: 'no-store' })
      const j = await r.json()
      setCatDetail({ name, invoices: j.invoices || [] })
    } catch { setCatDetail({ name, invoices: [] }) }
  }

  // Détail d'un fournisseur : ses factures (membres fusionnés inclus).
  const openSupplier = async (id: number, name: string) => {
    setSupDetail({ id, name, invoices: null })
    try {
      const r = await fetch(`/api/admin/achats?supplier=${id}&months=${months}`, { cache: 'no-store' })
      const j = await r.json()
      setSupDetail({ id, name, invoices: j.invoices || [] })
    } catch { setSupDetail({ id, name, invoices: [] }) }
  }

  // Détail d'un véhicule : ventilation par poste (cats) + factures rattachées.
  const openVehicle = async (v: any) => {
    setVehDetail({ plate: v.plate, truck: v.truck, total: v.total, cats: v.cats, invoices: null })
    try {
      const r = await fetch(`/api/admin/achats?vehicle=${encodeURIComponent(v.plate)}&months=${months}`, { cache: 'no-store' })
      const j = await r.json()
      setVehDetail({ plate: v.plate, truck: v.truck, total: v.total, cats: v.cats, invoices: j.invoices || [] })
    } catch { setVehDetail({ plate: v.plate, truck: v.truck, total: v.total, cats: v.cats, invoices: [] }) }
  }

  const analyzeAI = async () => {
    setAnalyzing(true); setErr('')
    try {
      const r = await fetch(`/api/admin/achats?ai=analyze&months=${months}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.error) setErr(j.error)
      else setData((prev: any) => prev ? { ...prev, aiReco: j.reco } : prev)
    } catch { setErr('Analyse IA impossible') } finally { setAnalyzing(false) }
  }

  const sendChat = async () => {
    const text = chatInput.trim()
    if (!text || chatBusy) return
    const next = [...chatMsgs, { role: 'user', content: text }]
    setChatMsgs(next); setChatInput(''); setChatBusy(true)
    try {
      const r = await fetch('/api/admin/achats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ai_chat', messages: next }) })
      const j = await r.json()
      setChatMsgs(m => [...m, { role: 'assistant', content: j.reply || ('❌ ' + (j.error || 'Erreur')) }])
      if (j.acted) load(months)   // l'IA a modifié la config/redispatch → rafraîchit les graphes
    } catch { setChatMsgs(m => [...m, { role: 'assistant', content: '❌ Erreur réseau' }]) } finally { setChatBusy(false) }
  }

  const maxMonth = data ? Math.max(1, ...data.byMonth.map((m: any) => m.htva)) : 1
  const maxSup   = data?.topSuppliers?.[0]?.htva || 1
  const maxCat   = data?.byCategory?.[0]?.amount || 1
  const maxAi    = data?.aiCategories?.[0]?.amount || 1
  const aiOn     = (data?.coverage?.parsed || 0) > 0

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
          <a href="/achats/devis" className="px-3 py-1.5 rounded-lg border text-sm text-ink-secondary hover:text-brand inline-flex items-center gap-1.5">
            <Receipt size={15} /> Devis
          </a>
          <a href="/achats/fournisseurs" className="px-3 py-1.5 rounded-lg border text-sm text-ink-secondary hover:text-brand inline-flex items-center gap-1.5">
            <Users size={15} /> Répertoire
          </a>
          <button onClick={() => { setManage(true); setQ(''); setMergeSrc(null) }} className="px-3 py-1.5 rounded-lg border text-sm text-ink-secondary hover:text-brand inline-flex items-center gap-1.5">
            <Link2 size={15} /> Fusions
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

          {/* Recommandations IA */}
          <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/5 to-transparent p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-brand/10 text-brand flex items-center justify-center"><Sparkles size={17} /></div>
              <div className="flex-1">
                <h2 className="font-semibold text-ink text-sm flex items-center gap-2">Recommandations IA
                  {data.aiReco?.total_saving > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">≈ {eur(data.aiReco.total_saving)}/an potentiels</span>}
                </h2>
                <p className="text-ink-muted text-xs">{data.aiReco ? `Analysé le ${new Date(data.aiReco.generated_at).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${data.aiReco.months} mois` : `Claude analyse tes ${months} derniers mois et propose des économies concrètes.`}</p>
              </div>
              <button onClick={analyzeAI} disabled={analyzing}
                className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-60 flex-shrink-0">
                {analyzing ? <><Loader2 size={15} className="animate-spin" /> Analyse…</> : <><Sparkles size={15} /> {data.aiReco ? 'Ré-analyser' : 'Analyser mes dépenses'}</>}
              </button>
            </div>

            {analyzing && !data.aiReco && <p className="text-ink-muted text-sm mt-3">Claude épluche tes factures… (~15-30 s)</p>}

            {data.aiReco?.recos?.length > 0 && (
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                {data.aiReco.recos.map((r: any, i: number) => {
                  const sev = r.severity === 'high' ? 'border-l-red-500' : r.severity === 'low' ? 'border-l-sky-400' : 'border-l-amber-400'
                  return (
                    <div key={i} className={`bg-surface border border-l-4 ${sev} rounded-xl p-3.5`}>
                      <div className="flex items-start gap-2">
                        <Lightbulb size={15} className="text-brand mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-ink text-sm leading-tight">{r.title}</span>
                            {r.estimated_saving_eur > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold whitespace-nowrap flex-shrink-0">−{eur(r.estimated_saving_eur)}/an</span>}
                          </div>
                          <p className="text-ink-muted text-xs mt-1 leading-relaxed">{r.rationale}</p>
                          {r.actions?.length > 0 && (
                            <ul className="mt-2 space-y-0.5">
                              {r.actions.map((a: string, j: number) => (
                                <li key={j} className="text-xs text-ink-secondary flex items-start gap-1.5"><ChevronRight size={12} className="mt-0.5 text-brand flex-shrink-0" />{a}</li>
                              ))}
                            </ul>
                          )}
                          {r.suppliers?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {r.suppliers.map((s: string, j: number) => <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-ink-muted/10 text-ink-muted">{s}</span>)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {!analyzing && !data.aiReco && (
              <p className="text-ink-muted text-xs mt-3">Consolidation de fournisseurs, opportunités de négociation, anomalies de prix, doublons — chiffrés en €.</p>
            )}

            {/* Discussion avec l'IA */}
            <div className="mt-4 border-t pt-3">
              {!chatOpen ? (
                <button onClick={() => setChatOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
                  <MessageCircle size={15} /> Discuter avec l'IA — poser une question, tester un « et si », reclasser une dépense…
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-ink flex items-center gap-1.5"><MessageCircle size={15} className="text-brand" /> Discussion achats</span>
                    <button onClick={() => setChatOpen(false)} className="text-ink-muted hover:text-ink"><X size={16} /></button>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-auto mb-2 pr-1">
                    {chatMsgs.length === 0 && (
                      <div className="text-ink-muted text-xs space-y-1">
                        <p>Exemples : «&nbsp;Pourquoi consolider les pneus&nbsp;?&nbsp;» · «&nbsp;Combien si je renégocie le fournisseur X de 5&nbsp;%&nbsp;?&nbsp;» · «&nbsp;Reclasse les dépenses Y en Énergie et redis-moi les postes.&nbsp;»</p>
                      </div>
                    )}
                    {chatMsgs.map((m, i) => (
                      <div key={i} className={`text-sm rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-brand/10 text-ink ml-8' : 'bg-surface-2 text-ink-secondary mr-8 whitespace-pre-wrap'}`}>{m.content}</div>
                    ))}
                    {chatBusy && <div className="text-sm rounded-xl px-3 py-2 bg-surface-2 text-ink-muted mr-8 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> réflexion…</div>}
                  </div>
                  <div className="flex gap-2">
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendChat() }}
                      placeholder="Ta question ou instruction…" className="flex-1 bg-surface border rounded-lg px-3 py-2 text-sm text-ink" />
                    <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()} className="px-3 py-2 rounded-lg bg-brand text-white disabled:opacity-50"><Send size={15} /></button>
                  </div>
                </div>
              )}
            </div>
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
              <div className="flex flex-col gap-1 mt-2">
                {data.topSuppliers.map((s: any) => (
                  <button key={s.id} type="button" onClick={() => openSupplier(s.id, s.name)}
                    className="flex items-center gap-2 text-sm text-left rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-white/5 cursor-pointer">
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
                  </button>
                ))}
              </div>
            </Panel>

            {/* Par catégorie — IA (parsing des documents) si dispo, sinon provisoire */}
            <Panel title={aiOn ? 'Dépense par catégorie (IA)' : 'Dépense par catégorie'} icon={<PieChart size={16} />}
              sub={data.coverage ? `catégorisé ${data.coverage.pct}% · ${data.coverage.parsed}/${data.coverage.total}` : 'provisoire'}>
              {/* Jauge de couverture + bouton de traitement */}
              <div className="flex items-center gap-2 mt-2 mb-3">
                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${data.coverage?.pct || 0}%` }} />
                </div>
                <button onClick={runParse} disabled={parsing}
                  className="text-xs px-2.5 py-1 rounded-lg bg-brand text-white disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap">
                  {parsing ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {parsing
                    ? (parseProg ? `${parseProg.done} traité${parseProg.remaining != null ? ` · reste ${parseProg.remaining}` : ''}` : '…')
                    : (data.coverage?.total ? 'Traiter tout' : 'Lancer l’IA')}
                </button>
              </div>
              {aiOn && !parsing && (
                <button onClick={recategorizeAll} className="text-[11px] text-ink-muted hover:text-brand underline mb-2">↻ Tout recatégoriser (re-analyse par ligne)</button>
              )}
              <div className="flex flex-col gap-1">
                {(aiOn ? data.aiCategories : data.byCategory.map((c: any) => ({ categorie: c.account, amount: c.amount }))).slice(0, 14).map((c: any, i: number) => (
                  <button key={i} type="button" disabled={!aiOn}
                    onClick={() => aiOn && openCategory(c.categorie)}
                    className={`flex items-center gap-2 text-sm text-left rounded-lg px-1.5 py-1 -mx-1.5 ${aiOn ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink truncate" title={c.categorie}>{c.categorie}</span>
                        <span className="text-ink-secondary tabular-nums flex-shrink-0">{eur(c.amount)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 mt-1 overflow-hidden">
                        <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${(c.amount / (aiOn ? maxAi : maxCat)) * 100}%` }} />
                      </div>
                    </div>
                  </button>
                ))}
                {!aiOn && <p className="text-ink-muted text-[11px] italic mt-1">Catégories provisoires (comptes Odoo). Lance l’IA pour la vraie catégorisation par document.</p>}
              </div>
            </Panel>
          </div>

          {/* Coût par véhicule (plaques extraites des documents par l'IA) */}
          {(data.byVehicle?.length || 0) > 0 && (
            <Panel title="Coût par véhicule" icon={<Truck size={16} />} sub="plaque repérée sur les factures (hors sous-traitance) · clic = détail">
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-ink-muted text-[11px] uppercase tracking-wide border-b">
                      <th className="text-left py-2">Véhicule</th><th className="text-left">Plaque</th><th className="text-left">Poste principal</th><th className="text-right">Coût HTVA</th><th className="text-center">Fact.</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byVehicle.slice(0, 30).map((v: any) => {
                      const topCat = Object.entries(v.cats || {}).sort((a: any, b: any) => b[1] - a[1])[0]
                      return (
                        <tr key={v.plate} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => openVehicle(v)}>
                          <td className="py-2 text-ink">{v.truck || <span className="text-ink-muted italic">non répertorié</span>}</td>
                          <td className="text-ink-secondary tabular-nums">{v.plate}</td>
                          <td className="text-ink-muted text-xs truncate max-w-[160px]">{topCat ? topCat[0] : '—'}</td>
                          <td className="text-right tabular-nums text-ink">{eur(v.total)}</td>
                          <td className="text-center text-ink-muted">{v.count}</td>
                          <td className="text-right pl-2"><button disabled={busy} onClick={e => { e.stopPropagation(); act({ action: 'ignore_plate', plate: v.plate }) }} title="Ignorer ce véhicule" className="p-1 text-ink-muted/60 hover:text-red-400"><X size={13} /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {data.byVehicle.length > 30 && <p className="text-ink-muted text-xs mt-2">+ {data.byVehicle.length - 30} autres…</p>}
                <p className="text-ink-muted text-[11px] italic mt-2">Plaques à 1 seule facture masquées (bruit). Sous-traitance non comptée. « ✕ » pour ignorer un véhicule.</p>
                {(data.config?.ignoredPlates?.length || 0) > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-ink-muted text-[11px]">Ignorés :</span>
                    {data.config.ignoredPlates.map((p: string) => (
                      <button key={p} disabled={busy} onClick={() => act({ action: 'unignore_plate', plate: p })} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border text-ink-muted hover:text-brand" title="Réafficher ce véhicule">{p} <X size={11} /></button>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          )}

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

    {/* Détail d'une catégorie : les factures qui composent le chiffre */}
    {catDetail && (
      <div className="fixed inset-0 z-[200] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-surface border w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col">
          <div className="flex items-center gap-2 p-4 border-b">
            <PieChart size={18} className="text-brand" />
            <h3 className="font-semibold text-ink truncate">{catDetail.name}</h3>
            {catDetail.invoices && <span className="text-xs text-ink-muted whitespace-nowrap">· {catDetail.invoices.length} fact. · {eur(catDetail.invoices.reduce((s: number, x: any) => s + (x.amount_htva || 0), 0))}</span>}
            <button onClick={() => setCatDetail(null)} className="ml-auto p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
          </div>
          <div className="overflow-y-auto flex-1">
            {!catDetail.invoices ? (
              <p className="p-4 text-ink-muted text-sm">Chargement…</p>
            ) : catDetail.invoices.length === 0 ? (
              <p className="p-4 text-ink-muted text-sm italic">Aucune facture.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-ink-muted text-[11px] uppercase border-b"><th className="text-left p-2">Fournisseur</th><th className="text-left">Détail</th><th className="text-right p-2">HTVA</th></tr></thead>
                <tbody>
                  {catDetail.invoices.map((f: any) => (
                    <tr key={f.odoo_move_id} className="border-b border-white/5 align-top">
                      <td className="p-2"><div className="text-ink">{f.supplier_name}</div><div className="text-[11px] text-ink-muted">{f.invoice_date} · {f.ref || '—'}</div></td>
                      <td className="py-2 text-xs">{f.sous_categorie && <span className="text-brand">{f.sous_categorie}</span>}{f.resume && <div className="text-ink-muted">{f.resume}</div>}</td>
                      <td className="p-2 text-right tabular-nums text-ink whitespace-nowrap">{eur(f.amount_htva || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    )}
    {/* Détail d'un véhicule : factures rattachées à la plaque */}
    {vehDetail && (
      <div className="fixed inset-0 z-[200] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-surface border w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col">
          <div className="flex items-center gap-2 p-4 border-b">
            <Truck size={18} className="text-brand" />
            <h3 className="font-semibold text-ink truncate">{vehDetail.truck || 'Véhicule non répertorié'}</h3>
            <span className="text-xs text-ink-muted tabular-nums">{vehDetail.plate}</span>
            {vehDetail.invoices && <span className="text-xs text-ink-muted whitespace-nowrap">· {vehDetail.invoices.length} fact. · {eur(vehDetail.invoices.reduce((s: number, x: any) => s + (x.montant || 0), 0))}</span>}
            <button onClick={() => setVehDetail(null)} className="ml-auto p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
          </div>
          <div className="overflow-y-auto flex-1">
            {vehDetail.cats && Object.keys(vehDetail.cats).length > 0 && (
              <div className="p-4 border-b">
                <p className="text-ink-muted text-[11px] uppercase tracking-wide mb-2">Ventilation par poste</p>
                <div className="flex flex-col gap-1.5">
                  {Object.entries(vehDetail.cats).sort((a: any, b: any) => b[1] - a[1]).map(([cat, amt]: any) => (
                    <div key={cat} className="text-sm">
                      <div className="flex justify-between gap-2"><span className="text-ink">{cat}</span><span className="text-ink-secondary tabular-nums">{eur(Math.round(amt))}</span></div>
                      <div className="h-1.5 rounded-full bg-white/5 mt-0.5 overflow-hidden"><div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${(amt / Math.max(...(Object.values(vehDetail.cats!) as number[]))) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!vehDetail.invoices ? (
              <p className="p-4 text-ink-muted text-sm">Chargement des factures…</p>
            ) : vehDetail.invoices.length === 0 ? (
              <p className="p-4 text-ink-muted text-sm italic">Aucune facture.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-ink-muted text-[11px] uppercase border-b"><th className="text-left p-2">Fournisseur</th><th className="text-left">Poste</th><th className="text-right p-2">HTVA</th></tr></thead>
                <tbody>
                  {vehDetail.invoices.map((f: any) => (
                    <tr key={f.odoo_move_id} className="border-b border-white/5 align-top">
                      <td className="p-2"><div className="text-ink">{f.supplier_name}</div><div className="text-[11px] text-ink-muted">{f.invoice_date} · {f.ref || '—'}</div></td>
                      <td className="py-2 text-xs"><span className="text-brand">{f.categorie}</span>{f.resume && <div className="text-ink-muted">{f.resume}</div>}</td>
                      <td className="p-2 text-right tabular-nums text-ink whitespace-nowrap">{eur(f.montant || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    )}
    {/* Détail d'un fournisseur : ses factures */}
    {supDetail && (
      <div className="fixed inset-0 z-[200] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-surface border w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col">
          <div className="flex items-center gap-2 p-4 border-b">
            <Users size={18} className="text-brand" />
            <h3 className="font-semibold text-ink truncate">{supDetail.name}</h3>
            {supDetail.invoices && <span className="text-xs text-ink-muted whitespace-nowrap">· {supDetail.invoices.length} fact. · {eur(supDetail.invoices.reduce((s: number, x: any) => s + (x.amount_htva || 0), 0))}</span>}
            <button onClick={() => setSupDetail(null)} className="ml-auto p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
          </div>
          <div className="overflow-y-auto flex-1">
            {!supDetail.invoices ? (
              <p className="p-4 text-ink-muted text-sm">Chargement…</p>
            ) : supDetail.invoices.length === 0 ? (
              <p className="p-4 text-ink-muted text-sm italic">Aucune facture dans le cache (lance l’IA pour synchroniser).</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-ink-muted text-[11px] uppercase border-b"><th className="text-left p-2">Date · Réf</th><th className="text-left">Poste</th><th className="text-right p-2">HTVA</th></tr></thead>
                <tbody>
                  {supDetail.invoices.map((f: any) => (
                    <tr key={f.odoo_move_id} className="border-b border-white/5 align-top">
                      <td className="p-2"><div className="text-ink">{f.invoice_date}</div><div className="text-[11px] text-ink-muted">{f.ref || '—'}</div></td>
                      <td className="py-2 text-xs">{f.categorie && <span className="text-brand">{f.categorie}</span>}{f.resume && <div className="text-ink-muted">{f.resume}</div>}</td>
                      <td className="p-2 text-right tabular-nums text-ink whitespace-nowrap">{eur(f.amount_htva || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
