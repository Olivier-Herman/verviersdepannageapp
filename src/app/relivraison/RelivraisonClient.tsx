'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import AddressField, { verifyAddressViaPlaces } from '@/components/AddressField'
import { getSourceLabel, getSourceColor, type SourceDisplay } from '@/lib/missions/source-display'

const GM_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

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
  // Modal relivraison
  const [modal,  setModal]  = useState<Mission | null>(null)
  const [mAddr,  setMAddr]  = useState('')
  const [mLat,   setMLat]   = useState<number | null>(null)
  const [mLng,   setMLng]   = useState<number | null>(null)
  const [mBusy,  setMBusy]  = useState<'save' | 'relivrer' | null>(null)
  const [mErr,   setMErr]   = useState('')

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

  // Ouvre le modal de relivraison (adresse pré-remplie si connue).
  const openModal = useCallback((m: Mission) => {
    setModal(m)
    setMAddr(m.redelivery_address || '')
    setMLat(m.redelivery_lat)
    setMLng(m.redelivery_lng)
    setMErr('')
  }, [])

  // Enregistre l'adresse de relivraison (PATCH). Retourne true si OK.
  const saveAddress = useCallback(async (id: string, addr: string, lat: number | null, lng: number | null) => {
    const body: any = { redelivery_address: addr }
    if (lat != null) body.redelivery_lat = lat
    if (lng != null) body.redelivery_lng = lng
    const res = await fetch(`/api/missions/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    return res.ok
  }, [])

  // Bouton "Enregistrer les modifications" : ne sauve que l'adresse.
  const onSaveOnly = useCallback(async () => {
    if (!modal) return
    const addr = mAddr.trim()
    if (!addr) { setMErr('Adresse de relivraison requise.'); return }
    setMBusy('save'); setMErr('')
    try {
      const ok = await saveAddress(modal.id, addr, mLat, mLng)
      if (!ok) { setMErr('Échec de l\'enregistrement.'); return }
      setModal(null)
      await load(zoneRef.current, true)
    } catch { setMErr('Erreur réseau.') }
    finally { setMBusy(null) }
  }, [modal, mAddr, mLat, mLng, saveAddress, load])

  // Bouton "Relivrer maintenant" : sauve l'adresse PUIS crée la fiche REL.
  const onRelivrerNow = useCallback(async () => {
    if (!modal) return
    const addr = mAddr.trim()
    if (!addr) { setMErr('Adresse de relivraison requise.'); return }
    setMBusy('relivrer'); setMErr('')
    try {
      const ok = await saveAddress(modal.id, addr, mLat, mLng)
      if (!ok) { setMErr('Échec de l\'enregistrement de l\'adresse.'); return }
      const res = await fetch(`/api/missions/${modal.id}/relivrer`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMErr(j.error || 'Création de la relivraison échouée.'); return }
      setModal(null)
      await load(zoneRef.current, true)
    } catch { setMErr('Erreur réseau.') }
    finally { setMBusy(null) }
  }, [modal, mAddr, mLat, mLng, saveAddress, load])

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
                <div className="flex items-start justify-between gap-3 flex-wrap">
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
                    <span className="text-ink-faint text-xs mt-1 inline-block">VOIR la fiche →</span>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0 max-w-[60%]">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openModal(m) }}
                      className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold transition"
                    >
                      🔁 Relivraison
                    </button>
                    {/* Sous le bouton : adresse de relivraison connue, ou "En attente d'adresse" */}
                    {m.redelivery_address ? (
                      <p className="text-ink-secondary text-xs text-right leading-snug">📍 {m.redelivery_address}</p>
                    ) : (
                      <p className="text-amber-500 text-xs text-right font-medium">⏳ En attente d&apos;adresse</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* Modal relivraison : adresse pré-remplie + 2 actions */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => !mBusy && setModal(null)}>
          <div className="bg-surface w-full max-w-md rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-ink font-bold text-lg">🔁 Relivraison</h3>
              <p className="text-ink-muted text-sm mt-0.5">
                {modal.vehicle_plate || '—'}
                {[modal.vehicle_brand, modal.vehicle_model].filter(Boolean).join(' ') && ` · ${[modal.vehicle_brand, modal.vehicle_model].filter(Boolean).join(' ')}`}
                {modal.client_name ? ` · ${modal.client_name}` : ''}
              </p>
            </div>

            <div>
              <label className="block text-ink-secondary text-xs font-semibold mb-1.5">
                Adresse de relivraison {modal.redelivery_address ? '— confirme ou modifie' : '— à saisir'}
              </label>
              <AddressField
                value={mAddr}
                onChange={setMAddr}
                onSelect={(a, la, ln) => { setMAddr(a); setMLat(la); setMLng(ln) }}
                gmKey={GM_KEY}
                placeholder="Adresse où relivrer le véhicule"
              />
            </div>

            {mErr && <p className="text-red-400 text-sm">⚠ {mErr}</p>}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onRelivrerNow}
                disabled={!!mBusy || !mAddr.trim()}
                className="w-full py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-bold transition disabled:opacity-50"
              >
                {mBusy === 'relivrer' ? 'Création…' : '🚚 Relivrer maintenant'}
              </button>
              <button
                type="button"
                onClick={onSaveOnly}
                disabled={!!mBusy || !mAddr.trim()}
                className="w-full py-2.5 bg-surface-2 border text-ink rounded-xl text-sm font-semibold transition disabled:opacity-50"
              >
                {mBusy === 'save' ? 'Enregistrement…' : '💾 Enregistrer les modifications'}
              </button>
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={!!mBusy}
                className="w-full py-2 text-ink-muted text-sm disabled:opacity-50"
              >
                Annuler
              </button>
            </div>

            <p className="text-ink-faint text-xs">
              « Relivrer maintenant » enregistre l&apos;adresse <strong>et</strong> crée la fiche de relivraison prête à assigner. « Enregistrer les modifications » ne fait qu&apos;enregistrer l&apos;adresse.
            </p>
          </div>
        </div>
      )}
    </AppShell>
  )
}
