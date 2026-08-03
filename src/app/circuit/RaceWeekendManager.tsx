'use client'
// src/app/circuit/RaceWeekendManager.tsx
//
// Week-ends de COURSE (circuit) : encodage par jour (nb dépanneuses, forfait
// jour/nuit, supplément horaire) → devis Odoo BROUILLON (sections/jour + produits).

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Flag, ArrowLeft, Plus, Trash2, Save, FileText, Loader2, Search, X, ExternalLink, Sun, Moon } from 'lucide-react'

type Supp = { from: string; to: string }
type Day = { date: string; nb: number; jour: boolean; nuit: boolean; supps: Supp[]; drivers: string[]; note: string }
const emptyDay = (): Day => ({ date: '', nb: 1, jour: true, nuit: false, supps: [], drivers: [], note: '' })
const suppHours = (from?: string, to?: string): number => {
  if (!from || !to) return 0
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  let diff = mins(to) - mins(from); if (diff < 0) diff += 1440
  return Math.round((diff / 60) * 100) / 100
}
const dayHours = (d: Day) => (d.supps || []).reduce((a, s) => a + suppHours(s.from, s.to), 0)

export default function RaceWeekendManager({ userRole, userName, userEmail, userModules }: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [list, setList] = useState<any[]>([])
  const [personnel, setPersonnel] = useState<any[]>([])
  const [editing, setEditing] = useState<any>(null)   // {id?, label, client_odoo_id, client_name, days[], notes}
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const nameOfP = (id: string) => personnel.find(p => p.id === id)?.name || '?'
  const load = () => fetch('/api/circuit-race', { cache: 'no-store' }).then(r => r.json()).then(d => { setList(d.weekends || []); setPersonnel(d.personnel || []) })
  useEffect(() => { load() }, [])

  // Recherche client Odoo (debounce)
  useEffect(() => {
    if (!editing || (editing.client_name && q === editing.client_name)) return
    if (q.trim().length < 3) { setResults([]); return }
    const t = setTimeout(() => {
      fetch(`/api/odoo/search-client?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        .then(r => r.json()).then(d => setResults(d.clients || [])).catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [q, editing])

  const newWeekend = () => { setEditing({ label: '', client_odoo_id: null, client_name: '', days: [emptyDay()], notes: '' }); setQ(''); setResults([]); setMsg('') }
  const edit = (w: any) => { setEditing({ ...w, days: (w.days || []).length ? w.days : [emptyDay()] }); setQ(w.client_name || ''); setResults([]); setMsg('') }

  const post = (payload: any) => fetch('/api/circuit-race', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json())

  const setDay = (i: number, patch: Partial<Day>) => setEditing((e: any) => ({ ...e, days: e.days.map((d: Day, idx: number) => idx === i ? { ...d, ...patch } : d) }))
  const addDay = () => setEditing((e: any) => ({ ...e, days: [...e.days, emptyDay()] }))
  const removeDay = (i: number) => setEditing((e: any) => ({ ...e, days: e.days.filter((_: any, idx: number) => idx !== i) }))
  const toggleDriver = (i: number, pid: string) => setEditing((e: any) => ({ ...e, days: e.days.map((d: Day, idx: number) => idx === i ? { ...d, drivers: (d.drivers || []).includes(pid) ? d.drivers.filter(x => x !== pid) : [...(d.drivers || []), pid] } : d) }))
  const addSupp = (i: number) => setEditing((e: any) => ({ ...e, days: e.days.map((d: Day, idx: number) => idx === i ? { ...d, supps: [...(d.supps || []), { from: '', to: '' }] } : d) }))
  const setSupp = (i: number, si: number, patch: Partial<Supp>) => setEditing((e: any) => ({ ...e, days: e.days.map((d: Day, idx: number) => idx === i ? { ...d, supps: d.supps.map((s, sj) => sj === si ? { ...s, ...patch } : s) } : d) }))
  const removeSupp = (i: number, si: number) => setEditing((e: any) => ({ ...e, days: e.days.map((d: Day, idx: number) => idx === i ? { ...d, supps: d.supps.filter((_, sj) => sj !== si) } : d) }))

  const save = async () => {
    if (!editing.label?.trim()) { setMsg('❌ Intitulé requis'); return }
    setBusy('save'); setMsg('')
    try {
      const j = await post({ action: 'save', id: editing.id, label: editing.label, client_odoo_id: editing.client_odoo_id, client_name: editing.client_name, days: editing.days, notes: editing.notes })
      if (j.error) { setMsg('❌ ' + j.error); return }
      setEditing((e: any) => ({ ...e, id: j.id })); setMsg('✅ Enregistré'); await load()
    } finally { setBusy('') }
  }

  const makeQuote = async () => {
    if (!editing.label?.trim()) { setMsg('❌ Intitulé requis'); return }
    if (!editing.client_odoo_id) { setMsg('❌ Sélectionne un client Odoo'); return }
    setBusy('quote'); setMsg('')
    try {
      // Enregistre l'état courant d'abord (crée l'id si besoin), puis génère le devis.
      const s = await post({ action: 'save', id: editing.id, label: editing.label, client_odoo_id: editing.client_odoo_id, client_name: editing.client_name, days: editing.days, notes: editing.notes })
      if (s.error) { setMsg('❌ ' + s.error); return }
      const id = s.id || editing.id
      setEditing((e: any) => ({ ...e, id }))
      const j = await post({ action: 'quote', id })
      if (j.error) { setMsg('❌ ' + j.error); return }
      setMsg(`✅ Devis brouillon créé : ${j.order?.name}`); await load()
      setEditing((e: any) => ({ ...e, id, odoo_sale_order_id: j.order?.id, odoo_sale_order_name: j.order?.name }))
    } finally { setBusy('') }
  }

  const del = async (id: string) => { if (confirm('Supprimer ce week-end ?')) { await post({ action: 'delete', id }); if (editing?.id === id) setEditing(null); await load() } }

  const odooBase = 'https://verviers-depannage.odoo.com/odoo/sales'

  return (
    <AppShell title="Week-ends de course" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-5">
          <a href="/circuit" className="p-2 rounded-lg border text-ink-muted hover:text-brand"><ArrowLeft size={16} /></a>
          <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center"><Flag size={20} /></div>
          <div className="flex-1"><h1 className="text-xl font-bold text-ink leading-tight">Week-ends de course</h1>
            <p className="text-ink-muted text-xs">Encode par jour → devis Odoo (brouillon) avec une section par jour.</p></div>
          {!editing && <button onClick={newWeekend} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90"><Plus size={16} /> Nouveau</button>}
        </div>

        {editing ? (
          <div className="bg-surface border rounded-2xl p-5 space-y-4">
            <input value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} placeholder="Intitulé (ex. 6H de Spa 2026)" className="w-full bg-bg border rounded-lg px-3 py-2 text-sm text-ink font-medium" />

            {/* Client Odoo */}
            <div>
              <div className="flex items-center gap-2 bg-bg border rounded-lg px-3 py-2">
                <Search size={15} className="text-ink-muted" />
                <input value={q} onChange={e => { setQ(e.target.value); setEditing({ ...editing, client_odoo_id: null }) }} placeholder="Rechercher le client Odoo…" className="flex-1 bg-transparent text-sm text-ink outline-none" />
                {editing.client_odoo_id && <span className="text-xs text-emerald-600">✓ {editing.client_name}</span>}
              </div>
              {results.length > 0 && !editing.client_odoo_id && (
                <div className="border rounded-lg mt-1 max-h-40 overflow-auto">
                  {results.map((c: any) => (
                    <button key={c.id} onClick={() => { setEditing({ ...editing, client_odoo_id: c.id, client_name: c.name }); setQ(c.name); setResults([]) }}
                      className="block w-full text-left px-3 py-2 text-sm text-ink hover:bg-bg">{c.name}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Jours */}
            <div>
              <div className="flex flex-col gap-2">
                {editing.days.map((d: Day, i: number) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 bg-surface-2/50 border rounded-xl p-2">
                      <input type="date" value={d.date} onChange={e => setDay(i, { date: e.target.value })} className="bg-bg border rounded-lg px-2 py-1.5 text-sm text-ink" />
                      <label className="flex items-center gap-1 text-xs text-ink-muted">Dép.
                        <input type="number" min={1} value={d.nb} onChange={e => setDay(i, { nb: Number(e.target.value) })} className="w-12 bg-bg border rounded-lg px-1 py-1.5 text-sm text-ink text-center" /></label>
                      <button onClick={() => setDay(i, { jour: !d.jour })} title="Forfait jour (08h-18h)" className={`inline-flex items-center gap-1 px-2 h-8 rounded-lg border text-xs ${d.jour ? 'bg-amber-500/20 text-amber-600 border-amber-400' : 'text-ink-muted'}`}><Sun size={14} /> Jour</button>
                      <button onClick={() => setDay(i, { nuit: !d.nuit })} title="Forfait nuit (18h-08h)" className={`inline-flex items-center gap-1 px-2 h-8 rounded-lg border text-xs ${d.nuit ? 'bg-indigo-500/20 text-indigo-600 border-indigo-400' : 'text-ink-muted'}`}><Moon size={14} /> Nuit</button>
                      <button onClick={() => removeDay(i)} className="ml-auto p-1.5 text-ink-muted/60 hover:text-red-500"><X size={14} /></button>

                      {/* Suppléments du jour (plusieurs possibles, plage de-à) */}
                      <div className="w-full flex flex-col gap-1 pl-1">
                        {(d.supps || []).map((s: Supp, si: number) => {
                          const h = suppHours(s.from, s.to)
                          return (
                            <div key={si} className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] text-ink-muted">Suppl. de</span>
                              <input type="time" value={s.from} onChange={e => setSupp(i, si, { from: e.target.value })} className="bg-bg border rounded-lg px-1.5 py-1 text-sm text-ink" />
                              <span className="text-[11px] text-ink-muted">à</span>
                              <input type="time" value={s.to} onChange={e => setSupp(i, si, { to: e.target.value })} className="bg-bg border rounded-lg px-1.5 py-1 text-sm text-ink" />
                              {h > 0 && <span className="text-xs font-medium text-emerald-600">= {h} h</span>}
                              <button onClick={() => removeSupp(i, si)} className="p-1 text-ink-muted/50 hover:text-red-400"><X size={12} /></button>
                            </div>
                          )
                        })}
                        <button onClick={() => addSupp(i)} className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline w-fit"><Plus size={12} /> supplément</button>
                      </div>

                      {/* Chauffeurs internes du jour (1 chauffeur = 1 dépanneuse → CA rentabilité) */}
                      <div className="w-full flex flex-wrap items-center gap-1.5 pl-1">
                        <span className="text-[11px] text-ink-muted">Chauffeurs internes :</span>
                        {(d.drivers || []).map((pid: string) => (
                          <span key={pid} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700">{nameOfP(pid)} <button onClick={() => toggleDriver(i, pid)}><X size={10} /></button></span>
                        ))}
                        <select value="" onChange={e => { if (e.target.value) toggleDriver(i, e.target.value); e.currentTarget.value = '' }} className="text-[11px] bg-bg border rounded px-1.5 py-1 text-ink">
                          <option value="">+ ajouter</option>
                          {personnel.filter(p => !(d.drivers || []).includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <input value={d.note || ''} onChange={e => setDay(i, { note: e.target.value })} placeholder="Note du jour (affichée sous la section du devis)" className="w-full bg-bg border rounded-lg px-2 py-1.5 text-xs text-ink" />
                    </div>
                ))}
              </div>
              <button onClick={addDay} className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"><Plus size={13} /> Ajouter un jour</button>
              <p className="text-[11px] text-ink-muted mt-1">Forfait (jour/nuit) et supplément (× heures de la plage) sont multipliés par le nb de dépanneuses. La plage « de‑à » justifie le supplément sur le devis. Produits : Course 650 €, Heure suppl. 75 €/h.</p>
            </div>

            <textarea value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} rows={2} placeholder="Notes (optionnel)" className="w-full bg-bg border rounded-lg px-3 py-2 text-sm text-ink resize-none" />

            {msg && <p className="text-sm">{msg}</p>}
            {editing.odoo_sale_order_name && (
              <a href={`${odooBase}/${editing.odoo_sale_order_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"><ExternalLink size={14} /> {editing.odoo_sale_order_name} (brouillon Odoo)</a>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={save} disabled={!!busy} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border hover:bg-bg disabled:opacity-50"><Save size={15} /> {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}</button>
              <button onClick={makeQuote} disabled={!!busy || !editing.client_odoo_id} title={!editing.client_odoo_id ? 'Sélectionne un client Odoo d\'abord' : ''} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-brand text-white hover:opacity-90 disabled:opacity-50">{busy === 'quote' ? <><Loader2 size={15} className="animate-spin" /> {editing.odoo_sale_order_id ? 'Mise à jour…' : 'Création…'}</> : <><FileText size={15} /> {editing.odoo_sale_order_id ? 'Mettre à jour le devis' : 'Créer le devis (brouillon)'}</>}</button>
              <button onClick={() => setEditing(null)} className="text-sm px-3.5 py-2 rounded-lg border hover:bg-bg ml-auto">Fermer</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {!list.length && <p className="text-ink-muted text-sm">Aucun week-end de course. Clique « Nouveau ».</p>}
            {list.map((w: any) => (
              <div key={w.id} className="bg-surface border rounded-xl p-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink text-sm truncate">{w.label}</div>
                  <div className="text-ink-muted text-xs">{w.client_name || '— client à définir —'} · {(w.days || []).length} jour(s){w.odoo_sale_order_name ? ` · devis ${w.odoo_sale_order_name}` : ''}</div>
                </div>
                <button onClick={() => edit(w)} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-bg">Ouvrir</button>
                <button onClick={() => del(w.id)} className="p-1.5 text-ink-muted/60 hover:text-red-500"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
