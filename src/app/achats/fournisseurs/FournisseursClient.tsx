'use client'
// src/app/achats/fournisseurs/FournisseursClient.tsx
//
// Répertoire fournisseurs enrichi (brique 2 Achat IA) : métriques calculées +
// métadonnées éditables (contacts, ce qu'il fournit, conditions, note fiabilité).

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { ShoppingCart, ArrowLeft, Search, Mail, Phone, Star, Save, Download, Loader2, Package, CalendarClock, ChevronDown, Sparkles } from 'lucide-react'

const eur = (n: number) => n.toLocaleString('fr-BE', { maximumFractionDigits: 0 }) + ' €'
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

export default function FournisseursClient({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [enriching, setEnriching] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  const load = () => { setLoading(true); return fetch('/api/admin/achats?suppliers=1&months=12', { cache: 'no-store' }).then(r => r.json()).then(setData).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const open = (s: any) => {
    if (openId === s.id) { setOpenId(null); return }
    setOpenId(s.id)
    const m = s.meta || {}
    setForm({ contact_name: m.contact_name || '', email: m.email || '', phone: m.phone || '', categories: m.categories || [], payment_terms: m.payment_terms || '', lead_time_days: m.lead_time_days ?? '', rating: m.rating ?? '', notes: m.notes || '' })
  }

  const save = async (id: number) => {
    setSaving(true); setMsg('')
    try {
      const r = await fetch('/api/admin/achats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'supplier_save', partner_id: id, meta: form }) })
      const j = await r.json()
      if (!r.ok) { setMsg('❌ ' + (j.error || 'Erreur')); return }
      setMsg('✅ Enregistré'); await load(); setOpenId(null)
    } finally { setSaving(false) }
  }

  const importOdoo = async () => {
    setImporting(true); setMsg('')
    try {
      const ids = (data?.suppliers || []).map((s: any) => s.id)
      const r = await fetch('/api/admin/achats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'supplier_import', ids }) })
      const j = await r.json()
      setMsg(r.ok ? `✅ ${j.filled} contact(s) importé(s) depuis Odoo` : '❌ ' + (j.error || 'Erreur'))
      await load()
    } finally { setImporting(false) }
  }

  const enrich = async (s: any) => {
    setEnriching(s.id); setMsg('')
    try {
      const r = await fetch('/api/admin/achats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'supplier_enrich', partner_id: s.id, supplier_name: s.name }) })
      const j = await r.json()
      if (!r.ok) { setMsg('❌ ' + (j.error || 'Erreur')); return }
      // Pré-remplit le formulaire ouvert avec ce qui a été trouvé (champs vides).
      const f = j.found || {}
      setForm((prev: any) => ({ ...prev, email: prev.email || f.email || '', phone: prev.phone || f.phone || '', contact_name: prev.contact_name || f.contact_name || '', payment_terms: prev.payment_terms || f.payment_terms || '' }))
      setMsg(j.filled?.length ? `✅ Complété : ${j.filled.join(', ')} (${j.sources} mail(s))` : `Rien de neuf trouvé (${j.sources} mail(s) analysés)`)
      await load()
    } finally { setEnriching(null) }
  }

  const toggleCat = (c: string) => setForm((f: any) => ({ ...f, categories: f.categories.includes(c) ? f.categories.filter((x: string) => x !== c) : [...f.categories, c] }))

  const suppliers = (data?.suppliers || []).filter((s: any) => !q || s.name.toLowerCase().includes(q.toLowerCase()))
  const withContact = (data?.suppliers || []).filter((s: any) => s.meta?.email || s.meta?.phone).length
  const rated = (data?.suppliers || []).filter((s: any) => s.meta?.rating).length

  return (
    <AppShell title="Répertoire fournisseurs" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-1">
          <a href="/achats" className="p-2 rounded-lg border text-ink-muted hover:text-brand" title="Retour"><ArrowLeft size={16} /></a>
          <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><ShoppingCart size={20} /></div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-ink leading-tight">Répertoire fournisseurs</h1>
            <p className="text-ink-muted text-xs">{data?.suppliers?.length || 0} fournisseurs · {withContact} avec contact · {rated} notés · 12 mois</p>
          </div>
          <button onClick={importOdoo} disabled={importing} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border hover:bg-bg disabled:opacity-50">
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Contacts Odoo
          </button>
        </div>

        <div className="flex items-center gap-2 mt-4 mb-3">
          <div className="flex-1 flex items-center gap-2 bg-surface border rounded-lg px-3 py-2">
            <Search size={15} className="text-ink-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un fournisseur…" className="flex-1 bg-transparent text-sm text-ink outline-none" />
          </div>
          {msg && <span className="text-sm">{msg}</span>}
        </div>

        {loading && !data && <p className="text-ink-muted text-sm">Chargement…</p>}

        <div className="flex flex-col gap-2">
          {suppliers.map((s: any) => {
            const m = s.meta || {}
            const isOpen = openId === s.id
            return (
              <div key={s.id} className="bg-surface border rounded-xl overflow-hidden">
                <button onClick={() => open(s)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink text-sm truncate">{s.name}</span>
                      {m.rating > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-500">{m.rating}<Star size={11} className="fill-amber-400 text-amber-400" /></span>}
                      {(m.email || m.phone) && <Mail size={12} className="text-emerald-500" />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {(m.categories?.length ? m.categories : s.dominant).slice(0, 3).map((c: string) => (
                        <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-brand/10 text-brand">{c}</span>
                      ))}
                      <span className="text-[11px] text-ink-muted flex items-center gap-1"><CalendarClock size={10} /> {fmtDate(s.last_date)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-ink font-semibold text-sm">{eur(s.htva)}</div>
                    <div className="text-ink-muted text-[11px]">{s.share}% · {s.count} fact.</div>
                  </div>
                  <ChevronDown size={16} className={`text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t space-y-3">
                    <div className="grid sm:grid-cols-3 gap-3">
                      <label className="block"><span className="text-ink-muted text-xs">Contact</span>
                        <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
                      <label className="block"><span className="text-ink-muted text-xs flex items-center gap-1"><Mail size={11} /> Email</span>
                        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
                      <label className="block"><span className="text-ink-muted text-xs flex items-center gap-1"><Phone size={11} /> Téléphone</span>
                        <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
                    </div>

                    <div>
                      <span className="text-ink-muted text-xs flex items-center gap-1"><Package size={11} /> Ce qu'il fournit <span className="text-ink-muted/60">— corrige ici (prioritaire sur la déduction auto)</span></span>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(data?.allCategories || []).map((c: string) => (
                          <button key={c} onClick={() => toggleCat(c)} className={`text-[11px] px-2 py-1 rounded-full border ${form.categories.includes(c) ? 'bg-brand text-white border-brand' : 'text-ink-muted hover:bg-bg'}`}>{c}</button>
                        ))}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-3">
                      <label className="block"><span className="text-ink-muted text-xs">Conditions de paiement</span>
                        <input value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} placeholder="ex. 30 j fin de mois" className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
                      <label className="block"><span className="text-ink-muted text-xs">Délai livraison (jours)</span>
                        <input type="number" value={form.lead_time_days} onChange={e => setForm({ ...form, lead_time_days: e.target.value })} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink" /></label>
                      <div><span className="text-ink-muted text-xs">Fiabilité</span>
                        <div className="flex items-center gap-1 mt-2">
                          {[1, 2, 3, 4, 5].map(n => (
                            <button key={n} onClick={() => setForm({ ...form, rating: n })}><Star size={18} className={n <= (form.rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-ink-muted/40'} /></button>
                          ))}
                          {form.rating > 0 && <button onClick={() => setForm({ ...form, rating: '' })} className="text-[11px] text-ink-muted ml-1 hover:text-red-400">effacer</button>}
                        </div>
                      </div>
                    </div>

                    <label className="block"><span className="text-ink-muted text-xs">Notes</span>
                      <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full mt-1 bg-bg border rounded-lg px-3 py-2 text-sm text-ink resize-none" /></label>

                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => save(s.id)} disabled={saving} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50"><Save size={15} /> {saving ? 'Enregistrement…' : 'Enregistrer'}</button>
                      <button onClick={() => enrich(s)} disabled={enriching === s.id} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-brand/40 text-brand hover:bg-brand/5 disabled:opacity-50" title="Chercher contact, téléphone et délai de paiement dans les mails et factures">
                        {enriching === s.id ? <><Loader2 size={15} className="animate-spin" /> Recherche…</> : <><Sparkles size={15} /> Compléter via l'IA</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {!loading && !suppliers.length && <p className="text-ink-muted text-sm">Aucun fournisseur.</p>}
        </div>
      </div>
    </AppShell>
  )
}
