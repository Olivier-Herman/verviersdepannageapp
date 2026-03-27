'use client'
// src/app/admin/depots/DepotsAdminClient.tsx

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

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

function AddressInput({ value, onChange, onSelect }: {
  value: string
  onChange: (v: string) => void
  onSelect: (addr: string, lat: number, lng: number) => void
}) {
  const ref   = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)
  const [gpsLoading, setGpsLoading] = useState(false)

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
          onChange(addr)
          onSelect(addr, p.geometry.location.lat(), p.geometry.location.lng())
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
      <button onClick={handleGPS} disabled={gpsLoading} type="button"
        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/15 border border-blue-500/30 hover:bg-blue-600/25 disabled:opacity-50 text-blue-300 rounded-lg text-xs transition">
        {gpsLoading ? '⏳ Localisation…' : '📍 Ma position'}
      </button>
      <input ref={ref} value={value} onChange={e => onChange(e.target.value)}
        placeholder="Rue, numéro, ville…"
        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
    </div>
  )
}

export default function DepotsAdminClient({ initialDepots }: { initialDepots: Depot[] }) {
  const [depots,  setDepots]  = useState<Depot[]>(initialDepots)
  const [editing, setEditing] = useState<Partial<Depot> | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const openNew  = () => setEditing({ ...EMPTY })
  const openEdit = (d: Depot) => setEditing({ ...d })

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

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce dépôt ?')) return
    await fetch(`/api/depots?id=${id}`, { method: 'DELETE' })
    setDepots(ds => ds.filter(d => d.id !== id))
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] px-6 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</Link>
        <h1 className="text-white font-bold text-2xl">Dépôts</h1>
        <button onClick={openNew}
          className="ml-auto px-4 py-2 bg-brand text-white rounded-xl text-sm font-medium">
          + Nouveau dépôt
        </button>
      </div>

      {/* Liste */}
      <div className="space-y-3">
        {depots.filter(d => d.active).map(d => (
          <div key={d.id} className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-white font-semibold">{d.name}</p>
                {d.is_default && (
                  <span className="px-2 py-0.5 bg-brand/20 border border-brand/30 text-brand text-xs rounded-full">
                    Par défaut
                  </span>
                )}
              </div>
              <p className="text-zinc-500 text-sm truncate">{d.address}</p>
              {d.lat && <p className="text-zinc-700 text-xs">{d.lat.toFixed(5)}, {d.lng?.toFixed(5)}</p>}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => openEdit(d)}
                className="px-3 py-1.5 bg-[#2a2a2a] text-zinc-300 hover:text-white rounded-lg text-xs transition">
                Modifier
              </button>
              <button onClick={() => handleDelete(d.id)}
                className="px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs transition">
                Supprimer
              </button>
            </div>
          </div>
        ))}
        {depots.filter(d => d.active).length === 0 && (
          <p className="text-zinc-600 text-center py-12">Aucun dépôt configuré</p>
        )}
      </div>

      {/* Modal édition */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4"
          onClick={() => setEditing(null)}>
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">{editing.id ? 'Modifier' : 'Nouveau dépôt'}</h2>
              <button onClick={() => setEditing(null)} className="text-zinc-500 text-2xl">×</button>
            </div>

            <div>
              <label className="block text-zinc-500 text-xs mb-1.5">Nom *</label>
              <input value={editing.name || ''} onChange={e => setEditing(v => ({ ...v!, name: e.target.value }))}
                placeholder="Ex: Pepinster"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
            </div>

            <div>
              <label className="block text-zinc-500 text-xs mb-1.5">Adresse *</label>
              <AddressInput
                value={editing.address || ''}
                onChange={v => setEditing(e => ({ ...e!, address: v }))}
                onSelect={(addr, lat, lng) => setEditing(e => ({ ...e!, address: addr, lat, lng }))}
              />
              {editing.lat && (
                <p className="text-green-400 text-xs mt-1">✓ Position GPS encodée</p>
              )}
            </div>

            <div>
              <label className="block text-zinc-500 text-xs mb-1.5">Ordre d&apos;affichage</label>
              <input type="number" value={editing.sort_order ?? 0}
                onChange={e => setEditing(v => ({ ...v!, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-24 bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={editing.is_default ?? false}
                onChange={e => setEditing(v => ({ ...v!, is_default: e.target.checked }))}
                className="w-4 h-4 accent-brand" />
              <span className="text-zinc-300 text-sm">Dépôt par défaut</span>
            </label>

            {error && <p className="text-red-400 text-sm">⚠️ {error}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2.5 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">
                Annuler
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-brand disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
