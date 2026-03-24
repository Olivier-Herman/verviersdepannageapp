// src/app/services/tgr/TGRClient.tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter }  from 'next/navigation'
import AppShell       from '@/components/layout/AppShell'
import Image          from 'next/image'

// ── Types ──────────────────────────────────────────────────
interface Brand  { id: number; name: string }
interface VehicleMatch { id: number; plate: string; brand_text?: string; model_text?: string }

const PRIORITY_OPTIONS = [
  { value: 1, label: 'Priorité 1',  sub: 'Arval + Mercedes — J+1 ouvrable avant midi',      color: 'text-red-400' },
  { value: 2, label: 'Priorité 2',  sub: 'Autres contrats — J+1 ouvrable dans la journée',   color: 'text-orange-400' },
  { value: 3, label: 'Priorité 3',  sub: 'Dès que possible',                                  color: 'text-green-400' },
]

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: '⏳ En attente',  color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  accepted:  { label: '✅ Acceptée',    color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30'  },
  refused:   { label: '❌ Refusée',     color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30'      },
  taken:     { label: '🤝 Reprise',     color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30'    },
  completed: { label: '✔️ Terminée',    color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/30'    },
}

type TGRView = 'list' | 'new'

// ── Hook Google Places Autocomplete ───────────────────────
function useGooglePlaces(inputRef: React.RefObject<HTMLInputElement>, onSelect: (address: string) => void) {
  useEffect(() => {
    if (!inputRef.current) return
    const input = inputRef.current

    const initAutocomplete = () => {
      if (!(window as any).google?.maps?.places) return
      const ac = new (window as any).google.maps.places.Autocomplete(input, {
        types: ['address'],
        componentRestrictions: { country: ['be', 'nl', 'fr', 'de', 'lu'] },
      })
      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        if (place?.formatted_address) onSelect(place.formatted_address)
      })
    }

    if ((window as any).google?.maps?.places) {
      initAutocomplete()
    } else {
      // Charger le script si pas encore chargé
      const existingScript = document.getElementById('google-places-script')
      if (!existingScript) {
        const script = document.createElement('script')
        script.id  = 'google-places-script'
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`
        script.async = true
        script.onload = initAutocomplete
        document.head.appendChild(script)
      } else {
        existingScript.addEventListener('load', initAutocomplete)
      }
    }
  }, [inputRef, onSelect])
}

// ── Composant principal ────────────────────────────────────
export default function TGRClient({ user }: { user: any }) {
  const router   = useRouter()
  const userRole = (user as any)?.role ?? 'partner'
  const userName = user?.name ?? ''
  const isAdmin  = ['admin', 'superadmin', 'dispatcher'].includes(userRole)

  const [view,       setView]      = useState<TGRView>('list')
  const [missions,   setMissions]  = useState<any[]>([])
  const [loading,    setLoading]   = useState(true)
  const [selected,   setSelected]  = useState<any | null>(null)
  const [submitting, setSubmitting]= useState(false)
  const [error,      setError]     = useState<string | null>(null)
  const [success,    setSuccess]   = useState(false)

  // Form state
  const [reference,       setReference]       = useState('')
  const [plate,           setPlate]           = useState('')
  const [plateSearching,  setPlateSearching]  = useState(false)
  const [vehicleMatch,    setVehicleMatch]    = useState<VehicleMatch | null>(null)
  const [brand,           setBrand]           = useState('')
  const [model,           setModel]           = useState('')
  const [brands,          setBrands]          = useState<Brand[]>([])
  const [models,          setModels]          = useState<Brand[]>([])
  const [loadingBrands,   setLoadingBrands]   = useState(false)
  const [isRolling,       setIsRolling]       = useState(true)
  const [pickupAddress,   setPickupAddress]   = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [priority,        setPriority]        = useState<1|2|3>(2)
  const [remarks,         setRemarks]         = useState('')

  const pickupRef   = useRef<HTMLInputElement>(null)
  const deliveryRef = useRef<HTMLInputElement>(null)

  // Google Places hooks
  useGooglePlaces(pickupRef,   useCallback((addr) => setPickupAddress(addr),   []))
  useGooglePlaces(deliveryRef, useCallback((addr) => setDeliveryAddress(addr), []))

  const loadMissions = () => {
    setLoading(true)
    fetch('/api/tgr')
      .then(r => r.json())
      .then(data => { setMissions(data || []); setLoading(false) })
  }

  useEffect(() => { loadMissions() }, [])

  // Recherche plaque
  const handlePlateLookup = async () => {
    const normalized = plate.replace(/[-.\s]/g, '').toUpperCase().trim()
    if (!normalized) return
    setPlateSearching(true)
    try {
      const res  = await fetch(`/api/advances/lookup?plate=${encodeURIComponent(normalized)}`)
      const data = await res.json()
      if (data.found) {
        setVehicleMatch(data)
        // Pré-remplir marque/modèle si disponible
        if (data.brand_text) setBrand(data.brand_text)
        if (data.model_text) setModel(data.model_text)
      } else {
        setVehicleMatch(null)
      }
    } catch { setVehicleMatch(null) }
    finally  { setPlateSearching(false) }
  }

  // Charger les marques
  const loadBrands = async () => {
    if (brands.length > 0) return
    setLoadingBrands(true)
    try {
      const res = await fetch('/api/vehicles?type=brands')
      setBrands(await res.json() || [])
    } finally { setLoadingBrands(false) }
  }

  // Charger les modèles
  const loadModels = async (brandId: number) => {
    setModels([])
    const res = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
    setModels(await res.json() || [])
  }

  const handleSubmit = async () => {
    if (!plate || !brand || !model || !pickupAddress || !deliveryAddress) {
      setError('Veuillez remplir tous les champs obligatoires')
      return
    }
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/tgr', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference:       reference.trim() || undefined,
          plate:           plate.replace(/[-.\s]/g, '').toUpperCase().trim(),
          brand,
          model,
          isRolling,
          pickupAddress,
          deliveryAddress,
          priority,
          remarks: remarks || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(true)
      loadMissions()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setReference(''); setPlate(''); setBrand(''); setModel('')
    setVehicleMatch(null); setIsRolling(true)
    setPickupAddress(''); setDeliveryAddress('')
    setPriority(2); setRemarks(''); setError(null); setSuccess(false)
    setView('list')
  }

  // ── LISTE ─────────────────────────────────────────────────
  if (view === 'list') return (
    <AppShell title="TGR Touring" userRole={userRole} userName={userName}>
      <div className="px-4 lg:px-8 py-6 max-w-4xl">

        {/* Header Touring */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <img src="/logo-touring.png" alt="Touring" className="h-8 w-auto object-contain" />
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <div>
              <p className="text-white font-semibold text-sm">Transport & Remorquage</p>
              <p className="text-zinc-500 text-xs">{missions.length} mission{missions.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={() => setView('new')}
            className="px-4 py-2 bg-brand text-white rounded-xl font-semibold text-sm hover:bg-brand/90">
            + Nouvelle mission
          </button>
        </div>

        {loading ? (
          <p className="text-zinc-500 text-sm text-center py-8">Chargement…</p>
        ) : missions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🚗</p>
            <p className="text-white font-medium mb-1">Aucune mission</p>
            <p className="text-zinc-600 text-sm">Cliquez sur + pour soumettre une nouvelle mission TGR</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {missions.map(m => {
              const cfg = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.pending
              const pri = PRIORITY_OPTIONS.find(p => p.value === m.priority)
              return (
                <button key={m.id} onClick={() => setSelected(m)}
                  className={`w-full bg-[#1A1A1A] border rounded-2xl p-4 text-left
                               hover:border-brand transition-all ${cfg.bg}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-white font-bold font-mono">{m.reference}</p>
                      <p className="text-zinc-400 text-sm">{m.plate} — {m.brand} {m.model}</p>
                    </div>
                    <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-600 mt-1">
                    <span className="truncate max-w-[70%]">{m.pickup_address?.split(',')[0]} → {m.delivery_address?.split(',')[0]}</span>
                    <span className={pri?.color}>{pri?.label}</span>
                  </div>
                  {isAdmin && m.partner && (
                    <p className="text-zinc-600 text-xs mt-1">Demandeur : {m.partner.name}</p>
                  )}
                  {m.distance_km && (
                    <p className="text-zinc-600 text-xs mt-0.5">{m.distance_km} km</p>
                  )}
                  <p className="text-zinc-700 text-xs mt-1">
                    {new Date(m.created_at).toLocaleDateString('fr-BE')}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <MissionModal mission={selected} isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onRefresh={() => { loadMissions(); setSelected(null) }} />
      )}
    </AppShell>
  )

  // ── SUCCÈS ─────────────────────────────────────────────────
  if (success) return (
    <AppShell title="Mission soumise" userRole={userRole} userName={userName}>
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center gap-6 max-w-md mx-auto">
        <div className="text-7xl">✅</div>
        <img src="/logo-touring.png" alt="Touring" className="h-6 w-auto opacity-60" />
        <div>
          <h2 className="text-white font-bold text-xl mb-2">Mission soumise !</h2>
          <p className="text-zinc-400 text-sm">
            Votre demande TGR a été transmise à Verviers Dépannage.
            Vous serez notifié dès qu'elle sera traitée.
          </p>
        </div>
        <button onClick={resetForm}
          className="w-full max-w-xs py-3 bg-brand text-white rounded-xl font-semibold">
          Retour aux missions
        </button>
      </div>
    </AppShell>
  )

  // ── FORMULAIRE ─────────────────────────────────────────────
  return (
    <AppShell title="Nouvelle mission TGR" userRole={userRole} userName={userName}>
      <div className="lg:hidden px-4 pt-3 pb-1">
        <button onClick={() => setView('list')} className="text-zinc-400 hover:text-white text-sm">← Retour</button>
      </div>
      <div className="px-4 lg:px-8 py-4 max-w-xl flex flex-col gap-5 pb-10">

        {/* Logo Touring */}
        <div className="flex items-center gap-3 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3">
          <img src="/logo-touring.png" alt="Touring" className="h-7 w-auto object-contain" />
          <div className="w-px h-6 bg-[#2a2a2a]" />
          <p className="text-zinc-400 text-xs">Transport & Remorquage — Nouvelle mission</p>
        </div>

        {/* Référence dossier */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">
            Référence dossier Touring{' '}
            <span className="text-zinc-600">(ex: 2026BE131221 — optionnel)</span>
          </label>
          <input type="text" placeholder="2026BE131221" value={reference}
            onChange={e => setReference(e.target.value.toUpperCase())}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3
                       text-white font-mono placeholder-zinc-700 focus:outline-none focus:border-brand" />
          <p className="text-zinc-600 text-xs mt-1">
            Si vide, l'immatriculation sera utilisée comme référence sur le devis
          </p>
        </div>

        {/* Véhicule */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest">Véhicule</p>

          {/* Plaque + lookup */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Immatriculation *</label>
            <div className="flex gap-2">
              <input type="text" autoCapitalize="characters" placeholder="1ABC234"
                value={plate} onChange={e => { setPlate(e.target.value.toUpperCase()); setVehicleMatch(null) }}
                onBlur={handlePlateLookup}
                className="flex-1 bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-2.5
                           text-white font-mono tracking-widest placeholder-zinc-700
                           focus:outline-none focus:border-brand" />
              <button onClick={handlePlateLookup} disabled={plateSearching || !plate.trim()}
                className="px-3 py-2.5 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm hover:bg-[#333] disabled:opacity-40">
                {plateSearching ? '⏳' : '🔍'}
              </button>
            </div>
          </div>

          {/* Véhicule trouvé */}
          {vehicleMatch && (
            <div className="bg-green-900/20 border border-green-800 rounded-xl px-3 py-2 flex items-center gap-2">
              <span className="text-green-400 text-sm">✅</span>
              <p className="text-green-300 text-xs">
                Véhicule trouvé : <strong>{vehicleMatch.brand_text} {vehicleMatch.model_text}</strong>
              </p>
            </div>
          )}

          {/* Marque */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Marque *</label>
            {loadingBrands ? (
              <p className="text-zinc-600 text-xs">Chargement…</p>
            ) : (
              <div className="flex gap-2">
                <select value={brand}
                  onChange={e => {
                    setBrand(e.target.value)
                    setModel('')
                    const b = brands.find(b => b.name === e.target.value)
                    if (b) loadModels(b.id)
                  }}
                  onFocus={loadBrands}
                  className="flex-1 bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-2.5
                             text-white text-sm outline-none appearance-none focus:border-brand">
                  <option value="">Sélectionner une marque…</option>
                  {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                </select>
                {!brands.length && (
                  <button onClick={loadBrands}
                    className="px-3 py-2.5 bg-[#2a2a2a] text-zinc-400 rounded-xl text-xs hover:bg-[#333]">
                    Charger
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Modèle */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Modèle *</label>
            {models.length > 0 ? (
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-2.5
                           text-white text-sm outline-none appearance-none focus:border-brand">
                <option value="">Sélectionner un modèle…</option>
                {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            ) : (
              <input type="text" placeholder="Ex: Série 5 / Classe C"
                value={model} onChange={e => setModel(e.target.value)}
                className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-2.5
                           text-white placeholder-zinc-700 focus:outline-none focus:border-brand" />
            )}
          </div>

          {/* Roulant */}
          <div>
            <label className="block text-xs text-zinc-500 mb-2">État du véhicule *</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setIsRolling(true)}
                className={`py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isRolling ? 'bg-green-700 text-white' : 'bg-[#0F0F0F] border border-[#333] text-zinc-400'
                }`}>
                🟢 Roulant
              </button>
              <button onClick={() => setIsRolling(false)}
                className={`py-2.5 rounded-xl text-sm font-medium transition-all ${
                  !isRolling ? 'bg-red-900 text-white' : 'bg-[#0F0F0F] border border-[#333] text-zinc-400'
                }`}>
                🔴 Non roulant
              </button>
            </div>
          </div>
        </div>

        {/* Adresses avec Google Places */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Adresse de pick-up *</label>
            <input ref={pickupRef} type="text" placeholder="Rue, ville, pays"
              value={pickupAddress}
              onChange={e => setPickupAddress(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3
                         text-white placeholder-zinc-700 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Adresse de livraison *</label>
            <input ref={deliveryRef} type="text" placeholder="Rue, ville, pays"
              value={deliveryAddress}
              onChange={e => setDeliveryAddress(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3
                         text-white placeholder-zinc-700 focus:outline-none focus:border-brand" />
          </div>
        </div>

        {/* Priorité */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">Priorité *</label>
          <div className="flex flex-col gap-2">
            {PRIORITY_OPTIONS.map(p => (
              <button key={p.value} onClick={() => setPriority(p.value as 1|2|3)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  priority === p.value
                    ? 'bg-brand/10 border-brand text-white'
                    : 'bg-[#1A1A1A] border-[#2a2a2a] text-zinc-300 hover:border-zinc-500'
                }`}>
                <p className={`font-semibold text-sm ${priority === p.value ? 'text-white' : p.color}`}>
                  {p.label}
                </p>
                <p className="text-zinc-500 text-xs mt-0.5">{p.sub}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Remarques */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">
            Remarques <span className="text-zinc-600">(optionnel)</span>
          </label>
          <textarea rows={3}
            placeholder="Spécificités, clés dans le véhicule, code portail, accès particulier…"
            value={remarks} onChange={e => setRemarks(e.target.value)}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3
                       text-white placeholder-zinc-700 focus:outline-none focus:border-brand resize-none" />
        </div>

        {error && (
          <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl p-3 text-sm">
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={submitting}
          className="w-full py-4 bg-brand hover:bg-brand/90 disabled:bg-zinc-800
                     text-white rounded-2xl font-bold text-lg transition-colors">
          {submitting
            ? <span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Envoi…</span>
            : '📤 Soumettre la mission TGR'}
        </button>
      </div>
    </AppShell>
  )
}

// ── Modal détail mission ───────────────────────────────────
function MissionModal({
  mission, isAdmin, onClose, onRefresh
}: {
  mission: any; isAdmin: boolean; onClose: () => void; onRefresh: () => void
}) {
  const [acting, setActing] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const cfg = STATUS_CONFIG[mission.status] ?? STATUS_CONFIG.pending
  const pri = PRIORITY_OPTIONS.find(p => p.value === mission.priority)

  const deadlineStr = mission.deadline_date
    ? `${new Date(mission.deadline_date).toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long' })} ${
        mission.deadline_slot === 'before_noon' ? 'avant midi' :
        mission.deadline_slot === 'during_day'  ? 'dans la journée' : ''
      }`
    : 'Dès que possible'

  const doAction = async (action: 'accept' | 'refuse') => {
    setActing(true); setError(null)
    try {
      const res  = await fetch(`/api/tgr/${mission.id}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onRefresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end lg:items-center lg:justify-center"
      onClick={onClose}>
      <div className="bg-[#1A1A1A] w-full lg:max-w-lg rounded-t-3xl lg:rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <img src="/logo-touring.png" alt="Touring" className="h-4 w-auto opacity-70" />
            </div>
            <h2 className="text-white font-bold text-lg font-mono">{mission.reference}</h2>
            <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 text-2xl">×</button>
        </div>

        <div className="space-y-2 mb-5">
          {[
            ['Véhicule',    `${mission.plate} — ${mission.brand} ${mission.model}`],
            ['État',        mission.is_rolling ? '🟢 Roulant' : '🔴 Non roulant'],
            ['Pick-up',     mission.pickup_address],
            ['Livraison',   mission.delivery_address],
            ['Distance',    mission.distance_km ? `${mission.distance_km} km` : null],
            ['Priorité',    pri?.label + ' — ' + pri?.sub],
            ['Deadline',    deadlineStr],
            ['Demandeur',   mission.partner?.name],
            ['Accepté par', mission.acceptedBy?.name],
            ['Repris par',  mission.taken_by_name],
            ['Devis',       mission.odoo_quote_name],
            ['Remarques',   mission.remarks],
            ['Date',        new Date(mission.created_at).toLocaleString('fr-BE')],
          ].filter(r => r[1]).map(([label, value]) => (
            <div key={label as string} className="flex justify-between py-2 border-b border-[#2a2a2a]">
              <span className="text-zinc-500 text-sm flex-shrink-0">{label}</span>
              <span className="text-white text-sm text-right max-w-[60%]">{value}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl p-3 text-sm mb-4">{error}</div>
        )}

        {isAdmin && mission.status === 'pending' && (
          <div className="flex gap-2">
            <button onClick={() => doAction('refuse')} disabled={acting}
              className="flex-1 py-3 bg-red-900/40 border border-red-800 text-red-300 rounded-xl font-medium text-sm disabled:opacity-50">
              {acting ? '…' : '❌ Refuser'}
            </button>
            <button onClick={() => doAction('accept')} disabled={acting}
              className="flex-1 py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
              {acting ? '…' : '✅ Accepter'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
