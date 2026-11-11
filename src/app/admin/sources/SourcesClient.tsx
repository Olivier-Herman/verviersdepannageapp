'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, X, Edit2, Eye, EyeOff, ChevronRight, Search, AlertTriangle } from 'lucide-react'
import BandeauChiffres from '@/components/admin/BandeauChiffres'
import { Fenetre, BoutonsPied, Etape, ChampTexte, ChampNombre, ChampListe, ChampTexteLong, Interrupteur, Note } from '@/components/admin/Fenetre'
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

  // Fenêtre au modèle commun des écrans de Réglages (Olivier 11/11/2026, maquette validée).
  return (
    <Fenetre titre={isNew ? 'Nouvelle source' : 'Modifier la source'} sousTitre={isNew ? 'Quatre étapes, de haut en bas' : label}
      couleur="info" icone={isNew ? <Plus size={26} /> : <Edit2 size={22} />} onClose={onClose}
      pied={<BoutonsPied couleur="info" onAnnuler={onClose} onValider={save} enCours={saving} desactive={!label.trim()} libelle={isNew ? 'Créer la source' : 'Enregistrer'} />}>

      <Etape n={1} titre="La source">
        <ChampTexte grand label="Nom affiché" placeholder="Ex. : Touring" valeur={label} onChange={v => { setLabel(v); setError(null) }} />
        {isNew && (
          <ChampTexte label="Code interne (facultatif)" placeholder={autoKey || 'créé à partir du nom'} valeur={key} onChange={setKey}
            aide={`Doit correspondre au code des missions de cette source. Proposé : ${autoKey || '—'}`} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <ChampNombre label="Ordre dans les listes" valeur={sortOrder} onChange={v => setSortOrder(v ?? 100)} />
          <div className="flex items-center gap-3 rounded-2xl bg-surface-hover/60 border border-strong px-4">
            <span className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow-md ${displayColor || 'bg-stone-500'}`}>{(label.match(/\p{L}/u)?.[0] || '?').toUpperCase()}</span>
            <span className="text-ink-muted text-sm">Aperçu</span>
          </div>
        </div>
        <div>
          <span className="block text-ink-muted text-sm mb-1.5">Couleur</span>
          <div className="flex flex-wrap gap-2">
            {COLOR_PALETTE.map(c => (
              <button key={c.value} type="button" onClick={() => setDisplayColor(c.value)} title={c.label} aria-label={c.label}
                className={`w-11 h-11 rounded-2xl ${c.value} transition ${displayColor === c.value ? 'ring-4 ring-offset-2 ring-sky-400' : 'opacity-75 hover:opacity-100'}`} />
            ))}
            {displayColor && <button type="button" onClick={() => setDisplayColor('')} className="min-h-[44px] px-3 text-sm text-ink-muted hover:text-ink">Sans couleur</button>}
          </div>
        </div>
      </Etape>

      <Etape n={2} titre="Facturation">
        <div>
          <span className="block text-ink-muted text-sm mb-1.5">Client facturé par défaut</span>
          {defaultBilledId ? (
            <div className="flex items-center gap-2 min-h-[52px] px-4 rounded-2xl bg-emerald-50 border border-emerald-200">
              <span className="text-emerald-800 font-semibold flex-1 truncate">✓ {defaultBilledName}</span>
              <button onClick={clearClient} type="button" className="min-h-[44px] px-3 text-sm text-ink-muted hover:text-red-700">Retirer</button>
            </div>
          ) : (
            <div className="relative">
              <input value={clientQuery}
                onChange={e => { setClientQuery(e.target.value); setShowClientDrop(true) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchClient() } }}
                onFocus={() => setShowClientDrop(true)}
                onBlur={() => setTimeout(() => setShowClientDrop(false), 200)}
                placeholder="Chercher un client (3 lettres puis Entrée)…"
                className="w-full min-h-[52px] rounded-2xl bg-surface-hover/60 border border-strong px-4 text-ink text-base outline-none focus:border-ink-faint placeholder:text-ink-faint" />
              {showClientDrop && clientResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface border border-strong rounded-2xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                  {clientResults.map(c => (
                    <button key={c.id} type="button" onMouseDown={() => selectClient(c)}
                      className="w-full text-left min-h-[48px] px-4 hover:bg-surface-hover text-ink border-b border-strong last:border-b-0">{c.name}</button>
                  ))}
                </div>
              )}
              {clientSearching && <p className="text-ink-muted text-sm mt-1.5 px-1">Recherche…</p>}
            </div>
          )}
          <p className="text-ink-muted text-sm mt-1.5 px-1">Pré-rempli sur les missions de cette source ; le dispatch peut le changer.</p>
        </div>
        <div>
          <span className="block text-ink-muted text-sm mb-1.5">Client facturé pour un accident police</span>
          <OdooClientPick value={accidentBilled} onChange={setAccidentBilled} />
          <p className="text-ink-muted text-sm mt-1.5 px-1">Vide : le client par défaut ci-dessus.</p>
        </div>
        <Interrupteur label="Sans facturation (transport interne)" aide="La mission clôturée est archivée directement, sans passer par la facturation."
          valeur={skipFacturation} onChange={setSkipFacturation} />
      </Etape>

      <Etape n={3} titre="Mise en parc">
        <div className="grid sm:grid-cols-2 gap-3">
          <ChampListe label="Parc par défaut" valeur={defaultDepotId}
            options={[{ value: '', label: 'Aucun : choisi à chaque fois' }, ...depots.map(d => ({ value: d.id, label: d.name }))]}
            onChange={nouveau => {
              setDefaultDepotId(nouveau)
              // La zone ne suit pas un changement de parc qu'elle ne couvre pas.
              if (defaultZoneKey) {
                const z = zones.find(z => z.key === defaultZoneKey)
                if (nouveau && z && z.depot_id && z.depot_id !== nouveau) setDefaultZoneKey('')
              }
            }} />
          {defaultDepotId ? (
            <ChampListe label="Zone par défaut" valeur={defaultZoneKey}
              options={[{ value: '', label: 'Aucune : choisie à chaque fois' }, ...zones.filter(z => !z.depot_id || z.depot_id === defaultDepotId).map(z => ({ value: z.key, label: parcZoneLabel(z.key) }))]}
              onChange={setDefaultZoneKey} />
          ) : <p className="text-ink-muted text-sm self-end pb-3 px-1">Choisissez d’abord un parc pour fixer une zone.</p>}
        </div>
      </Etape>

      <Etape n={4} titre="Regroupement et notes">
        <ChampTexte label="Groupe dans « Nouvelle mission » (facultatif)" placeholder="Ex. : police" valeur={groupKey} onChange={setGroupKey}
          aide="Les sources d’un même groupe sont proposées sous un seul choix. Vide : source à part." />
        <ChampTexteLong label="Notes" placeholder="Contrat signé le…, contact…" lignes={2} valeur={notes} onChange={setNotes} />
      </Etape>

      {error && <Note ton="attention">{error}</Note>}
    </Fenetre>
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
    <div className="flex items-center gap-2 min-h-[52px] px-4 rounded-2xl bg-emerald-50 border border-emerald-200">
      <span className="text-emerald-800 font-semibold flex-1 truncate">✓ {value.name}</span>
      <button onClick={() => onChange(null)} type="button" className="min-h-[44px] px-3 text-sm text-ink-muted hover:text-red-700">Retirer</button>
    </div>
  )
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
        placeholder="Chercher un client (3 lettres puis Entrée)…"
        className="w-full min-h-[52px] rounded-2xl bg-surface-hover/60 border border-strong px-4 text-ink text-base outline-none focus:border-ink-faint placeholder:text-ink-faint" />
      {busy && <p className="text-ink-faint text-xs mt-1">Recherche…</p>}
      {results.length > 0 && <div className="mt-1 bg-surface border border-strong rounded-2xl overflow-hidden max-h-56 overflow-y-auto">
        {results.map(c => <button key={c.id} type="button" onClick={() => { onChange(c); setQ(''); setResults([]) }} className="w-full text-left min-h-[48px] px-4 hover:bg-surface-hover text-ink border-b border-strong last:border-b-0">{c.name}</button>)}
      </div>}
    </div>
  )
}
