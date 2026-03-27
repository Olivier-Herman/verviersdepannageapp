'use client'
// src/app/admin/vr-locations/VrLocationsClient.tsx
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

interface VrLocation { id: string; name: string; address: string; lat: number|null; lng: number|null; active: boolean; sort_order: number }

function AddressInput({ value, onChange, onSelect }: { value: string; onChange: (v: string) => void; onSelect: (addr: string, lat: number, lng: number) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const acRef = useRef<any>(null)
  const [gps, setGps] = useState(false)

  useEffect(() => {
    const init = () => {
      if (!ref.current || !(window as any).google?.maps?.places || acRef.current) return
      acRef.current = new (window as any).google.maps.places.Autocomplete(ref.current, {
        fields: ['name', 'formatted_address', 'geometry'],
      })
      acRef.current.addListener('place_changed', () => {
        const p = acRef.current.getPlace()
        if (p?.geometry) {
          const addr = p.name && p.formatted_address ? `${p.name}, ${p.formatted_address}` : (p.formatted_address || p.name || '')
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
    setGps(true)
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      const g = (window as any).google
      if (g?.maps) {
        new g.maps.Geocoder().geocode({ location: { lat, lng } }, (r: any[], s: string) => {
          setGps(false)
          if (s === 'OK' && r[0]) { onChange(r[0].formatted_address); onSelect(r[0].formatted_address, lat, lng) }
        })
      } else { setGps(false) }
    }, () => setGps(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={handleGPS} disabled={gps}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600/15 border border-blue-500/30 hover:bg-blue-600/25 disabled:opacity-50 text-blue-300 rounded-xl text-sm transition">
        {gps ? '⏳ Localisation…' : '📍 Ma position actuelle'}
      </button>
      <input ref={ref} value={value} onChange={e => onChange(e.target.value)}
        placeholder="Nom d'établissement ou adresse…"
        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
      {value && <p className="text-green-400 text-xs truncate">✓ {value}</p>}
    </div>
  )
}

export default function VrLocationsClient({ initialData }: { initialData: VrLocation[] }) {
  const [items,   setItems]   = useState<VrLocation[]>(initialData)
  const [editing, setEditing] = useState<Partial<VrLocation>|null>(null)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const handleSave = async () => {
    if (!editing?.name || !editing?.address) { setError('Nom et adresse requis'); return }
    setSaving(true); setError('')
    try {
      const method = editing.id ? 'PUT' : 'POST'
      const r = await fetch('/api/vr-locations', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Erreur'); return }
      if (editing.id) setItems(is => is.map(i => i.id === data.id ? data : i))
      else setItems(is => [...is, data])
      setEditing(null)
    } catch { setError('Erreur réseau') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cet emplacement VR ?')) return
    await fetch(`/api/vr-locations?id=${id}`, { method: 'DELETE' })
    setItems(is => is.filter(i => i.id !== id))
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] px-6 py-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="w-9 h-9 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white">←</Link>
        <h1 className="text-white font-bold text-2xl">Emplacements VR</h1>
        <button onClick={() => setEditing({ name: '', address: '', lat: null, lng: null, sort_order: 0 })}
          className="ml-auto px-4 py-2 bg-brand text-white rounded-xl text-sm font-medium">
          + Nouveau
        </button>
      </div>
      <p className="text-zinc-500 text-sm mb-6">Ces emplacements apparaissent en priorité dans le champ "Où se trouve le VR ?" lors de la création d'un rapport REM+VR.</p>

      <div className="space-y-3">
        {items.filter(i => i.active).map(item => (
          <div key={item.id} className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold">{item.name}</p>
              <p className="text-zinc-500 text-sm truncate">{item.address}</p>
              {item.lat && <p className="text-zinc-700 text-xs">{item.lat.toFixed(5)}, {item.lng?.toFixed(5)}</p>}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setEditing({ ...item })} className="px-3 py-1.5 bg-[#2a2a2a] text-zinc-300 hover:text-white rounded-lg text-xs transition">Modifier</button>
              <button onClick={() => handleDelete(item.id)} className="px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs transition">Supprimer</button>
            </div>
          </div>
        ))}
        {items.filter(i => i.active).length === 0 && (
          <p className="text-zinc-600 text-center py-12">Aucun emplacement configuré</p>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4" onClick={() => setEditing(null)}>
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-lg">{editing.id ? 'Modifier' : 'Nouvel emplacement VR'}</h2>
              <button onClick={() => setEditing(null)} className="text-zinc-500 text-2xl">×</button>
            </div>
            <div>
              <label className="block text-zinc-500 text-xs mb-1.5">Nom *</label>
              <input value={editing.name || ''} onChange={e => setEditing(v => ({ ...v!, name: e.target.value }))}
                placeholder="Ex: Rent A Car Pepinster"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-zinc-500 text-xs mb-1.5">Adresse ou établissement *</label>
              <AddressInput
                value={editing.address || ''}
                onChange={v => setEditing(e => ({ ...e!, address: v }))}
                onSelect={(addr, lat, lng) => setEditing(e => ({ ...e!, address: addr, lat, lng }))}
              />
              {editing.lat && <p className="text-green-400 text-xs mt-1">✓ GPS encodé</p>}
            </div>
            <div>
              <label className="block text-zinc-500 text-xs mb-1.5">Ordre</label>
              <input type="number" value={editing.sort_order ?? 0}
                onChange={e => setEditing(v => ({ ...v!, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-24 bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand" />
            </div>
            {error && <p className="text-red-400 text-sm">⚠️ {error}</p>}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditing(null)} className="flex-1 py-2.5 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-brand disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
