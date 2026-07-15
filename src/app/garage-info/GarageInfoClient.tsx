'use client'
// src/app/admin/garage-closures/GarageInfoClient.tsx
// CRUD des fermetures de garage : quand une adresse de destination/relivraison
// contient les mots-clés, un bandeau s'affiche sur les fiches (dispatch + chauffeur)
// pendant la période. Olivier 2026-07-15.

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { Loader2, Trash2, Plus } from 'lucide-react'

interface Closure {
  id?:            string
  name:           string
  match_keywords: string
  date_from:      string
  date_to:        string
  message:        string
  active:         boolean
}
interface Props { userRole: string; userName: string; userEmail?: string | null; userModules: string[] }

const EMPTY: Closure = { name: '', match_keywords: '', date_from: '', date_to: '', message: '', active: true }

export default function GarageInfoClient({ userRole, userName, userEmail, userModules }: Props) {
  const [items, setItems]     = useState<Closure[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft]     = useState<Closure>(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/garage-closures')
      const j = await r.json()
      setItems(j.closures || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async (c: Closure) => {
    setSaving(true); setErr('')
    try {
      const method = c.id ? 'PATCH' : 'POST'
      const r = await fetch('/api/admin/garage-closures', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Erreur'); return }
      if (!c.id) setDraft(EMPTY)
      await load()
    } catch (e: any) { setErr(e?.message || 'Erreur réseau') }
    finally { setSaving(false) }
  }

  const remove = async (id?: string) => {
    if (!id || !confirm('Supprimer cette fermeture ?')) return
    await fetch(`/api/admin/garage-closures?id=${id}`, { method: 'DELETE' })
    await load()
  }

  const inputCls = 'bg-surface-2 border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand w-full'

  return (
    <AppShell title="Garage Info" backHref="/dashboard" userRole={userRole} userName={userName} userEmail={userEmail ?? undefined} userModules={userModules}>
      <div className="px-4 lg:px-8 py-5 max-w-4xl mx-auto space-y-6">
        <p className="text-ink-muted text-sm">
          Quand l'adresse de destination ou de relivraison contient <strong>tous</strong> les mots-clés,
          un bandeau d'alerte s'affiche sur les fiches (dispatch + chauffeur) pendant la période.
        </p>

        {/* Formulaire d'ajout */}
        <div className="bg-surface border rounded-2xl p-5 space-y-3">
          <h2 className="text-ink font-semibold text-sm flex items-center gap-2"><Plus size={16} /> Nouvelle fermeture</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-ink-muted">Libellé (facultatif)
              <input className={inputCls} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Car Avenue Verviers" />
            </label>
            <label className="text-xs text-ink-muted">Mots-clés dans l'adresse (séparés par virgule, tous requis)
              <input className={inputCls} value={draft.match_keywords} onChange={e => setDraft({ ...draft, match_keywords: e.target.value })} placeholder="car avenue, verviers" />
            </label>
            <label className="text-xs text-ink-muted">Du (inclus)
              <input type="date" className={inputCls} value={draft.date_from} onChange={e => setDraft({ ...draft, date_from: e.target.value })} />
            </label>
            <label className="text-xs text-ink-muted">Au (inclus)
              <input type="date" className={inputCls} value={draft.date_to} onChange={e => setDraft({ ...draft, date_to: e.target.value })} />
            </label>
          </div>
          <label className="text-xs text-ink-muted block">Message affiché
            <textarea rows={2} className={inputCls} value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })}
              placeholder="Garage fermé du … au … inclus, dépannage et remorquage repris par …" />
          </label>
          {err && <p className="text-critical text-sm">{err}</p>}
          <button onClick={() => save(draft)} disabled={saving}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Ajouter'}
          </button>
        </div>

        {/* Liste */}
        {loading ? (
          <p className="text-ink-muted text-sm text-center py-8"><Loader2 className="animate-spin inline" size={16} /> Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-ink-muted text-sm text-center py-8">Aucune fermeture configurée.</p>
        ) : (
          <div className="space-y-3">
            {items.map((c, i) => (
              <div key={c.id} className="bg-surface border rounded-2xl p-4 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <input className={inputCls} value={c.name || ''} onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Libellé" />
                  <input className={inputCls} value={c.match_keywords} onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, match_keywords: e.target.value } : x))} placeholder="mots-clés" />
                  <input type="date" className={inputCls} value={c.date_from} onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, date_from: e.target.value } : x))} />
                  <input type="date" className={inputCls} value={c.date_to} onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, date_to: e.target.value } : x))} />
                </div>
                <textarea rows={2} className={inputCls} value={c.message} onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, message: e.target.value } : x))} />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
                    <input type="checkbox" checked={c.active} onChange={e => setItems(p => p.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))} />
                    Actif
                  </label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => save(c)} disabled={saving} className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium disabled:opacity-50">Enregistrer</button>
                    <button onClick={() => remove(c.id)} className="p-2 text-critical hover:bg-critical-soft rounded-lg" title="Supprimer"><Trash2 size={16} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
