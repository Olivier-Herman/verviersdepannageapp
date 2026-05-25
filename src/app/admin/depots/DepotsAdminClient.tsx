'use client'
// src/app/admin/depots/DepotsAdminClient.tsx
//
// POC Phase 1 — proof-of-concept d'intégration des composants atomiques
// (Button, Badge, ConfirmModal) et des tokens thème (bg-surface / border /
// text-ink / etc.) sur l'écran le plus simple côté admin.
//
// Aucune modif fonctionnelle vs version précédente — uniquement migration
// visuelle. La logique CRUD (POST/PUT/DELETE /api/depots) est intacte.

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, MapPin, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

interface Depot {
  id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  is_default: boolean
  active: boolean
  sort_order: number
}

const EMPTY: Omit<Depot, 'id' | 'created_at'> = {
  name: '', address: '', lat: null, lng: null,
  is_default: false, active: true, sort_order: 0,
}

// Classes communes pour les inputs HTML — pas de composant <Input> atomique en
// phase 1. À factoriser en Phase 2 si la duplication devient pénible.
const inputCls =
  'w-full bg-surface border rounded-md px-3 py-2.5 text-sm text-ink ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft ' +
  'placeholder:text-ink-muted transition-colors'

const labelCls = 'block text-ink-muted text-xs font-semibold mb-1.5 uppercase tracking-wider'

function AddressInput({ value, onChange, onSelect }: {
  value: string
  onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number) => void
}) {
  const ref   = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  // Refs pour onChange/onSelect : evite closure stale (listener cree une fois).
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect

  useEffect(() => {
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current, {
        componentRestrictions: { country: ['be','lu','fr','nl','de'] },
        fields: ['formatted_address','geometry'],
      })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace()
        if (p?.geometry) {
          const addr = p.formatted_address || ''
          onChangeRef.current(addr)
          onSelectRef.current(addr, p.geometry.location.lat(), p.geometry.location.lng())
        }
      })
    }
    if ((window as any).google) init()
    else { const t = setInterval(() => { if ((window as any).google) { init(); clearInterval(t) } }, 300); return () => clearInterval(t) }
  }, [])

  const handleGPS = () => {
    if (!navigator.geolocation) return
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      const g = (window as any).google
      if (g?.maps) {
        new g.maps.Geocoder().geocode({ location: { lat, lng } }, (results: any[], status: string) => {
          setGpsLoading(false)
          if (status === 'OK' && results[0]) {
            const addr = results[0].formatted_address
            onChange(addr); onSelect(addr, lat, lng)
          }
        })
      } else { setGpsLoading(false) }
    }, () => setGpsLoading(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  return (
    <div className="space-y-1.5">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        loading={gpsLoading}
        iconLeft={!gpsLoading ? <MapPin size={14} /> : undefined}
        onClick={handleGPS}
      >
        {gpsLoading ? 'Localisation…' : 'Ma position'}
      </Button>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Rue, numéro, ville…"
        className={inputCls}
      />
    </div>
  )
}

