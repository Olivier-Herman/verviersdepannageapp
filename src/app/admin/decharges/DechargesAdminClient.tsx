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
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/admin/decharges')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
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
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
          <div>
            <h2 className="text-ink text-xl lg:text-2xl font-bold font-display">Types de décharges</h2>
            <p className="text-ink-muted text-sm mt-1">Catalogue partagé. Toute modification est visible en temps réel côté chauffeur.</p>
          </div>
          <button onClick={() => setCreating(true)}
            className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold whitespace-nowrap shadow-sm transition">
            + Nouveau type
          </button>
        </div>

        {err && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <p className="text-red-400 text-sm">⚠️ {err}</p>
          </div>
        )}
        {loading && <p className="text-ink-muted text-sm">Chargement…</p>}

        {!loading && list.length === 0 && !err && (
          <div className="bg-surface border-2 border-dashed rounded-2xl p-8 text-center">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-ink font-medium">Aucun type de décharge</p>
            <p className="text-ink-muted text-sm mt-1">Crée le premier avec le bouton « + Nouveau type »</p>
          </div>
        )}

        <div className="space-y-2.5">
          {list.map(row => (
            <div key={row.id}
              className={`bg-surface border rounded-2xl overflow-hidden transition hover:shadow-sm ${row.active ? '' : 'opacity-60'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                {/* Avatar couleur */}
                <div className={`hidden sm:flex w-11 h-11 rounded-xl items-center justify-center flex-shrink-0 ${row.color === 'green' ? 'bg-green-500/15' : 'bg-red-500/15'}`}>
                  <span className="text-lg">🛡️</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`sm:hidden inline-block w-2 h-2 rounded-full ${row.color === 'green' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <p className="text-ink font-semibold text-sm">{row.label}</p>
                    {!row.active && <span className="px-1.5 py-0.5 text-[10px] bg-surface-hover text-ink-muted rounded uppercase tracking-wide">Masqué</span>}
                  </div>
                  <p className="text-ink-faint text-[11px] font-mono truncate">{row.key}</p>
                  <p className="text-ink-secondary text-xs mt-1.5 line-clamp-2 leading-relaxed">{row.body}</p>
                  {(row.needs_comment || row.needs_photos || row.needs_schema) && (
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      {row.needs_comment && <span className="text-[10px] px-2 py-0.5 bg-blue-500/15 text-blue-400 rounded-full font-medium">💬 commentaire</span>}
                      {row.needs_photos && <span className="text-[10px] px-2 py-0.5 bg-purple-500/15 text-purple-400 rounded-full font-medium">📷 photos</span>}
                      {row.needs_schema && <span className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-400 rounded-full font-medium">📐 schéma</span>}
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5 flex-shrink-0 sm:flex-col lg:flex-row">
                  <button onClick={() => toggleActive(row)}
                    title={row.active ? 'Masquer côté chauffeur' : 'Rendre visible côté chauffeur'}
                    className="px-3 py-1.5 bg-surface-hover hover:bg-surface text-ink-secondary rounded-lg text-xs whitespace-nowrap transition">
                    {row.active ? '🚫 Masquer' : '✅ Activer'}
                  </button>
                  <button onClick={() => setEditing(row)}
                    className="px-3 py-1.5 bg-brand-soft hover:bg-brand-soft text-brand rounded-lg text-xs font-medium whitespace-nowrap transition">
                    ✏️ Modifier
                  </button>
                  <button onClick={() => remove(row)}
                    title="Supprimer définitivement"
                    className="px-3 py-1.5 bg-critical-soft hover:bg-critical/20 text-critical rounded-lg text-xs whitespace-nowrap transition">
                    🗑️
                  </button>
                </div>
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

  const inputCls = 'w-full bg-surface border rounded-lg px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft transition-colors'
  const labelCls = 'block text-ink-secondary text-xs font-medium mb-1.5'
  const sectionCls = 'space-y-3 pb-4 border-b last:border-b-0 last:pb-0'
  const sectionTitleCls = 'text-ink-muted text-[11px] uppercase tracking-widest font-semibold mb-2'
  const requiredFieldRow = (checked: boolean, onToggle: (v: boolean) => void, title: string, desc: string, extra?: React.ReactNode) => (
    <div className={`rounded-xl border transition ${checked ? 'bg-brand-soft border-brand' : 'bg-surface border'}`}>
      <button
        type="button"
        onClick={() => onToggle(!checked)}
        className="w-full flex items-start gap-3 p-3 text-left">
        <span className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 transition ${checked ? 'bg-brand border-brand' : 'bg-surface border-strong'}`}>
          {checked && <span className="text-white text-xs leading-none">✓</span>}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-ink text-sm font-medium">{title}</span>
          <span className="block text-ink-muted text-xs mt-0.5">{desc}</span>
        </span>
      </button>
      {checked && extra && (
        <div className="px-3 pb-3 pt-1">{extra}</div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-2xl rounded-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${form.color === 'green' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
            <span className="text-xl">🛡️</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-ink font-display font-bold text-lg leading-tight">{initial ? 'Modifier le type' : 'Nouveau type de décharge'}</p>
            <p className="text-ink-muted text-xs mt-0.5">{initial ? `Référence : ${initial.key}` : 'Une fois créé, le chauffeur le verra immédiatement'}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="w-8 h-8 rounded-lg hover:bg-surface-hover text-ink-muted hover:text-ink transition flex items-center justify-center">✕</button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Section : Identification */}
          <div className={sectionCls}>
            <p className={sectionTitleCls}>Identification</p>
            {!initial && (
              <div>
                <p className={labelCls}>Clé technique <span className="text-ink-faint font-normal">(slug, non modifiable plus tard)</span></p>
                <input value={form.key} onChange={e => f('key')(e.target.value)} placeholder="ex_ma_nouvelle_decharge"
                  className={inputCls + ' font-mono'} />
              </div>
            )}
            <div>
              <p className={labelCls}>Libellé court <span className="text-red-400">*</span> <span className="text-ink-faint font-normal">— affiché dans la liste chauffeur</span></p>
              <input value={form.label} onChange={e => f('label')(e.target.value)}
                placeholder="ex: Refus de réception garage"
                className={inputCls} />
            </div>
          </div>

          {/* Section : Contenu juridique */}
          <div className={sectionCls}>
            <p className={sectionTitleCls}>Contenu juridique (apparaît sur le PDF)</p>
            <div>
              <p className={labelCls}>Titre formel <span className="text-red-400">*</span></p>
              <input value={form.title} onChange={e => f('title')(e.target.value)}
                placeholder="ex: REFUS DE RÉCEPTION D'UN VÉHICULE PAR LE GARAGE"
                className={inputCls + ' font-semibold'} />
            </div>
            <div>
              <p className={labelCls}>Texte juridique <span className="text-red-400">*</span></p>
              <textarea value={form.body} onChange={e => f('body')(e.target.value)} rows={5}
                placeholder="ex: Le client reconnaît…"
                className={inputCls + ' resize-none leading-relaxed'} />
              <p className="text-ink-faint text-[11px] mt-1.5">💡 Double saut de ligne pour séparer les paragraphes</p>
            </div>
            <div>
              <p className={labelCls}>Note bas de page <span className="text-ink-faint font-normal">— optionnel</span></p>
              <input value={form.footnote} onChange={e => f('footnote')(e.target.value)}
                placeholder="ex: Ne pas oublier les photos"
                className={inputCls} />
            </div>
          </div>

          {/* Section : Configuration */}
          <div className={sectionCls}>
            <p className={sectionTitleCls}>Configuration</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className={labelCls}>Couleur</p>
                <select value={form.color} onChange={e => f('color')(e.target.value)} className={inputCls + ' cursor-pointer'}>
                  <option value="red">🔴 Rouge (décharge classique)</option>
                  <option value="green">🟢 Vert (fin d'intervention)</option>
                </select>
              </div>
              <div>
                <p className={labelCls}>Ordre d'affichage</p>
                <input type="number" value={form.sort_order} onChange={e => f('sort_order')(Number(e.target.value))} className={inputCls} />
              </div>
            </div>
            <div>
              <p className={labelCls}>Label personnalisé du champ nom <span className="text-ink-faint font-normal">— optionnel</span></p>
              <input value={form.name_field_label} onChange={e => f('name_field_label')(e.target.value)}
                placeholder="ex: Nom du client réceptionnaire"
                className={inputCls} />
              <p className="text-ink-faint text-[11px] mt-1.5">Par défaut « Nom du signataire »</p>
            </div>
          </div>

          {/* Section : Champs requis du chauffeur */}
          <div className={sectionCls}>
            <p className={sectionTitleCls}>Que doit fournir le chauffeur ?</p>
            <div className="space-y-2.5">
              {requiredFieldRow(
                form.needs_comment, f('needs_comment'),
                'Commentaire',
                'Le chauffeur saisit un texte libre (motif, description…)',
                <input value={form.comment_label} onChange={e => f('comment_label')(e.target.value)}
                  placeholder="Label du commentaire — ex: Description du risque"
                  className={inputCls} />
              )}
              {requiredFieldRow(
                form.needs_photos, f('needs_photos'),
                'Photos',
                'Le chauffeur joint une ou plusieurs photos',
                <input value={form.photos_hint} onChange={e => f('photos_hint')(e.target.value)}
                  placeholder="Hint sur les photos — ex: Photos précises des dommages"
                  className={inputCls} />
              )}
              {requiredFieldRow(
                form.needs_schema, f('needs_schema'),
                'Schéma de dégâts',
                '4 vues voiture annotables au doigt (avant / arrière / gauche / droite)'
              )}
            </div>
          </div>

          {/* Section : Visibilité */}
          <div>
            <p className={sectionTitleCls}>Visibilité</p>
            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${form.active ? 'bg-surface border' : 'bg-surface-hover border-dashed'}`}>
              <input type="checkbox" checked={form.active} onChange={e => f('active')(e.target.checked)} className="sr-only" />
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 transition ${form.active ? 'bg-brand border-brand' : 'bg-surface border-strong'}`}>
                {form.active && <span className="text-white text-xs leading-none">✓</span>}
              </span>
              <span className="flex-1">
                <span className="block text-ink text-sm font-medium">Actif</span>
                <span className="block text-ink-muted text-xs mt-0.5">{form.active ? 'Visible côté chauffeur dans la liste de sélection' : 'Masqué côté chauffeur (existe toujours en base)'}</span>
              </span>
            </label>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-surface-2 rounded-b-2xl">
          {err && <p className="text-red-400 text-xs mb-3">⚠️ {err}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 bg-surface text-ink-secondary rounded-lg text-sm font-medium hover:bg-surface-hover transition">Annuler</button>
            <button onClick={save} disabled={saving || !form.label || !form.title || !form.body || (!initial && !form.key)}
              className="flex-1 py-2.5 bg-brand disabled:opacity-50 hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition">
              {saving ? '⏳ Enregistrement…' : (initial ? '💾 Enregistrer' : '+ Créer le type')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

