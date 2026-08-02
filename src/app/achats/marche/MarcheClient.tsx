'use client'
// src/app/achats/marche/MarcheClient.tsx
//
// Base marché (brique 4a Achat IA) : par catégorie d'achat, nos fournisseurs +
// candidats/concurrents découverts par l'IA (à valider). Alimente les appels d'offre.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Globe, ArrowLeft, Sparkles, Loader2, Check, X, Trash2, Plus, Mail, Phone, ExternalLink, Building2 } from 'lucide-react'

const eur = (n: number) => n.toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' €'

export default function MarcheClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [market, setMarket] = useState<any[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [ours, setOurs] = useState<any[]>([])
  const [cat, setCat] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [msg, setMsg] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<any>({ name: '', email: '', phone: '', website: '' })

  const loadMarket = () => fetch('/api/admin/achats/market', { cache: 'no-store' }).then(r => r.json()).then(d => { setMarket(d.market || []); setCats(d.allCategories || []); if (!cat && d.allCategories?.length) setCat(d.allCategories[0]) })
  const loadOurs = () => fetch('/api/admin/achats?suppliers=1&months=12', { cache: 'no-store' }).then(r => r.json()).then(d => setOurs(d.suppliers || [])).catch(() => {})
  useEffect(() => { loadMarket(); loadOurs() }, [])   // eslint-disable-line

  const post = (p: any) => fetch('/api/admin/achats/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(r => r.json())

  const discover = async () => {
    setDiscovering(true); setMsg('')
    try { const j = await post({ action: 'discover', category: cat }); setMsg(j.error ? '❌ ' + j.error : `✅ ${j.added} candidat(s) ajouté(s) sur ${j.found} trouvé(s)`); await loadMarket() }
    finally { setDiscovering(false) }
  }
  const setStatus = async (id: string, status: string) => { await post({ action: 'set_status', id, status }); await loadMarket() }
  const del = async (id: string) => { if (confirm('Supprimer ce fournisseur du marché ?')) { await post({ action: 'delete', id }); await loadMarket() } }
  const addManual = async () => {
    if (!form.name.trim()) return
    const j = await post({ action: 'save', category: cat, ...form })
    if (j.error) setMsg('❌ ' + j.error); else { setForm({ name: '', email: '', phone: '', website: '' }); setAdding(false); await loadMarket() }
  }

  const inCat = market.filter(m => m.category === cat)
  const candidates = inCat.filter(m => m.status === 'a_verifier')
  const validated = inCat.filter(m => m.status === 'valide')
  const oursInCat = ours.filter(s => (s.meta?.categories?.includes(cat)) || s.dominant?.includes(cat))

  const Row = ({ m }: { m: any }) => (
    <div className="flex items-start gap-2 bg-surface-2 border rounded-lg px-3 py-2">
      <Building2 size={15} className="text-ink-muted mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-ink text-sm font-medium">{m.name}</span>
          {m.source === 'ia_web' && <span className="text-[9px] px-1 rounded bg-sky-500/10 text-sky-500">IA web</span>}
          {m.region && <span className="text-[11px] text-ink-muted">· {m.region}</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap text-[11px] text-ink-muted">
          {m.email && <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 hover:text-brand"><Mail size={10} /> {m.email}</a>}
          {m.phone && <span className="inline-flex items-center gap-1"><Phone size={10} /> {m.phone}</span>}
          {m.website && <a href={m.website.startsWith('http') ? m.website : `https://${m.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand"><ExternalLink size={10} /> site</a>}
        </div>
        {m.notes && <p className="text-[11px] text-ink-muted/80 mt-0.5">{m.notes}</p>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {m.status === 'a_verifier' && <button onClick={() => setStatus(m.id, 'valide')} title="Valider" className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"><Check size={15} /></button>}
        {m.status === 'a_verifier' && <button onClick={() => setStatus(m.id, 'rejete')} title="Rejeter" className="p-1 text-ink-muted hover:text-red-400 rounded"><X size={15} /></button>}
        <button onClick={() => del(m.id)} title="Supprimer" className="p-1 text-ink-muted/50 hover:text-red-500 rounded"><Trash2 size={13} /></button>
      </div>
    </div>
  )

  return (
    <AppShell title="Base marché" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-5">
          <a href="/achats" className="p-2 rounded-lg border text-ink-muted hover:text-brand" title="Retour"><ArrowLeft size={16} /></a>
          <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><Globe size={20} /></div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-ink leading-tight">Base marché</h1>
            <p className="text-ink-muted text-xs">Nos fournisseurs + concurrents par catégorie — pour lancer des appels d'offre.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select value={cat} onChange={e => setCat(e.target.value)} className="bg-surface border rounded-lg px-3 py-2 text-sm text-ink">
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={discover} disabled={discovering || !cat} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50">
            {discovering ? <><Loader2 size={15} className="animate-spin" /> Recherche web…</> : <><Sparkles size={15} /> Découvrir (IA)</>}
          </button>
          <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border hover:bg-bg"><Plus size={15} /> Ajouter</button>
          {msg && <span className="text-sm">{msg}</span>}
        </div>

        {adding && (
          <div className="bg-surface border rounded-xl p-3 mb-4 grid sm:grid-cols-2 gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nom du fournisseur" className="bg-bg border rounded-lg px-3 py-2 text-sm text-ink" />
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="bg-bg border rounded-lg px-3 py-2 text-sm text-ink" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Téléphone" className="bg-bg border rounded-lg px-3 py-2 text-sm text-ink" />
            <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="Site web" className="bg-bg border rounded-lg px-3 py-2 text-sm text-ink" />
            <button onClick={addManual} disabled={!form.name.trim()} className="sm:col-span-2 text-sm px-3 py-2 rounded-lg bg-brand text-white disabled:opacity-50">Ajouter à « {cat} »</button>
          </div>
        )}

        {/* Nos fournisseurs dans cette catégorie */}
        <div className="mb-5">
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Nos fournisseurs ({oursInCat.length})</h2>
          {oursInCat.length ? (
            <div className="flex flex-wrap gap-1.5">
              {oursInCat.map(s => <span key={s.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-700">{s.name} · {eur(s.htva)}</span>)}
            </div>
          ) : <p className="text-ink-muted text-sm">Aucun fournisseur classé dans cette catégorie (renseigne « ce qu'il fournit » dans le Répertoire).</p>}
        </div>

        {/* Candidats à vérifier */}
        {candidates.length > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">À vérifier ({candidates.length})</h2>
            <div className="flex flex-col gap-2">{candidates.map(m => <Row key={m.id} m={m} />)}</div>
          </div>
        )}

        {/* Marché validé */}
        <div>
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Concurrents validés ({validated.length})</h2>
          {validated.length ? <div className="flex flex-col gap-2">{validated.map(m => <Row key={m.id} m={m} />)}</div>
            : <p className="text-ink-muted text-sm">Aucun encore. Lance « Découvrir (IA) » puis valide les pertinents.</p>}
        </div>
      </div>
    </AppShell>
  )
}