export default function DepotsAdminClient({ initialDepots }: { initialDepots: Depot[] }) {
  const [depots,           setDepots]           = useState<Depot[]>(initialDepots)
  const [editing,          setEditing]          = useState<Partial<Depot> | null>(null)
  const [saving,           setSaving]           = useState(false)
  const [error,            setError]            = useState('')
  const [confirmDeleteId,  setConfirmDeleteId]  = useState<string | null>(null)
  const [deleting,         setDeleting]         = useState(false)

  const openNew  = () => { setError(''); setEditing({ ...EMPTY }) }
  const openEdit = (d: Depot) => { setError(''); setEditing({ ...d }) }

  const handleSave = async () => {
    if (!editing?.name || !editing?.address) { setError('Nom et adresse requis'); return }
    setSaving(true); setError('')
    try {
      const method = editing.id ? 'PUT' : 'POST'
      const r = await fetch('/api/depots', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Erreur'); return }
      if (editing.id) {
        setDepots(ds => ds.map(d => d.id === data.id ? data : d))
      } else {
        setDepots(ds => [...ds, data])
      }
      setEditing(null)
    } catch { setError('Erreur réseau') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirmDeleteId) return
    setDeleting(true)
    try {
      await fetch(`/api/depots?id=${confirmDeleteId}`, { method: 'DELETE' })
      setDepots(ds => ds.filter(d => d.id !== confirmDeleteId))
      setConfirmDeleteId(null)
    } finally {
      setDeleting(false)
    }
  }

  const activeDepots = depots.filter(d => d.active)

  return (
    <div className="px-4 lg:px-6 py-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin"
          aria-label="Retour à l'administration"
          className="inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-secondary hover:bg-surface-hover hover:text-ink transition-colors"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-2xl font-bold text-ink">Dépôts</h1>
        <div className="ml-auto">
          <Button variant="primary" iconLeft={<Plus size={16} />} onClick={openNew}>
            Nouveau dépôt
          </Button>
        </div>
      </div>

      {/* Liste */}
      <div className="space-y-3">
        {activeDepots.map(d => (
          <div
            key={d.id}
            className="bg-surface border rounded-card shadow-card p-4 flex items-center gap-4 transition-shadow hover:shadow-md"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <p className="font-display font-semibold text-ink truncate">{d.name}</p>
                {d.is_default && <Badge variant="brand" leading="★">Par défaut</Badge>}
              </div>
              <p className="text-ink-secondary text-sm truncate">{d.address}</p>
              {d.lat != null && d.lng != null && (
                <p className="text-ink-faint text-xs font-mono mt-0.5">
                  {d.lat.toFixed(5)}, {d.lng.toFixed(5)}
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                Modifier
              </Button>
              <Button variant="danger" size="sm" onClick={() => setConfirmDeleteId(d.id)}>
                Supprimer
              </Button>
            </div>
          </div>
        ))}
        {activeDepots.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed rounded-card text-ink-muted">
            Aucun dépôt configuré
          </div>
        )}
      </div>

      {/* Modal édition (pattern visuel équivalent à ConfirmModal mais avec form) */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={saving ? undefined : () => setEditing(null)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="depot-edit-title"
            className="relative w-full max-w-lg bg-surface border rounded-card shadow-md"
          >
            <div className="px-5 pt-5 pb-2 flex items-center justify-between">
              <h2 id="depot-edit-title" className="font-display text-lg font-bold text-ink">
                {editing.id ? 'Modifier le dépôt' : 'Nouveau dépôt'}
              </h2>
              <button
                onClick={() => setEditing(null)}
                aria-label="Fermer"
                disabled={saving}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-3 space-y-4">
              <div>
                <label className={labelCls}>Nom *</label>
                <input
                  value={editing.name || ''}
                  onChange={e => setEditing(v => ({ ...v!, name: e.target.value }))}
                  placeholder="Ex: Pepinster"
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Adresse *</label>
                <AddressInput
                  value={editing.address || ''}
                  onChange={v => setEditing(e => ({ ...e!, address: v }))}
                  onSelect={(addr, lat, lng) => setEditing(e => ({ ...e!, address: addr, lat, lng }))}
                />
                {editing.lat != null && (
                  <p className="text-success text-xs mt-1.5 flex items-center gap-1">
                    <span aria-hidden="true">✓</span> Position GPS encodée
                  </p>
                )}
              </div>

              <div>
                <label className={labelCls}>Ordre d&apos;affichage</label>
                <input
                  type="number"
                  value={editing.sort_order ?? 0}
                  onChange={e => setEditing(v => ({ ...v!, sort_order: parseInt(e.target.value) || 0 }))}
                  className={`${inputCls} w-24`}
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editing.is_default ?? false}
                  onChange={e => setEditing(v => ({ ...v!, is_default: e.target.checked }))}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-ink text-sm">Dépôt par défaut</span>
              </label>

              {error && (
                <p className="text-critical text-sm flex items-center gap-1.5">
                  <span aria-hidden="true">⚠️</span> {error}
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                Annuler
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>
                {editing.id ? 'Enregistrer' : 'Créer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmation suppression */}
      <ConfirmModal
        open={!!confirmDeleteId}
        title="Supprimer ce dépôt ?"
        description="Cette action est irréversible. Les missions liées garderont leur référence mais le dépôt n'apparaîtra plus dans les listes."
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
        loading={deleting}
      />
    </div>
  )
}
