'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, X, Edit2, Eye, EyeOff, ChevronRight } from 'lucide-react'

interface Source {
  key:           string
  label:         string
  active:        boolean
  sort_order:    number
  notes:         string | null
  mission_count: number
  has_surcharge: boolean
  default_billed_to_id?:   number | null
  default_billed_to_name?: string | null
  display_color?:          string | null
  group_key?:              string | null
}

// Palette de couleurs Tailwind proposees dans le modal d edition. L admin
// peut aussi taper une classe Tailwind custom dans le champ texte libre.
const COLOR_PALETTE = [
  { value: 'bg-blue-600',    label: 'Bleu' },
  { value: 'bg-blue-900',    label: 'Bleu marine' },
  { value: 'bg-cyan-600',    label: 'Cyan' },
  { value: 'bg-teal-600',    label: 'Teal' },
  { value: 'bg-green-600',   label: 'Vert' },
  { value: 'bg-emerald-600', label: 'Émeraude' },
  { value: 'bg-yellow-600',  label: 'Jaune' },
  { value: 'bg-amber-700',   label: 'Ambre' },
  { value: 'bg-orange-600',  label: 'Orange' },
  { value: 'bg-red-600',     label: 'Rouge' },
  { value: 'bg-rose-600',    label: 'Rose' },
  { value: 'bg-fuchsia-600', label: 'Fuchsia' },
  { value: 'bg-purple-600',  label: 'Violet' },
  { value: 'bg-violet-600',  label: 'Violet clair' },
  { value: 'bg-indigo-600',  label: 'Indigo' },
  { value: 'bg-zinc-700',    label: 'Gris foncé' },
  { value: 'bg-zinc-600',    label: 'Gris (défaut)' },
  { value: 'bg-stone-600',   label: 'Pierre' },
]

