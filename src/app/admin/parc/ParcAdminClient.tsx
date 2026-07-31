'use client'
// src/app/admin/parc/ParcAdminClient.tsx
//
// UI admin : configurer les lignes du parc fourriere par zone.
// - Liste les zones (figees, defile par sort_order)
// - Pour chaque zone : ses lignes (A1, A2, ...) avec capacite editable
// - + Ajouter ligne / supprimer ligne (refus si vehicules dessus)

import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, Check, X, GripVertical, ArrowLeftRight, RotateCw, Lock, Unlock, Grid3x3, Shuffle, Truck, EyeOff, Eye, PowerOff, Power } from 'lucide-react'

interface Zone {
  key:             string
  label:           string
  active:          boolean
  sort_order:      number
  slot_direction:  'ltr' | 'rtl'
  row_layout:      'horizontal' | 'vertical'
  strict_capacity: boolean
  is_pool:         boolean
  pool_capacity:   number | null
  depot_id:        string | null
  driver_allowed:  boolean
  zone_type:       string | null
}

// Types de parc (regroupement organisationnel). Olivier 2026-06-22.
const ZONE_TYPE_ORDER = ['relivraison', 'accident', 'saisie', ''] as const
const ZONE_TYPE_LABEL: Record<string, string> = {
  relivraison: '🔁 Relivraison',
  accident:    '🚗 Accident',
  saisie:      '🚓 Saisie',
  '':          '— Non classé',
}

interface Depot {
  id:               string
  name:             string
  sort_order:       number | null
  active:           boolean
  is_default_parc:  boolean
}

interface Row {
  id:          number
  zone_key:    string
  row_number:  number
  capacity:    number
  sort_order:  number
}

