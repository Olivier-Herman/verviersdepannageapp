'use client'
// src/app/admin/decharges/DechargesAdminClient.tsx
//
// Page admin : edition CRUD du catalogue de types de decharges.
// - Liste les types existants (actifs + inactifs)
// - Editer en inline (modal) chaque champ
// - Toggle actif/inactif (= masquer cote chauffeur sans supprimer)
// - Creer un nouveau type
// - Supprimer (warning : les decharges deja signees gardent leur type_key)

import { useEffect, useState } from 'react'

interface DischargeRow {
  id:               string
  key:              string
  label:            string
  title:            string
  body:             string
  footnote:         string | null
  name_field_label: string | null
  color:            'red' | 'green'
  needs_comment:    boolean
  comment_label:    string | null
  needs_photos:     boolean
  photos_hint:      string | null
  needs_schema:     boolean
  active:           boolean
  sort_order:       number
}

export default function DechargesAdminClient() {
  const [list, setList] = useState<DischargeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<DischargeRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/decharges')
      const j = await r.json()
      setList(j.types || [])
    } catch (e: any) {
      setErr(e.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const toggleActive = async (row: DischargeRow) => {
    const r = await fetch(`/api/admin/decharges/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !row.active }),
    })
    if (r.ok) load()
  }

  const remove = async (row: DischargeRow) => {
    if (!confirm(`Supprimer définitivement le type "${row.label}" ?\n\nAttention : les décharges déjà signées avec ce type garderont leur référence mais leur titre/texte affichera un message d'erreur.\n\nPréfère désactiver (masquer) plutôt que supprimer.`)) return
    const r = await fetch(`/api/admin/decharges/${row.id}`, { method: 'DELETE' })
    if (r.ok) load()
  }

  return (
    <div className="px-4 lg:px-8 py-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-ink text-xl lg:text-2xl font-bold font-display">Types de décharges</h2>
            <p className="text-ink-muted text-sm mt-1">Catalogue partagé entre chauffeurs. Modifications visibles en temps réel.</p>
          </div>
          <button onClick={() => setCreating(true)}
            className="px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold whitespace-nowrap">
            + Nouveau type
          </button>
        </div>

        {err && <p className="text-red-400 text-sm mb-3">⚠️ {err}</p>}
        {loading && <p className="text-ink-muted text-sm">Chargement…</p>}

        <div className="space-y-2">
          {list.map(row => (
            <div key={row.id}
              className={`bg-surface border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 transition ${row.active ? '' : 'opacity-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`inline-block w-2 h-2 rounded-full ${row.color === 'green' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <p className="text-ink font-semibold text-sm">{row.label}</p>
                  {!row.active && <span className="text-ink-faint text-xs">(désactivé)</span>}
                </div>
                <p className="text-ink-muted text-xs font-mono truncate">{row.key}</p>
                <p className="text-ink-secondary text-xs mt-1 line-clamp-2">{row.body}</p>
                <div className="flex gap-2 flex-wrap mt-2">
                  {row.needs_comment && <span className="text-[10px] px-2 py-0.5 bg-blue-500/15 text-blue-400 rounded">commentaire</span>}
                  {row.needs_photos && <span className="text-[10px] px-2 py-0.5 bg-purple-500/15 text-purple-400 rounded">photos</span>}
                  {row.needs_schema && <span className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-400 rounded">schéma</span>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => toggleActive(row)}
                  className="px-3 py-1.5 bg-surface-hover text-ink-secondary rounded-lg text-xs">
                  {row.active ? '🚫 Désactiver' : '✅ Activer'}
                </button>
                <button onClick={() => setEditing(row)}
                  className="px-3 py-1.5 bg-surface-hover text-ink rounded-lg text-xs font-medium">
                  ✏️ Modifier
                </button>
                <button onClick={() => remove(row)}
                  className="px-3 py-1.5 bg-critical-soft text-critical rounded-lg text-xs">
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>

        {(editing || creating) && (
          <EditModal
            initial={editing}
            onClose={() => { setEditing(null); setCreating(false) }}
            onSaved={() => { setEditing(null); setCreating(false); load() }}
          />
        )}
    </div>
  )
}

function EditModal({ initial, onClose, onSaved }: {
  initial: DischargeRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    key:              initial?.key || '',
    label:            initial?.label || '',
    title:            initial?.title || '',
    body:             initial?.body || '',
    footnote:         initial?.footnote || '',
    name_field_label: initial?.name_field_label || '',
    color:            initial?.color || 'red',
    needs_comment:    initial?.needs_comment ?? false,
    comment_label:    initial?.comment_label || '',
    needs_photos:     initial?.needs_photos ?? false,
    photos_hint:      initial?.photos_hint || '',
    needs_schema:     initial?.needs_schema ?? false,
    active:           initial?.active ?? true,
    sort_order:       initial?.sort_order ?? 999,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const f = (k: keyof typeof form) => (v: any) => setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const url = initial ? `/api/admin/decharges/${initial.id}` : '/api/admin/decharges'
      const method = initial ? 'PATCH' : 'POST'
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      onSaved()
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface border rounded-lg px-3 py-2 text-ink text-sm outline-none focus:border-brand'
  const labelCls = 'block text-ink-muted text-xs uppercase tracking-wide mb-1 font-medium'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-2xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
        <p className="text-ink font-semibold">{initial ? 'Modifier le type' : 'Nouveau type de décharge'}</p>

        {!initial && (
          <div>
            <p className={labelCls}>Clé technique (slug)</p>
            <input value={form.key} onChange={e => f('key')(e.target.value)} placeholder="ex: ma_nouvelle_decharge"
              className={inputCls + ' font-mono'} />
          </div>
        )}

        <div>
          <p className={labelCls}>Libellé court (dropdown chauffeur) *</p>
          <input value={form.label} onChange={e => f('label')(e.target.value)} className={inputCls} />
        </div>

        <div>
          <p className={labelCls}>Titre formel (PDF) *</p>
          <input value={form.title} onChange={e => f('title')(e.target.value)} className={inputCls} />
        </div>

        <div>
          <p className={labelCls}>Texte juridique *</p>
          <textarea value={form.body} onChange={e => f('body')(e.target.value)} rows={5} className={inputCls + ' resize-none'} />
          <p className="text-ink-faint text-xs mt-1">Astuce : double saut de ligne (\n\n) pour separer les paragraphes</p>
        </div>

        <div>
          <p className={labelCls}>Note bas de page (optionnel)</p>
          <input value={form.footnote} onChange={e => f('footnote')(e.target.value)} placeholder="Ex: Ne pas oublier les photos"
            className={inputCls} />
        </div>

        <div>
          <p className={labelCls}>Label du champ nom (optionnel)</p>
          <input value={form.name_field_label} onChange={e => f('name_field_label')(e.target.value)} placeholder="Ex: Nom du client réceptionnaire"
            className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>Couleur</p>
            <select value={form.color} onChange={e => f('color')(e.target.value)} className={inputCls}>
              <option value="red">Rouge (décharge classique)</option>
              <option value="green">Vert (fin d'intervention)</option>
            </select>
          </div>
          <div>
            <p className={labelCls}>Ordre d'affichage</p>
            <input type="number" value={form.sort_order} onChange={e => f('sort_order')(Number(e.target.value))} className={inputCls} />
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.needs_comment} onChange={e => f('needs_comment')(e.target.checked)} />
            <span className="text-ink">Commentaire requis</span>
          </label>
          {form.needs_comment && (
            <input value={form.comment_label} onChange={e => f('comment_label')(e.target.value)} placeholder="Label du commentaire (ex: Description du risque)"
              className={inputCls + ' ml-6 w-[calc(100%-1.5rem)]'} />
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.needs_photos} onChange={e => f('needs_photos')(e.target.checked)} />
            <span className="text-ink">Photos requises</span>
          </label>
          {form.needs_photos && (
            <input value={form.photos_hint} onChange={e => f('photos_hint')(e.target.value)} placeholder="Hint sur les photos (ex: Photos précises des dommages)"
              className={inputCls + ' ml-6 w-[calc(100%-1.5rem)]'} />
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.needs_schema} onChange={e => f('needs_schema')(e.target.checked)} />
            <span className="text-ink">Schéma de dégâts (4 vues voiture annotables)</span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={e => f('active')(e.target.checked)} />
            <span className="text-ink">Actif (visible côté chauffeur)</span>
          </label>
        </div>

        {err && <p className="text-red-400 text-xs">⚠️ {err}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 bg-surface-hover text-ink-secondary rounded-lg text-sm">Annuler</button>
          <button onClick={save} disabled={saving || !form.label || !form.title || !form.body || (!initial && !form.key)}
            className="flex-1 py-2.5 bg-brand disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
            {saving ? '⏳…' : (initial ? 'Enregistrer' : 'Créer')}
          </button>
        </div>
      </div>
    </div>
  )
}
