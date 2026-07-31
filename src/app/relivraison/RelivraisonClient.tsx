'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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
  garage_reopen_date?: string | null
}

interface ZoneTab { key: string; label: string; count: number }

export default function RelivraisonClient({ userRole, userName, userEmail, userModules, sources }: {
  userRole:    string
  userName:    string
  userEmail?:  string
  userModules: string[]
  sources:     SourceDisplay[]
}) {
  const router = useRouter()
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
  const [mSourceOverride, setMSourceOverride] = useState('')
  const [mImposedHtva, setMImposedHtva] = useState('')   // montant HTVA imposé si source REL = Privé

  // Bascule de source REL : une relivraison SIABIS (couvert/non couvert) doit être
  // facturée à l'assistance qui reprend → choix obligatoire. Olivier 2026-07-06.
  const mPs = (modal?.source || '').toLowerCase()
  // police_accident : la relivraison ne peut PAS rester « Police - Accident » →
  // choix de source obligatoire (Repris par). Olivier 2026-07-31.
  const mRequiresSource = mPs === 'sia_couvert' || mPs === 'police_snc' || mPs === 'police_accident'
  const mAllowsSource   = mRequiresSource || mPs === 'prive'
  const mNonAssist = new Set(['police_mg', 'police_rodeo', 'police_avp', 'police_saisie', 'police_snc', 'sia_couvert', 'unknown'])
  const mAssistSources = sources.filter(s => { const k = (s.key || '').toLowerCase(); return k && k !== mPs && !mNonAssist.has(k) })

  const zoneRef = useRef(zone)
  useEffect(() => { zoneRef.current = zone }, [zone])
  const [moving, setMoving] = useState<string | null>(null)

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

  // Déplacement manuel d'un véhicule entre sous-parcs de relivraison (K ↔ K1).
  const moveZone = useCallback(async (id: string, target: string) => {
    setMoving(id)
    try {
      const res = await fetch('/api/relivraison/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: id, zone: target }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      await load(zoneRef.current, true)
    } catch (e: any) {
      alert(e.message || 'Déplacement impossible')
    } finally {
      setMoving(null)
    }
  }, [load])

  // Ouvre le modal de relivraison (adresse pré-remplie si connue).
  const openModal = useCallback((m: Mission) => {
    setModal(m)
    setMAddr(m.redelivery_address || '')
    setMLat(m.redelivery_lat)
    setMLng(m.redelivery_lng)
    setMSourceOverride(''); setMImposedHtva('')
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
    if (mRequiresSource && !mSourceOverride) { setMErr('Choisis par qui la relivraison est reprise.'); return }
    const imposed = mSourceOverride === 'prive' ? Number(String(mImposedHtva).replace(',', '.')) : null
    if (mSourceOverride === 'prive' && (!imposed || imposed <= 0)) { setMErr('Indique le montant HTVA de la relivraison (Privé).'); return }
    setMBusy('relivrer'); setMErr('')
    try {
      const ok = await saveAddress(modal.id, addr, mLat, mLng)
      if (!ok) { setMErr('Échec de l\'enregistrement de l\'adresse.'); return }
      const res = await fetch(`/api/missions/${modal.id}/relivrer`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ source_override: mSourceOverride || null, imposed_htva: imposed }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMErr(j.error || 'Création de la relivraison échouée.'); return }
      setModal(null)
      // « Maintenant » = intention immédiate : on ouvre direct la fiche REL avec
      // le sélecteur de chauffeur (?assign=1) pour assigner dans la foulée.
      if (j.mission_id) {
        router.push(`/dispatch/${j.mission_id}?assign=1`)
        return   // on garde mBusy pour éviter un double clic pendant la navigation
      }
      await load(zoneRef.current, true)
    } catch { setMErr('Erreur réseau.') }
    finally { setMBusy(null) }
  }, [modal, mAddr, mLat, mLng, mSourceOverride, mImposedHtva, mRequiresSource, saveAddress, load, router])

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
                      {m.garage_reopen_date && (() => {
                        const d = new Date(m.garage_reopen_date + 'T00:00:00')
                        const today = new Date(); today.setHours(0, 0, 0, 0)
                        const due = d <= today
                        return (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${due ? 'bg-red-500/20 text-red-600 border border-red-500/40' : 'bg-amber-500/15 text-amber-600 border border-amber-500/30'}`}>
                            🔒 {due ? 'ROUVERT' : `rouvre ${d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })}`}
                          </span>
                        )
                      })()}
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
                    {/* Déplacer entre K (relivraison) et K1 (en attente d'adresse) */}
                    {(zone === 'K' || zone === 'K1') && (
                      <button
                        type="button"
                        disabled={moving === m.id}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveZone(m.id, zone === 'K1' ? 'K' : 'K1') }}
                        className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-xs font-medium transition disabled:opacity-50"
                      >
                        {moving === m.id ? '⏳' : zone === 'K1' ? '→ Relivraison' : '⏳ En attente'}
                      </button>
                    )}
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
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
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

            {mAllowsSource && (
              <div>
                <label className="block text-ink-secondary text-xs font-semibold mb-1.5">
                  Repris par {mRequiresSource ? <span className="text-red-500">*</span> : <span className="text-ink-faint font-normal">(optionnel)</span>}
                </label>
                <select
                  value={mSourceOverride}
                  onChange={e => setMSourceOverride(e.target.value)}
                  className={`w-full px-3 py-2.5 bg-surface border rounded-xl text-sm text-ink ${mRequiresSource && !mSourceOverride ? 'border-red-400' : ''}`}
                >
                  <option value="">{mRequiresSource ? '— Choisir par qui c\'est repris —' : '— Garder la source d\'origine —'}</option>
                  {mAssistSources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <p className="text-ink-faint text-xs mt-1">
                  La fiche d&apos;origine garde son tarif calculé ; seule la relivraison (REL) est facturée à ce repreneur.
                </p>
                {mSourceOverride === 'prive' && (
                  <div className="mt-2">
                    <label className="block text-ink-secondary text-xs font-semibold mb-1.5">
                      Montant HTVA de la relivraison (Privé) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number" step="0.01" min="0" inputMode="decimal"
                        value={mImposedHtva}
                        onChange={e => setMImposedHtva(e.target.value)}
                        placeholder="ex. 125.00"
                        className={`w-full px-3 py-2.5 bg-surface border rounded-xl text-sm text-ink ${!mImposedHtva ? 'border-red-400' : ''}`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint text-xs">€ HTVA</span>
                    </div>
                    <p className="text-ink-faint text-xs mt-1">Montant imposé pour la relivraison privée (tarif spécial).</p>
                  </div>
                )}
              </div>
            )}

            {mErr && <p className="text-red-400 text-sm">⚠ {mErr}</p>}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onRelivrerNow}
                disabled={!!mBusy || !mAddr.trim() || (mRequiresSource && !mSourceOverride) || (mSourceOverride === 'prive' && !(Number(String(mImposedHtva).replace(',', '.')) > 0))}
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
                {mBusy === 'save' ? 'Enregistrement…' : '🕒 Relivrer plus tard'}
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
              « Relivrer maintenant » enregistre l&apos;adresse <strong>et</strong> crée la fiche de relivraison prête à assigner. « Relivrer plus tard » enregistre seulement l&apos;adresse (le véhicule reste dans la file).
            </p>
          </div>
        </div>
      )}
    </AppShell>
  )
}