export default function ParcAdminClient({ initialZones, initialRows, initialDepots, initialCanvasHeight, initialVilleDestructionEmail }: {
  initialZones:                 Zone[]
  initialRows:                  Row[]
  initialDepots:                Depot[]
  initialCanvasHeight:          number
  initialVilleDestructionEmail: string | null
}) {
  const [zones, setZones] = useState<Zone[]>(initialZones)
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [depots] = useState<Depot[]>(initialDepots)
  const [busy, setBusy] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [canvasHeight, setCanvasHeight] = useState(initialCanvasHeight)
  const [canvasInput, setCanvasInput]   = useState(String(initialCanvasHeight))
  const [villeEmail, setVilleEmail]     = useState(initialVilleDestructionEmail || '')
  const [villeEmailSaving, setVilleEmailSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function toggleZoneActive(zone: Zone) {
    if (zone.active) {
      // Soft-delete via DELETE
      if (!confirm(`Désactiver la zone ${zone.label} ?\n\nLes véhicules actuellement parkés doivent d'abord être transférés.\nLa zone reste en BDD pour l'historique mais disparait des sélecteurs.`)) return
      setBusy(true)
      try {
        const r = await fetch(`/api/admin/parc/zones/${encodeURIComponent(zone.key)}`, { method: 'DELETE' })
        const j = await r.json()
        if (!r.ok) { alert(`Erreur : ${j.error || r.status}`); return }
        setZones(zs => zs.map(z => z.key === zone.key ? { ...z, active: false } : z))
      } catch (e: any) { alert(`Erreur : ${e?.message || e}`) }
      finally { setBusy(false) }
    } else {
      // Reactivation via PATCH
      await toggleZoneOption(zone.key, { active: true })
    }
  }

  async function createZone(payload: Partial<Zone> & { key: string }) {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/parc/zones', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || r.status}`); return false }
      setZones(zs => [...zs, j.zone].sort((a, b) => a.sort_order - b.sort_order))
      return true
    } catch (e: any) {
      alert(`Erreur : ${e?.message || e}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function toggleZoneOption(zoneKey: string, patch: Partial<Pick<Zone, 'slot_direction' | 'row_layout' | 'strict_capacity' | 'is_pool' | 'pool_capacity' | 'depot_id' | 'driver_allowed' | 'active' | 'label' | 'zone_type'>>) {
    setBusy(true)
    setZones(zs => zs.map(z => z.key === zoneKey ? { ...z, ...patch } : z))
    try {
      const res = await fetch(`/api/admin/parc/zones/${encodeURIComponent(zoneKey)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
      // rollback
      setZones(initialZones.map(z => ({ ...z })))
    } finally {
      setBusy(false)
    }
  }

  async function handleReorderDragEnd(zoneKey: string, ev: DragEndEvent) {
    const { active, over } = ev
    if (!over || active.id === over.id) return
    const zRows = rowsOf(zoneKey)
    const oldIdx = zRows.findIndex(r => r.id === Number(active.id))
    const newIdx = zRows.findIndex(r => r.id === Number(over.id))
    if (oldIdx < 0 || newIdx < 0) return

    // Reordonner localement et renumeroter row_number
    const reordered = [...zRows]
    const [moved] = reordered.splice(oldIdx, 1)
    reordered.splice(newIdx, 0, moved)
    const orderedIds = reordered.map(r => r.id)

    // Update local state : on ne touche QUE sort_order (row_number reste fige)
    setRows(prev => {
      const others = prev.filter(r => r.zone_key !== zoneKey)
      const resorted = reordered.map((r, i) => ({ ...r, sort_order: i + 1 }))
      return [...others, ...resorted]
    })

    setBusy(true)
    try {
      const res = await fetch('/api/admin/parc/rows/reorder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zoneKey, ordered_ids: orderedIds }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
      setRows(initialRows.map(r => ({ ...r })))
    } finally {
      setBusy(false)
    }
  }

  async function saveVilleEmail() {
    const email = villeEmail.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Email invalide')
      return
    }
    setVilleEmailSaving(true)
    try {
      const res = await fetch('/api/admin/parc/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ville_destruction_email: email }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setVilleEmailSaving(false)
    }
  }

  async function saveCanvasHeight() {
    const n = parseInt(canvasInput, 10)
    if (!Number.isInteger(n) || n < 400 || n > 8000) {
      alert('Hauteur invalide (entre 400 et 8000 px)')
      return
    }
    if (n === canvasHeight) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/parc/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ canvas_height_px: n }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setCanvasHeight(n)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
      setCanvasInput(String(canvasHeight))
    } finally {
      setBusy(false)
    }
  }

  function rowsOf(zoneKey: string): Row[] {
    return rows.filter(r => r.zone_key === zoneKey)
      .sort((a, b) => (a.sort_order || a.row_number) - (b.sort_order || b.row_number))
  }

  async function addRow(zoneKey: string) {
    const capStr = prompt(`Capacité de la nouvelle ligne dans ${zoneKey} ?`, '5')
    if (!capStr) return
    const capacity = parseInt(capStr, 10)
    if (!Number.isInteger(capacity) || capacity <= 0) {
      alert('Capacité invalide (entier > 0)')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/parc/rows', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zoneKey, capacity }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setRows(r => [...r, j.row])
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function updateCapacity(row: Row, newCapacity: number) {
    if (newCapacity === row.capacity) return
    if (!Number.isInteger(newCapacity) || newCapacity <= 0) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/parc/rows/${row.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ capacity: newCapacity }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setRows(r => r.map(x => x.id === row.id ? j.row : x))
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function deleteRow(row: Row) {
    if (!confirm(`Supprimer la ligne ${row.zone_key}${row.row_number} ?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/parc/rows/${row.id}`, { method: 'DELETE' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setRows(r => r.filter(x => x.id !== row.id))
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-ink font-bold text-xl">Configuration du parc</h1>
        <p className="text-ink-muted text-sm mt-1">
          Les zones sont figées. Pour chaque zone, configure les lignes (auto-numérotées) et leur capacité.
          Capacité = nombre de places affichées ; l&apos;overflow (+N) est accepté avec un warning visuel.
        </p>
      </div>

      {/* Préparer inventaire complet : bulk sync Odoo + canonicalize + reset placements */}
      <PrepareFullInventoryBlock />

      {/* Enrichir manquants : batch TowSoft pour les missions encore en source=legacy_odoo */}
      <EnrichBatchBlock />

      {/* Refresh dates : sync rapide depuis Odoo create_date (sans Browserless) */}
      <RefreshDatesBlock />

      {/* Settings destruction AVP : email destinataire Ville de Verviers */}
      <div className="bg-surface-2 border rounded-2xl p-4">
        <h2 className="text-ink font-semibold text-sm mb-2 flex items-center gap-2">
          🗑️ Destruction AVP
        </h2>
        <p className="text-ink-muted text-xs mb-3">
          Email destinataire du rapport mensuel d&apos;envoi en destruction (accord Ville de Verviers).
          Utilisé par <a href="/fourriere/destruction" className="underline">/fourriere/destruction</a> pour envoyer la liste des AVP &gt; 60 jours.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={villeEmail}
            onChange={e => setVilleEmail(e.target.value)}
            onBlur={saveVilleEmail}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            disabled={villeEmailSaving}
            placeholder="fourriere@ville-verviers.be"
            className="flex-1 max-w-md bg-surface border rounded px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
          />
          {villeEmailSaving && <span className="text-xs text-ink-muted">Enregistrement…</span>}
        </div>
      </div>

      {/* Canvas size config */}
      <div className="bg-surface-2 border rounded-2xl p-4">
        <h2 className="text-ink font-semibold text-sm mb-2">Dimensions du plan</h2>
        <p className="text-ink-muted text-xs mb-3">
          La largeur du canvas s&apos;adapte automatiquement à l&apos;écran. La hauteur (en pixels) permet d&apos;allonger le plan
          verticalement si ton parking est long (ex : 50 rangées → 2400-3000px).
        </p>
        <div className="flex items-center gap-2">
          <label className="text-ink-muted text-xs">Hauteur du canvas (px)</label>
          <input
            type="number" min={400} max={8000} step={100}
            value={canvasInput}
            onChange={e => setCanvasInput(e.target.value)}
            onBlur={saveCanvasHeight}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            disabled={busy}
            className="w-24 bg-surface border rounded px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
          />
          <span className="text-ink-faint text-xs">actuelle : {canvasHeight}px</span>
        </div>
      </div>

      {/* Barre d actions zones — Olivier 2026-06-04 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setCreateModalOpen(true)}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
        >
          <Plus size={14} /> Nouvelle zone
        </button>
        <button
          onClick={() => setShowInactive(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-semibold transition ${
            showInactive ? 'bg-warning/15 border-warning/40 text-warning' : 'bg-surface-2 text-ink-muted hover:text-ink'
          }`}
        >
          {showInactive ? <Eye size={12} /> : <EyeOff size={12} />}
          {showInactive ? 'Masquer désactivées' : 'Afficher désactivées'}
        </button>
        <span className="text-xs text-ink-muted">
          {zones.filter(z => z.active).length} active{zones.filter(z => z.active).length > 1 ? 's' : ''}
          {showInactive && ` · ${zones.filter(z => !z.active).length} désactivée${zones.filter(z => !z.active).length > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Olivier 2026-06-22 : zones regroupées par TYPE de parc (organisation). */}
      {ZONE_TYPE_ORDER.map(zt => {
        const zonesOfType = zones.filter(z => (showInactive || z.active) && (z.zone_type || '') === zt)
        if (zonesOfType.length === 0) return null
        return (
        <div key={`zt-${zt}`} className="mb-6">
          <h2 className="text-ink-muted text-xs font-bold uppercase tracking-wide mb-2 border-b pb-1">
            {ZONE_TYPE_LABEL[zt]} <span className="text-ink-faint font-normal">· {zonesOfType.length} zone{zonesOfType.length > 1 ? 's' : ''}</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {zonesOfType.map(zone => {
          const zRows = rowsOf(zone.key)
          return (
            <div key={zone.key} className={`bg-surface-2 border rounded-2xl overflow-hidden transition ${!zone.active ? 'opacity-50' : ''}`}>
              <div className="px-4 py-3 border-b bg-surface space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-ink font-bold text-base flex items-center gap-2">
                    Zone {zone.label}
                    {!zone.active && (
                      <span className="px-2 py-0.5 bg-critical/15 text-critical rounded text-[10px] font-bold uppercase">Désactivée</span>
                    )}
                  </h2>
                  <div className="flex items-center gap-2">
                    {!zone.is_pool && zone.active && (
                      <button
                        onClick={() => addRow(zone.key)}
                        disabled={busy}
                        className="flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition disabled:opacity-50"
                      >
                        <Plus size={14} /> Ajouter ligne
                      </button>
                    )}
                    <button
                      onClick={() => toggleZoneActive(zone)}
                      disabled={busy}
                      title={zone.active ? 'Désactiver cette zone' : 'Réactiver cette zone'}
                      className={`p-1.5 border rounded-lg transition disabled:opacity-50 ${
                        zone.active
                          ? 'bg-surface text-ink-muted hover:bg-critical/10 hover:text-critical hover:border-critical/40'
                          : 'bg-success/10 text-success border-success/40 hover:bg-success/20'
                      }`}
                    >
                      {zone.active ? <PowerOff size={13} /> : <Power size={13} />}
                    </button>
                  </div>
                </div>
                {/* Olivier 2026-06-04 : selecteur depot par zone (Pepinster/Verviers/Tiege/Francorchamps/Aywaille) */}
                <div className="flex items-center gap-2 text-[11px]">
                  <label className="text-ink-muted">Dépôt :</label>
                  <select
                    value={zone.depot_id || ''}
                    disabled={busy}
                    onChange={e => {
                      const newDepotId = e.target.value || null
                      if (newDepotId === zone.depot_id) return
                      toggleZoneOption(zone.key, { depot_id: newDepotId })
                    }}
                    className="bg-surface border rounded px-2 py-1 text-ink text-[11px] focus:outline-none focus:border-brand disabled:opacity-50"
                  >
                    <option value="">— Non rattaché —</option>
                    {depots.filter(d => d.active).map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.is_default_parc ? ' ★' : ''}</option>
                    ))}
                  </select>
                </div>
                {/* Olivier 2026-06-22 : type de parc (regroupement organisationnel). */}
                <div className="flex items-center gap-2 text-[11px]">
                  <label className="text-ink-muted">Type :</label>
                  <select
                    value={zone.zone_type || ''}
                    disabled={busy}
                    onChange={e => toggleZoneOption(zone.key, { zone_type: e.target.value || null })}
                    className="bg-surface border rounded px-2 py-1 text-ink text-[11px] focus:outline-none focus:border-brand disabled:opacity-50"
                  >
                    <option value="">— Non classé —</option>
                    <option value="relivraison">Relivraison</option>
                    <option value="accident">Accident</option>
                    <option value="saisie">Saisie</option>
                  </select>
                </div>
                {/* Options de la zone : type, orientation + sens */}
                <div className="flex items-center gap-2 text-[11px] flex-wrap">
                  {/* Type de zone : Grille (rangees) vs Bordel (capacite globale) */}
                  <button
                    onClick={() => toggleZoneOption(zone.key, { is_pool: !zone.is_pool })}
                    disabled={busy}
                    className={`flex items-center gap-1 px-2 py-1 rounded border transition disabled:opacity-50 ${
                      zone.is_pool
                        ? 'bg-warning/15 border-warning/40 text-warning'
                        : 'bg-surface text-ink-secondary hover:text-ink'
                    }`}
                    title={zone.is_pool ? 'Zone Bordel : capacite globale, pas de rangees' : 'Zone Grille : rangees + slots structures'}
                  >
                    {zone.is_pool ? <Shuffle size={11} /> : <Grid3x3 size={11} />}
                    {zone.is_pool ? 'Bordel' : 'Grille'}
                  </button>
                  {/* Capacite Bordel (input inline) */}
                  {zone.is_pool && (
                    <input
                      type="number"
                      min={0}
                      defaultValue={zone.pool_capacity ?? ''}
                      onBlur={e => {
                        const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                        if (v === zone.pool_capacity) return
                        toggleZoneOption(zone.key, { pool_capacity: v as any })
                      }}
                      placeholder="∞"
                      className="w-20 px-2 py-1 bg-surface border rounded text-ink text-[11px] focus:outline-none focus:border-warning"
                      title="Capacité totale du bordel (vide = illimité)"
                    />
                  )}
                  {/* Options grille (cachees en pool) */}
                  {!zone.is_pool && (
                    <>
                      <button
                        onClick={() => toggleZoneOption(zone.key, { row_layout: zone.row_layout === 'horizontal' ? 'vertical' : 'horizontal' })}
                        disabled={busy}
                        className="flex items-center gap-1 px-2 py-1 bg-surface border rounded text-ink-secondary hover:text-ink transition disabled:opacity-50"
                        title="Orientation des rangées"
                      >
                        <RotateCw size={11} /> {zone.row_layout === 'horizontal' ? 'Horizontale' : 'Verticale'}
                      </button>
                      <button
                        onClick={() => toggleZoneOption(zone.key, { slot_direction: zone.slot_direction === 'ltr' ? 'rtl' : 'ltr' })}
                        disabled={busy}
                        className="flex items-center gap-1 px-2 py-1 bg-surface border rounded text-ink-secondary hover:text-ink transition disabled:opacity-50"
                        title="Sens des voitures dans la rangée"
                      >
                        <ArrowLeftRight size={11} /> {zone.slot_direction === 'ltr' ? '→' : '←'}
                      </button>
                      <button
                        onClick={() => toggleZoneOption(zone.key, { strict_capacity: !zone.strict_capacity })}
                        disabled={busy}
                        className={`flex items-center gap-1 px-2 py-1 rounded border transition disabled:opacity-50 ${
                          zone.strict_capacity
                            ? 'bg-critical/10 border-critical/40 text-critical'
                            : 'bg-surface text-ink-secondary hover:text-ink'
                        }`}
                        title={zone.strict_capacity ? 'Zone strict : pas d overflow autorise' : 'Zone tolerante (overflow +N OK)'}
                      >
                        {zone.strict_capacity ? <Lock size={11} /> : <Unlock size={11} />}
                        {zone.strict_capacity ? 'Strict' : 'Tolerant'}
                      </button>
                    </>
                  )}
                  {/* Olivier 2026-06-04 : chauffeurs autorises a deposer ici ? */}
                  <button
                    onClick={() => toggleZoneOption(zone.key, { driver_allowed: !zone.driver_allowed })}
                    disabled={busy}
                    className={`flex items-center gap-1 px-2 py-1 rounded border transition disabled:opacity-50 ${
                      zone.driver_allowed
                        ? 'bg-info/15 border-info/40 text-info'
                        : 'bg-surface text-ink-secondary hover:text-ink'
                    }`}
                    title={zone.driver_allowed ? 'Chauffeurs peuvent y deposer' : 'Reserve dispatcher/fourriere'}
                  >
                    <Truck size={11} />
                    {zone.driver_allowed ? 'Chauffeur OK' : 'Pas chauffeur'}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-[#222]">
                {zone.is_pool ? (
                  <p className="px-4 py-6 text-ink-muted text-sm text-center italic">
                    Zone Bordel : pas de rangées ni emplacements, capacité globale {zone.pool_capacity ?? '∞'}
                  </p>
                ) : zRows.length === 0 ? (
                  <p className="px-4 py-6 text-ink-muted text-sm text-center italic">
                    Aucune ligne configurée
                  </p>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={ev => handleReorderDragEnd(zone.key, ev)}>
                    <SortableContext items={zRows.map(r => r.id)} strategy={verticalListSortingStrategy}>
                      {zRows.map(row => (
                        <SortableRowEditor
                          key={row.id}
                          row={row}
                          busy={busy}
                          onSave={cap => updateCapacity(row, cap)}
                          onDelete={() => deleteRow(row)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </div>
          )
        })}
          </div>
        </div>
        )
      })}

      {createModalOpen && (
        <CreateZoneModal
          depots={depots}
          existingKeys={new Set(zones.map(z => z.key))}
          onClose={() => setCreateModalOpen(false)}
          onCreate={async (payload) => {
            const ok = await createZone(payload)
            if (ok) setCreateModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function CreateZoneModal({ depots, existingKeys, onClose, onCreate }: {
  depots:       Depot[]
  existingKeys: Set<string>
  onClose:      () => void
  onCreate:     (payload: Partial<Zone> & { key: string }) => Promise<void>
}) {
  const [key,            setKey]            = useState('')
  const [label,          setLabel]          = useState('')
  const [depotId,        setDepotId]        = useState<string>(depots.find(d => d.is_default_parc)?.id || depots[0]?.id || '')
  const [isPool,         setIsPool]         = useState(false)
  const [poolCapacity,   setPoolCapacity]   = useState<string>('')
  const [driverAllowed,  setDriverAllowed]  = useState(false)
  const [submitting,     setSubmitting]     = useState(false)
  const [error,          setError]          = useState<string | null>(null)

  const keyClean = key.trim()
  const keyValid = keyClean.length > 0 && keyClean.length <= 20
  const keyUnique = !existingKeys.has(keyClean)

  async function submit() {
    if (!keyValid) { setError('Clé invalide (1-20 caractères)'); return }
    if (!keyUnique) { setError(`La zone "${keyClean}" existe déjà`); return }
    setSubmitting(true)
    setError(null)
    try {
      const payload: Partial<Zone> & { key: string } = {
        key:    keyClean,
        label:  label.trim() || keyClean,
        depot_id: depotId || null,
        is_pool: isPool,
        pool_capacity: isPool && poolCapacity.trim() ? parseInt(poolCapacity, 10) : null,
        driver_allowed: driverAllowed,
      }
      await onCreate(payload)
    } catch (e: any) {
      setError(e?.message || 'Erreur inattendue')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface border rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Plus size={16} /> Nouvelle zone de parc
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            Crée une nouvelle zone. La position sur le plan visuel est par défaut en haut-gauche
            (tu pourras la repositionner via /fourriere/plan).
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
              Clé (identifiant unique) *
            </label>
            <input
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Ex : M, BIS-A, Zone-Special"
              autoFocus
              className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-brand"
            />
            {keyClean && !keyUnique && (
              <p className="text-critical text-xs mt-1">⚠ Cette clé existe déjà</p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
              Libellé affiché
            </label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={keyClean || 'Idem que la clé'}
              className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
              Dépôt
            </label>
            <select
              value={depotId}
              onChange={e => setDepotId(e.target.value)}
              className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
            >
              <option value="">— Non rattaché —</option>
              {depots.filter(d => d.active).map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.is_default_parc ? ' ★' : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPool}
                onChange={e => setIsPool(e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              <span className="text-sm text-ink">Zone "Bordel" (capacité globale, pas de rangées)</span>
            </label>
          </div>

          {isPool && (
            <div>
              <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
                Capacité (vide = illimité)
              </label>
              <input
                type="number"
                min={0}
                value={poolCapacity}
                onChange={e => setPoolCapacity(e.target.value)}
                placeholder="∞"
                className="w-32 bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={driverAllowed}
                onChange={e => setDriverAllowed(e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              <Truck size={14} className="text-info" />
              <span className="text-sm text-ink">Chauffeurs autorisés à déposer ici</span>
            </label>
          </div>

          {error && (
            <div className="bg-critical/10 border border-critical/40 rounded-lg px-3 py-2 text-critical text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 text-ink-muted hover:text-ink text-sm font-semibold transition disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={submitting || !keyValid || !keyUnique}
            className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
          >
            {submitting ? 'Création...' : 'Créer la zone'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RowEditor({ row, busy, onSave, onDelete }: {
  row:      Row
  busy:     boolean
  onSave:   (capacity: number) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(String(row.capacity))

  function commit() {
    const n = parseInt(val, 10)
    if (!Number.isInteger(n) || n <= 0) {
      setVal(String(row.capacity))
      setEditing(false)
      return
    }
    onSave(n)
    setEditing(false)
  }

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-surface-hover">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-ink font-mono font-bold text-sm bg-brand/15 text-brand px-2 py-0.5 rounded">
          {row.zone_key}{row.row_number}
        </span>
        {editing ? (
          <>
            <input
              type="number" min={1}
              value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') { setVal(String(row.capacity)); setEditing(false) }
              }}
              autoFocus
              className="w-16 bg-surface border rounded px-2 py-1 text-sm text-ink"
            />
            <button onClick={commit} disabled={busy} className="text-success hover:text-success-soft">
              <Check size={16} />
            </button>
            <button onClick={() => { setVal(String(row.capacity)); setEditing(false) }}
                    className="text-ink-muted hover:text-ink">
              <X size={16} />
            </button>
          </>
        ) : (
          <button
            onClick={() => { setVal(String(row.capacity)); setEditing(true) }}
            className="text-ink-secondary text-sm hover:text-ink"
            title="Cliquer pour modifier"
          >
            Capacité : <span className="font-semibold">{row.capacity}</span>
          </button>
        )}
      </div>
      <button
        onClick={onDelete} disabled={busy}
        className="text-ink-muted hover:text-critical p-1.5 transition disabled:opacity-50"
        title="Supprimer la ligne"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

// Wrapper sortable autour de RowEditor : ajoute une poignee GripVertical
// a gauche pour drag&drop de reordonnancement.
function SortableRowEditor(props: {
  row:      Row
  busy:     boolean
  onSave:   (capacity: number) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.row.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity:   isDragging ? 0.6 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className={`flex items-center ${isDragging ? 'bg-surface-hover' : ''}`}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-ink-faint hover:text-ink-secondary touch-none px-2"
        aria-label="Réordonner la ligne"
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1">
        <RowEditor {...props} />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Bloc "Préparer inventaire complet" (bulk sync Odoo + canonicalize + reset placements)
// ──────────────────────────────────────────────────────────────────────────────
function PrepareFullInventoryBlock() {
  const [busy, setBusy] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<any>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  async function runDryRun() {
    setBusy(true); setErr(null); setDone(null)
    try {
      const res = await fetch("/api/admin/parc/prepare-full-inventory", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ dry_run: true }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setDryRunResult(j)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function runExecute() {
    if (!confirming) { setConfirming(true); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch("/api/admin/parc/prepare-full-inventory", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({}),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setDone(j)
      setDryRunResult(null)
      setConfirming(false)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-warning/5 border border-warning/40 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-ink font-bold text-base flex items-center gap-2">
            🔄 Préparer inventaire complet
          </h2>
          <p className="text-ink-muted text-xs mt-1 max-w-2xl">
            Pour passer VD Soft en source de vérité unique. Synchronise tous les véhicules
            Odoo en fourrière vers VD Soft, fixe les mismatches de casse, et clear les rangées/slots
            pour préparer un re-scan complet. <strong>Action lourde — à ne lancer qu&apos;avant un
            inventaire complet (2h de scan).</strong>
          </p>
        </div>
      </div>

      {!dryRunResult && !done && (
        <button
          onClick={runDryRun}
          disabled={busy}
          className="px-3 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {busy ? "Analyse en cours…" : "1. Lancer un dry-run (aperçu sans modification)"}
        </button>
      )}

      {err && (
        <div className="bg-critical/10 border border-critical/40 rounded-lg p-3 text-critical text-sm">
          {err}
        </div>
      )}

      {dryRunResult && !done && (
        <div className="bg-surface border rounded-xl p-3 space-y-2 text-sm">
          <h3 className="font-semibold text-ink">📊 Aperçu (dry-run)</h3>
          <ul className="space-y-1 text-ink-secondary text-xs">
            <li>• <strong>{dryRunResult.stats.odoo_vehicles}</strong> véhicules Odoo en fourrière</li>
            <li>• <strong>{dryRunResult.stats.vd_soft_missions}</strong> missions VD Soft actuelles</li>
            <li>• <strong>{dryRunResult.stats.vehicles_to_create}</strong> stubs VD Soft à créer (manquants)</li>
            <li>• <strong>{dryRunResult.stats.vehicles_to_canonicalize}</strong> zones à canonicaliser (BOX → Box, etc.)</li>
            <li>• <strong>{dryRunResult.stats.vehicles_to_reset_placement}</strong> placements à vider (rangée+slot → null)</li>
          </ul>
          <div className="mt-3">
            <h4 className="text-ink font-medium text-xs mb-1">Répartition par zone (après prépa) :</h4>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(dryRunResult.stats.zones_distribution).map(([z, n]) => (
                <span key={z} className="px-2 py-0.5 bg-surface-2 border rounded-full text-[10px] font-mono">
                  {z}: <strong className="text-brand">{String(n)}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2 border-t">
            {confirming ? (
              <>
                <span className="text-warning text-xs font-medium">⚠️ Cette action va modifier la BDD. Confirmer ?</span>
                <button
                  onClick={runExecute}
                  disabled={busy}
                  className="px-3 py-1.5 bg-critical hover:bg-critical/90 text-white rounded-lg text-xs font-bold disabled:opacity-50">
                  {busy ? "Exécution…" : "Oui, exécuter"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-surface-2 border text-ink-secondary hover:text-ink rounded-lg text-xs">
                  Annuler
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={runExecute}
                  disabled={busy}
                  className="px-3 py-1.5 bg-warning hover:bg-warning/90 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                  2. Exécuter pour de vrai
                </button>
                <button
                  onClick={() => setDryRunResult(null)}
                  className="px-3 py-1.5 bg-surface-2 border text-ink-secondary hover:text-ink rounded-lg text-xs">
                  Re-analyser
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {done && (
        <div className="bg-success/10 border border-success/40 rounded-xl p-3 text-sm space-y-2">
          <h3 className="font-semibold text-success">✅ Préparation terminée</h3>
          <ul className="space-y-1 text-ink-secondary text-xs">
            <li>• {done.stats.vehicles_to_create} stubs créés</li>
            <li>• {done.stats.vehicles_to_canonicalize} zones canonicalisées</li>
            <li>• {done.stats.vehicles_to_reset_placement} placements vidés</li>
          </ul>
          <p className="text-ink-secondary text-xs mt-2">
            Tu peux maintenant lancer l&apos;inventaire complet (~2h). Tous les véhicules
            sont en &quot;À placer&quot; groupés par zone.
          </p>
          <button
            onClick={() => { setDone(null); setDryRunResult(null) }}
            className="mt-2 px-3 py-1.5 bg-surface-2 border text-ink-secondary hover:text-ink rounded-lg text-xs">
            OK
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Bloc "Enrichir manquants" — relance le scraping TowSoft pour les missions
// encore en source='legacy_odoo' (= scraping initial a foire ou skip).
// Olivier 2026-06-03 : bouton manuel, on clique plusieurs fois jusqu a 0.
// ─────────────────────────────────────────────────────────────────────────
function EnrichBatchBlock() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<null | {
    processed: number
    enriched:  number
    failed:    number
    remaining: number
    results?:  Array<{ plate: string | null; ok: boolean; reason?: string }>
  }>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(limit: number) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/parc/enrich-batch?limit=${limit}`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setResult(j)
    } catch (e: any) {
      setError(e.message || 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface-2 border rounded-2xl p-4 mt-4">
      <h2 className="text-ink font-semibold text-sm mb-2 flex items-center gap-2">
        ✨ Enrichir missions via TowSoft
      </h2>
      <p className="text-ink-muted text-xs mb-3">
        Re-scrape les fiches TowSoft pour les missions <code className="bg-surface px-1 rounded">legacy_odoo</code> (= pas encore enrichies, soit jamais scannees soit scraping initial a foire).
        Ajoute : dossier, vraie date intervention, lieu, proprietaire, police, n° digibox cles.
        <br/>
        <strong>Cout</strong> : ~10-15s par mission via Browserless (concurrence 3). Clique plusieurs fois jusqu&apos;a <code className="bg-surface px-1 rounded">remaining = 0</code>.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => run(10)}
          disabled={busy}
          className="px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
          {busy ? '⏳ En cours… (~3 min)' : '✨ Enrichir 10 missions'}
        </button>
      </div>
      <p className="text-xs text-ink-faint mt-2">
        Limite a 10 par batch (~17s/mission a cause du throttle TowSoft). Clique &quot;Continuer&quot; apres chaque batch jusqu&apos;a remaining=0.
      </p>
      {error && (
        <div className="mt-3 bg-critical/10 border border-critical/30 rounded-lg p-3 text-critical text-xs">
          ❌ {error}
        </div>
      )}
      {result && (
        <div className="mt-3 bg-surface border rounded-lg p-3 text-xs space-y-2">
          <p className="text-ink font-semibold">
            ✓ {result.enriched} enrichies · {result.failed} echecs · {result.remaining} restantes
          </p>
          {result.results && result.results.filter(r => !r.ok).length > 0 && (
            <details className="text-ink-muted">
              <summary className="cursor-pointer">Echecs ({result.results.filter(r => !r.ok).length})</summary>
              <ul className="mt-2 space-y-0.5">
                {result.results.filter(r => !r.ok).slice(0, 20).map((r, i) => (
                  <li key={i} className="font-mono">
                    <strong>{r.plate || '—'}</strong> : {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.remaining > 0 && (
            <button
              onClick={() => run(10)}
              disabled={busy}
              className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
              {busy ? '⏳' : `↻ Continuer (${result.remaining} restantes)`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Bloc "Refresh dates" — corrige les heures suspectes (00:00 UTC = 02h
// Bruxelles) en allant chercher create_date du ticket Odoo (HH:MM:SS).
// Rapide (1 appel Odoo, pas de Browserless).
// ─────────────────────────────────────────────────────────────────────────
function RefreshDatesBlock() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<null | { candidates: number; updated: number; skipped: number; message: string }>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/parc/refresh-dates', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setResult(j)
    } catch (e: any) {
      setError(e.message || 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface-2 border rounded-2xl p-4 mt-4">
      <h2 className="text-ink font-semibold text-sm mb-2 flex items-center gap-2">
        🕒 Corriger les heures suspectes (02h Bruxelles)
      </h2>
      <p className="text-ink-muted text-xs mb-3">
        Pour les missions creees par <code className="bg-surface px-1 rounded">prepare-full-inventory</code> avec heure
        d intervention bidon (02h Bruxelles = 00h UTC, car <code className="bg-surface px-1 rounded">x_studio_date_dentree</code> Odoo
        ne contient que la date). Recupere l <strong>heure reelle</strong> depuis <code className="bg-surface px-1 rounded">helpdesk.ticket.create_date</code>.
        <br/>
        <strong>Rapide</strong> : 1 batch Odoo (~5s, pas de Browserless). Ne touche que les missions a heure suspecte.
      </p>
      <button
        onClick={run}
        disabled={busy}
        className="px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
        {busy ? '⏳ En cours…' : '🕒 Lancer la correction des heures'}
      </button>
      {error && (
        <div className="mt-3 bg-critical/10 border border-critical/30 rounded-lg p-3 text-critical text-xs">
          ❌ {error}
        </div>
      )}
      {result && (
        <div className="mt-3 bg-surface border rounded-lg p-3 text-xs">
          <p className="text-ink font-semibold">
            ✓ {result.updated} missions mises a jour · {result.candidates} candidates · {result.skipped} skipped
          </p>
          <p className="text-ink-muted mt-1">{result.message}</p>
        </div>
      )}
    </div>
  )
}

