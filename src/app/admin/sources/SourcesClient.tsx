'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, X, Edit2, Eye, EyeOff, ChevronRight, Search, AlertTriangle } from 'lucide-react'
import BandeauChiffres from '@/components/admin/BandeauChiffres'
import { parcZoneLabel } from '@/lib/parc/zone-label'

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
  accident_billed_to_id?:   number | null
  accident_billed_to_name?: string | null
  default_depot_id?:       string | null
  default_depot_name?:     string | null
  default_parc_zone_key?:  string | null
  display_color?:          string | null
  group_key?:              string | null
  skip_facturation?:       boolean | null
}

interface Depot { id: string; name: string }
interface Zone  { key: string; label: string; depot_id: string | null }

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

export default function SourcesClient({ initial, depots = [], zones = [] }: { initial: Source[]; depots?: Depot[]; zones?: Zone[] }) {
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

  // Habillage en cartes (Olivier 11/11/2026, maquette validée) : une carte par source,
  // ce qui reste à configurer en orange.
  const aConfigurer = (s: Source) => !s.default_billed_to_name || !s.default_depot_name
  const actives = sources.filter(s => s.active)
  return (
    <div className="px-4 py-4 lg:px-0 space-y-4 max-w-[1800px]">
      <BandeauChiffres chiffres={[
        { label: 'Actives', valeur: actives.length },
        { label: 'À configurer', valeur: actives.filter(aConfigurer).length },
        { label: 'Sans majoration', valeur: actives.filter(s => !s.has_surcharge).length },
      ]} />
      <h1 className="text-ink text-xl font-semibold">Sources de mission</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Chercher une source…" aria-label="Chercher une source"
            className="w-full min-h-[46px] pl-10 pr-4 rounded-2xl bg-surface border border-strong text-ink text-sm outline-none focus:border-sky-500" />
        </div>
        <button onClick={() => setAdding(true)}
          className="lg:ml-auto inline-flex items-center gap-1.5 min-h-[46px] px-4 rounded-2xl text-white text-sm font-bold bg-gradient-to-br from-sky-500 to-blue-600 shadow-md shadow-blue-500/30 hover:brightness-105">
          <Plus size={18} /> Ajouter une source
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-ink-muted text-sm text-center py-10">{filter.trim() ? `Aucune source ne correspond à « ${filter.trim()} ».` : 'Aucune source.'}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {filtered.map(s => {
            const manque = aConfigurer(s)
            return (
              <section key={s.key} className={`bg-surface border rounded-3xl shadow-card p-4 flex flex-col ${manque && s.active ? 'border-amber-300' : 'border-strong'} ${s.active ? '' : 'opacity-60'}`}>
                <header className="flex items-start gap-3">
                  <span className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-md ${s.display_color || 'bg-stone-500'}`}>
                    {(s.label.match(/\p{L}/u)?.[0] || '?').toUpperCase()}
                  </span>
                  <Link href={`/admin/sources/${encodeURIComponent(s.key)}`} className="group flex-1 min-w-0">
                    <span className="flex items-center gap-1 font-display text-ink font-bold text-lg leading-tight group-hover:text-sky-700">
                      <span className="truncate">{s.label}</span><ChevronRight size={16} className="flex-shrink-0 text-ink-faint group-hover:text-sky-700" />
                    </span>
                    <span className="block text-ink-muted text-xs">
                      {s.mission_count > 0 ? `${s.mission_count} mission${s.mission_count > 1 ? 's' : ''}` : 'Aucune mission'}
                      {s.group_key ? ` · groupe ${s.group_key}` : ''}
                    </span>
                  </Link>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${s.active ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
                    {s.active ? 'Active' : 'Désactivée'}
                  </span>
                </header>
                {s.notes && <p className="text-ink-muted text-xs mt-2">{s.notes}</p>}

                <dl className="mt-3 divide-y divide-[var(--border-default,rgba(0,0,0,0.08))] text-sm">
                  {[
                    ['Client facturé', s.default_billed_to_name],
                    ['Parc par défaut', s.default_depot_name ? `${s.default_depot_name}${s.default_parc_zone_key ? ` · zone ${parcZoneLabel(s.default_parc_zone_key)}` : ''}` : null],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex items-center justify-between gap-3 min-h-[44px]">
                      <dt className="text-ink-muted">{k}</dt>
                      {v ? <dd className="text-ink font-medium text-right truncate">{v}</dd> : (
                        <button onClick={() => setEditing(s)} className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-full bg-amber-100 text-amber-900 text-xs font-bold hover:bg-amber-200">
                          <AlertTriangle size={13} /> À configurer
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 min-h-[44px]">
                    <dt className="text-ink-muted">Majorations</dt>
                    {s.has_surcharge
                      ? <dd className="text-emerald-700 font-medium">Configurées</dd>
                      : <Link href="/admin/surcharges" className="inline-flex items-center min-h-[36px] px-3 rounded-full bg-stone-100 text-stone-700 text-xs font-bold hover:bg-stone-200">À configurer</Link>}
                  </div>
                </dl>

                <div className="mt-auto pt-3 flex items-center justify-end gap-1 border-t border-strong">
                  <button onClick={() => toggleActive(s)} title={s.active ? 'Désactiver' : 'Réactiver'} aria-label={s.active ? 'Désactiver' : 'Réactiver'}
                    className="w-11 h-11 flex items-center justify-center rounded-xl text-ink-faint hover:text-ink hover:bg-surface-hover">
                    {s.active ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <button onClick={() => deleteSource(s)} title="Supprimer" aria-label="Supprimer" disabled={s.mission_count > 0}
                    className="w-11 h-11 flex items-center justify-center rounded-xl text-ink-faint hover:text-red-700 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed">
                    <Trash2 size={18} />
                  </button>
                  <button onClick={() => setEditing(s)}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-surface-hover text-ink text-sm font-semibold hover:bg-sky-50 hover:text-sky-800">
                    <Edit2 size={16} /> Modifier
                  </button>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {adding && <EditModal source={null} depots={depots} zones={zones} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh() }} />}
      {editing && <EditModal source={editing} depots={depots} zones={zones} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
    </div>
  )
}

function EditModal({ source, depots, zones, onClose, onSaved }: { source: Source | null; depots: Depot[]; zones: Zone[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !source
  const [label, setLabel] = useState(source?.label || '')
  const [key, setKey]     = useState(source?.key || '')
  const [sortOrder, setSortOrder] = useState(source?.sort_order ?? 100)
  const [notes, setNotes] = useState(source?.notes || '')
  const [defaultBilledId,   setDefaultBilledId]   = useState<number | null>(source?.default_billed_to_id   || null)
  const [defaultBilledName, setDefaultBilledName] = useState<string>(source?.default_billed_to_name || '')
  // Client facturable propre aux accidents police (AXA, Ardenne → « Autres »).
  const [accidentBilled, setAccidentBilled] = useState<{ id: number; name: string } | null>(source?.accident_billed_to_id ? { id: source.accident_billed_to_id, name: source.accident_billed_to_name || String(source.accident_billed_to_id) } : null)
  const [defaultDepotId,    setDefaultDepotId]    = useState<string>(source?.default_depot_id || '')
  const [defaultZoneKey,    setDefaultZoneKey]    = useState<string>(source?.default_parc_zone_key || '')
  const [displayColor, setDisplayColor] = useState<string>(source?.display_color || '')
  const [groupKey,     setGroupKey]     = useState<string>(source?.group_key     || '')
  const [skipFacturation, setSkipFacturation] = useState<boolean>(!!source?.skip_facturation)
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
        accident_billed_to_id:   accidentBilled?.id ?? null,
        accident_billed_to_name: accidentBilled?.name ?? null,
        default_depot_id:       defaultDepotId || null,
        default_depot_name:     defaultDepotId ? (depots.find(d => d.id === defaultDepotId)?.name || null) : null,
        default_parc_zone_key:  defaultZoneKey || null,
        display_color:          displayColor.trim() || null,
        group_key:              groupKey.trim() || null,
        skip_facturation:       skipFacturation,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
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
          <label className="block text-ink-muted text-xs mb-1">Client à facturer pour un accident police (optionnel)</label>
          <p className="text-ink-faint text-[11px] mb-2">
            Quand un véhicule d'un appel police accident part en dossier chez cette assistance, c'est ce client qui est facturé. Vide : le client par défaut ci-dessus.
          </p>
          <OdooClientPick value={accidentBilled} onChange={setAccidentBilled} />
        </div>

        <div>
          <label className="block text-ink-muted text-xs mb-1">Parc par défaut (mise en parc)</label>
          <p className="text-ink-faint text-[11px] mb-2">
            Si défini, la mise en parc d'un véhicule de cette source pré-sélectionne ce dépôt. Le dispatcher/chauffeur peut toujours en choisir un autre.
          </p>
          <select value={defaultDepotId} onChange={e => {
              const newDepot = e.target.value
              setDefaultDepotId(newDepot)
              // Reset la zone si elle n'appartient plus au dépôt choisi.
              if (defaultZoneKey) {
                const z = zones.find(z => z.key === defaultZoneKey)
                if (newDepot && z && z.depot_id && z.depot_id !== newDepot) setDefaultZoneKey('')
              }
            }}
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand">
            <option value="">— Aucun (choix manuel à chaque fois)</option>
            {depots.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          {/* Zone par défaut : filtrée sur le dépôt choisi (sinon toutes). */}
          <label className="block text-ink-muted text-xs mb-1 mt-3">Zone par défaut dans ce parc</label>
          <select value={defaultZoneKey} onChange={e => setDefaultZoneKey(e.target.value)}
            disabled={!defaultDepotId}
            className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand disabled:opacity-50">
            <option value="">— Aucune (choix manuel à chaque fois)</option>
            {zones
              .filter(z => !defaultDepotId || !z.depot_id || z.depot_id === defaultDepotId)
              .map(z => (
                <option key={z.key} value={z.key}>{parcZoneLabel(z.key)}</option>
              ))}
          </select>
          {!defaultDepotId && (
            <p className="text-ink-faint text-[11px] mt-1">Choisis d'abord un parc pour pouvoir fixer une zone.</p>
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

        <button type="button" onClick={() => setSkipFacturation(v => !v)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition ${
            skipFacturation ? 'bg-amber-50 border-amber-400' : 'bg-surface-2 border'
          }`}>
          <span className={`w-5 h-5 rounded flex items-center justify-center text-white text-xs flex-shrink-0 ${skipFacturation ? 'bg-amber-600' : 'bg-ink-faint'}`}>
            {skipFacturation ? '✓' : ''}
          </span>
          <span>
            <span className="block text-ink text-sm font-medium">Sans facturation (transport interne)</span>
            <span className="block text-ink-muted text-xs">La mission clôturée par le chauffeur est archivée directement, sans passer par /facturation.</span>
          </span>
        </button>

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


// Choix d'un client dans la liste des clients (recherche au clavier, Entrée).
function OdooClientPick({ value, onChange }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: number; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const search = async () => {
    if (q.trim().length < 3) { setResults([]); return }
    setBusy(true)
    try { const d = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(q)}`).then(r => r.json()); setResults((d.clients || d || []).slice(0, 8)) }
    catch { setResults([]) } finally { setBusy(false) }
  }
  if (value) return (
    <div className="flex items-center gap-2 px-3 py-2 bg-success-soft border border-success/30 rounded-xl">
      <span className="text-success text-xs flex-1 truncate">✓ {value.name} <span className="text-ink-muted">(n° {value.id})</span></span>
      <button onClick={() => onChange(null)} type="button" className="text-ink-muted hover:text-critical text-xs">✕ retirer</button>
    </div>
  )
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
        placeholder="Rechercher un client (3 lettres + Entrée)…"
        className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
      {busy && <p className="text-ink-faint text-xs mt-1">Recherche…</p>}
      {results.length > 0 && <div className="mt-1 bg-surface border rounded-xl overflow-hidden max-h-56 overflow-y-auto">
        {results.map(c => <button key={c.id} type="button" onClick={() => { onChange(c); setQ(''); setResults([]) }} className="w-full text-left px-3 py-2 hover:bg-surface-hover text-ink text-sm border-b last:border-b-0">{c.name} <span className="text-ink-muted text-xs">n° {c.id}</span></button>)}
      </div>}
    </div>
  )
}
