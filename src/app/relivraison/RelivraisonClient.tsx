'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { verifyAddressViaPlaces } from '@/components/AddressField'
import { getSourceLabel, getSourceColor, type SourceDisplay } from '@/lib/missions/source-display'

interface Mission {
  id:                 string
  mission_number?:    number | null
  external_id?:       string | null
  source:             string | null
  vehicle_plate:      string | null
  vehicle_brand:      string | null
  vehicle_model:      string | null
  client_name:        string | null
  redelivery_address: string | null
  redelivery_lat:     number | null
  redelivery_lng:     number | null
}

interface ZoneTab { key: string; label: string; count: number }

export default function RelivraisonClient({ userRole, userName, userEmail, userModules, sources }: {
  userRole:    string
  userName:    string
  userEmail?:  string
  userModules: string[]
  sources:     SourceDisplay[]
}) {
  const [zone,     setZone]     = useState('K')      // onglet actif (défaut K)
  const [zones,    setZones]    = useState<ZoneTab[]>([])
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [busyId,   setBusyId]   = useState<string | null>(null)

  const zoneRef = useRef(zone)
  useEffect(() => { zoneRef.current = zone }, [zone])

  const load = useCallback(async (z: string, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/relivraison/list?zone=${encodeURIComponent(z)}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      // Garde anti-périmé : ignore une réponse d'un onglet qu'on a quitté.
      if (zoneRef.current !== z) return
      setZones(j.zones || [])
      setMissions(j.missions || [])
      setError('')
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [])

  // Crée la fiche de relivraison (REL) à partir d'une mission parc-ée.
  const relivrer = useCallback(async (m: Mission) => {
    let address = (m.redelivery_address || '').trim()
    if (!address) {
      const entered = window.prompt(`Adresse de relivraison pour ${m.vehicle_plate || 'ce véhicule'} ?`)
      address = (entered || '').trim()
      if (!address) return
    } else if (!window.confirm(`Créer la relivraison pour ${m.vehicle_plate || 'ce véhicule'} ?\n→ ${address}`)) {
      return
    }
    setBusyId(m.id)
    try {
      const res = await fetch(`/api/missions/${m.id}/relivrer`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(m.redelivery_address ? {} : { redelivery_address: address }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { alert(j.error || 'Création de la relivraison échouée.'); return }
      // La REL est créée → le parent sort de la liste. On recharge.
      await load(zoneRef.current, true)
    } catch {
      alert('Erreur réseau.')
    } finally {
      setBusyId(null)
    }
  }, [])

  useEffect(() => { load(zone) }, [zone, load])
  // Rafraîchissement léger périodique de l'onglet courant.
  useEffect(() => {
    const t = setInterval(() => load(zoneRef.current, true), 30000)
    return () => clearInterval(t)
  }, [load])

  // Géocodage CÔTÉ NAVIGATEUR des adresses de relivraison manquantes (l'API
  // Geocoding serveur n'est pas activée) → persiste les coords puis recharge,
  // ce qui permet au serveur de trier la liste par tournée.
  const geocodingRef = useRef(false)
  const triedRef     = useRef<Set<string>>(new Set())
  useEffect(() => {
    const gmKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
    if (!gmKey) return
    const toGeo = missions.filter(m =>
      m.redelivery_address &&
      (m.redelivery_lat == null || m.redelivery_lng == null) &&
      !triedRef.current.has(m.id))
    if (toGeo.length === 0 || geocodingRef.current) return
    geocodingRef.current = true
    ;(async () => {
      let any = false
      for (const m of toGeo) {
        triedRef.current.add(m.id)
        try {
          const r = await verifyAddressViaPlaces(m.redelivery_address as string, gmKey)
          if (r) {
            await fetch(`/api/missions/${m.id}`, {
              method:  'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ redelivery_lat: r.lat, redelivery_lng: r.lng }),
            })
            any = true
          }
        } catch { /* best effort */ }
      }
      geocodingRef.current = false
      if (any) load(zoneRef.current, true)
    })()
  }, [missions, load])

  return (
    <AppShell title="Relivraison" userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      <main className="p-4 lg:p-8 max-w-5xl mx-auto">
        <div className="mb-3">
          <h1 className="text-ink text-xl font-bold">🔁 Relivraison</h1>
          <p className="text-ink-muted text-sm">
            Véhicules en parc en attente de relivraison — triés par tournée (adresses proches regroupées).
          </p>
        </div>

        {/* Onglets par zone (type Relivraison) */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {zones.map(z => (
            <button
              key={z.key}
              type="button"
              onClick={() => setZone(z.key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${
                zone === z.key
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface border text-ink-secondary hover:text-ink hover:border-brand/40'
              }`}
            >
              {z.label}
              <span className={`ml-2 ${zone === z.key ? 'text-white/80' : 'text-ink-faint'}`}>{z.count}</span>
            </button>
          ))}
          <span className="ml-auto bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5 text-emerald-300 text-xs font-medium">
            🗺️ Tri par tournée
          </span>
        </div>

        {loading ? (
          <p className="text-ink-muted py-8 text-center">Chargement…</p>
        ) : error ? (
          <p className="text-critical py-8 text-center">⚠ {error}</p>
        ) : missions.length === 0 ? (
          <div className="text-center py-16 text-ink-muted">Aucun véhicule à relivrer dans cette zone 🎉</div>
        ) : (
          <div className="space-y-2">
            {missions.map(m => (
              <Link
                key={m.id}
                href={`/dispatch/${m.id}`}
                className="block bg-surface border rounded-xl p-4 hover:border-brand/40 transition"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-ink font-bold font-mono text-sm">
                        {m.vehicle_plate || '—'}
                        <span className="text-ink-secondary font-normal font-sans"> {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}</span>
                      </p>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase text-white ${getSourceColor(m.source, sources)}`}>
                        {getSourceLabel(m.source, sources)}
                      </span>
                    </div>
                    <p className="text-ink-muted text-xs mt-0.5">{m.client_name || '—'}</p>
                    <p className="text-ink text-sm mt-1">
                      <span className="text-ink-muted text-xs">Adresse de relivraison :</span>{' '}
                      📍 {m.redelivery_address || <span className="text-amber-500">à saisir</span>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); relivrer(m) }}
                      disabled={busyId === m.id}
                      className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                    >
                      {busyId === m.id ? '…' : '🔁 Relivrer'}
                    </button>
                    <span className="text-ink-muted text-xs">VOIR →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  )
}