export default function SourcesClient({ initial }: { initial: Source[] }) {
  const [sources, setSources] = useState<Source[]>(initial)
  const [editing, setEditing] = useState<Source | null>(null)
  const [adding,  setAdding]  = useState(false)
  const [filter,  setFilter]  = useState('')

  async function refresh() {
    const r = await fetch('/api/admin/sources')
    const j = await r.json()
    setSources(j.sources || [])
  }

  // Tri alphabetique par label (fr, insensible casse/accents), puis filtre
  // texte sur label OU key.
  const filtered = useMemo(() => {
    const sorted = [...sources].sort((a, b) =>
      a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })
    )
    const q = filter.toLowerCase().trim()
    if (!q) return sorted
    return sorted.filter(s =>
      s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)
    )
  }, [sources, filter])

  async function toggleActive(s: Source) {
    const res = await fetch('/api/admin/sources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: s.key, active: !s.active }),
    })
    if (!res.ok) { alert((await res.json()).error || 'Erreur'); return }
    refresh()
  }

  async function deleteSource(s: Source) {
    if (s.mission_count > 0) {
      alert(`Cette source a ${s.mission_count} mission(s) historique(s). Désactive-la plutôt que de la supprimer.`)
      return
    }
    if (!confirm(`Supprimer définitivement "${s.label}" ?`)) return
    const res = await fetch(`/api/admin/sources?key=${encodeURIComponent(s.key)}`, { method: 'DELETE' })
    if (!res.ok) { alert((await res.json()).error || 'Erreur'); return }
    refresh()
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-ink text-xl font-semibold">Sources de mission</h1>
          <p className="text-ink-muted text-sm">Catalogue central des sources (Touring, Allianz, VAB...). Les grilles de majoration et tarifaires futures s'appuient dessus.</p>
        </div>
        <button onClick={() => setAdding(true)}
          className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-medium flex items-center gap-2 transition">
          <Plus size={16} /> Ajouter une source
        </button>
      </div>

      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filtrer..."
        className="w-full sm:max-w-xs bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
      />

      <div className="bg-surface border rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b">
            <tr className="text-ink-muted text-xs uppercase tracking-wide">
              <th className="px-4 py-2 text-left">Libellé</th>
              <th className="px-4 py-2 text-left">Clé</th>
              <th className="px-4 py-2 text-left">Client facturé par défaut</th>
              <th className="px-4 py-2 text-left">Missions</th>
              <th className="px-4 py-2 text-left">Surcharge</th>
              <th className="px-4 py-2 text-left">État</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-ink-muted text-sm">Aucune source.</td></tr>
            ) : filtered.map(s => (
              <tr key={s.key} className={s.active ? '' : 'opacity-50'}>
                <td className="px-4 py-2">
                  <Link href={`/admin/sources/${encodeURIComponent(s.key)}`} className="group inline-flex items-center gap-1 hover:text-brand transition">
                    <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.display_color || 'bg-zinc-600'} mr-2`} title={s.display_color || 'aucune couleur'} />
                    <span className="text-ink font-medium group-hover:text-brand">{s.label}</span>
                    {s.group_key && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-faint font-mono">[{s.group_key}]</span>
                    )}
                    <ChevronRight size={14} className="text-ink-faint group-hover:text-brand opacity-0 group-hover:opacity-100 transition" />
                  </Link>
                  {s.notes && <p className="text-ink-muted text-xs">{s.notes}</p>}
                </td>
                <td className="px-4 py-2"><span className="text-ink-muted text-xs font-mono">{s.key}</span></td>
                <td className="px-4 py-2">
                  {s.default_billed_to_name
                    ? <span className="text-ink text-xs">{s.default_billed_to_name}</span>
                    : <button onClick={() => setEditing(s)} className="text-ink-muted text-xs italic hover:text-brand transition underline-offset-2 hover:underline">
                        — à configurer
                      </button>
                  }
                </td>
                <td className="px-4 py-2">
                  <span className="text-ink-secondary text-xs">{s.mission_count > 0 ? `${s.mission_count} historique${s.mission_count > 1 ? 's' : ''}` : '—'}</span>
                </td>
                <td className="px-4 py-2">
                  {s.has_surcharge
                    ? <span className="text-xs px-2 py-0.5 bg-success-soft text-success rounded">configurée</span>
                    : <a href="/admin/surcharges" className="text-xs text-ink-muted hover:text-brand underline">à configurer</a>
                  }
                </td>
                <td className="px-4 py-2">
                  {s.active
                    ? <span className="text-xs px-2 py-0.5 bg-success-soft text-success rounded">actif</span>
                    : <span className="text-xs px-2 py-0.5 bg-ink-faint/15 text-ink-muted rounded">désactivé</span>
                  }
                </td>
                <td className="px-4 py-2 flex items-center gap-1 justify-end">
                  <button onClick={() => toggleActive(s)} title={s.active ? 'Désactiver' : 'Réactiver'}
                    className="p-1.5 text-ink-faint hover:text-ink transition rounded">
                    {s.active ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button onClick={() => setEditing(s)} title="Modifier"
                    className="p-1.5 text-ink-faint hover:text-brand transition rounded">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => deleteSource(s)} title="Supprimer"
                    disabled={s.mission_count > 0}
                    className="p-1.5 text-ink-faint hover:text-critical disabled:opacity-30 disabled:cursor-not-allowed transition rounded">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <EditModal source={null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh() }} />}
      {editing && <EditModal source={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
    </div>
  )
}

function EditModal({ source, onClose, onSaved }: { source: Source | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !source
  const [label, setLabel] = useState(source?.label || '')
  const [key, setKey]     = useState(source?.key || '')
  const [sortOrder, setSortOrder] = useState(source?.sort_order ?? 100)
  const [notes, setNotes] = useState(source?.notes || '')
  const [defaultBilledId,   setDefaultBilledId]   = useState<number | null>(source?.default_billed_to_id   || null)
  const [defaultBilledName, setDefaultBilledName] = useState<string>(source?.default_billed_to_name || '')
  const [displayColor, setDisplayColor] = useState<string>(source?.display_color || '')
  const [groupKey,     setGroupKey]     = useState<string>(source?.group_key     || '')
  const [clientQuery, setClientQuery] = useState('')
  const [clientResults, setClientResults] = useState<Array<{ id: number; name: string }>>([])
  const [clientSearching, setClientSearching] = useState(false)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const autoKey = (key || label).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

  async function searchClient() {
    if (clientQuery.trim().length < 3) { setClientResults([]); return }
    setClientSearching(true)
    try {
      const data = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(clientQuery)}`).then(r => r.json())
      setClientResults((data.clients || data || []).slice(0, 8))
    } catch {
      setClientResults([])
    } finally {
      setClientSearching(false)
    }
  }

  function selectClient(c: { id: number; name: string }) {
    setDefaultBilledId(c.id)
    setDefaultBilledName(c.name)
    setShowClientDrop(false)
    setClientQuery('')
    setClientResults([])
  }

  function clearClient() {
    setDefaultBilledId(null)
    setDefaultBilledName('')
  }

  async function save() {
    if (!label.trim()) { setError('Libellé requis'); return }
    setSaving(true); setError(null)
    try {
      const url    = '/api/admin/sources'
      const method = isNew ? 'POST' : 'PATCH'
      const common = {
        label:                  label.trim(),
        sort_order:             sortOrder,
        notes:                  notes.trim() || null,
        default_billed_to_id:   defaultBilledId,
        default_billed_to_name: defaultBilledName || null,
        display_color:          displayColor.trim() || null,
        group_key:              groupKey.trim() || null,
      }
      const body = isNew
        ? { key: autoKey, ...common }
        : { key: source!.key, ...common }
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Erreur'); return }
      onSaved()
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-ink font-semibold">{isNew ? 'Ajouter une source' : 'Modifier la source'}</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={20} /></button>
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-1">Libellé</label>
          <input value={label} onChange={e => { setLabel(e.target.value); setError(null) }}
            placeholder="Ex: Touring"
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
        </div>

        {isNew && (
          <div>
            <label className="block text-ink-muted text-xs mb-1">Clé technique (optionnel)</label>
            <input value={key} onChange={e => setKey(e.target.value)}
              placeholder={autoKey || 'auto-générée depuis le libellé'}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-brand" />
            <p className="text-ink-muted text-xs mt-1">
              Doit matcher la valeur dans <span className="font-mono">incoming_missions.source</span>. Auto-générée : <span className="font-mono text-ink-secondary">{autoKey || '—'}</span>
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-ink-muted text-xs mb-1">Ordre d'affichage</label>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value) || 100)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-brand" />
          </div>
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-1">Client à facturer par défaut (optionnel)</label>
          <p className="text-ink-faint text-[11px] mb-2">
            Si défini, les missions de cette source seront pré-remplies avec ce client. Le dispatcher peut toujours le modifier.
          </p>
          {defaultBilledId ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-success-soft border border-success/30 rounded-xl">
              <span className="text-success text-xs flex-1 truncate">✓ {defaultBilledName}</span>
              <button onClick={clearClient} type="button"
                className="text-ink-muted hover:text-critical text-xs">✕ retirer</button>
            </div>
          ) : (
            <div className="relative">
              <input value={clientQuery}
                onChange={e => { setClientQuery(e.target.value); setShowClientDrop(true) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchClient() } }}
                onFocus={() => setShowClientDrop(true)}
                onBlur={() => setTimeout(() => setShowClientDrop(false), 200)}
                placeholder="Rechercher un client Odoo (min 3 char + Enter)..."
                className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
              {showClientDrop && clientResults.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                  {clientResults.map(c => (
                    <button key={c.id} type="button"
                      onMouseDown={() => selectClient(c)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-hover text-ink text-sm border-b last:border-b-0">
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {clientSearching && (
                <p className="text-ink-faint text-xs mt-1">⏳ Recherche…</p>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-1">Couleur du badge</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {COLOR_PALETTE.map(c => (
              <button key={c.value} type="button"
                onClick={() => setDisplayColor(c.value)}
                title={`${c.label} — ${c.value}`}
                className={`w-7 h-7 rounded-md ${c.value} ${displayColor === c.value ? 'ring-2 ring-offset-2 ring-brand' : 'opacity-70 hover:opacity-100'} transition`}
              />
            ))}
            {displayColor && (
              <button type="button" onClick={() => setDisplayColor('')}
                className="text-ink-muted hover:text-critical text-xs px-2">✕ effacer</button>
            )}
          </div>
          <input value={displayColor} onChange={e => setDisplayColor(e.target.value)}
            placeholder="bg-blue-600 (classe Tailwind)"
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-brand" />
          {displayColor && (
            <div className="mt-2 flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${displayColor}`}>{label || 'Aperçu'}</span>
              <span className="text-ink-faint text-xs">aperçu badge</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-1">Groupe UI (optionnel)</label>
          <input value={groupKey} onChange={e => setGroupKey(e.target.value)}
            placeholder="ex: police (regroupe les sources sous un meta-choix dans /dispatch/new)"
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-brand" />
          <p className="text-ink-faint text-[11px] mt-1">
            Sources avec le même groupe sont regroupées sous un menu unique. Laisser vide pour une source autonome.
          </p>
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-1">Notes (optionnel)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Contrat signé le..., contact..., etc."
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand resize-none" />
        </div>

        {error && <div className="bg-critical-soft border border-critical rounded-lg p-2 text-critical text-xs">⚠ {error}</div>}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition">
            Annuler
          </button>
          <button onClick={save} disabled={saving || !label.trim()}
            className="flex-1 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
            {saving ? '⏳…' : isNew ? 'Créer' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
