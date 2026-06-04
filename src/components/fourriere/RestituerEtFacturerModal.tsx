'use client'
// src/components/fourriere/RestituerEtFacturerModal.tsx
//
// Olivier 2026-06-04 : modal lance depuis VehicleFicheSheet -> bouton
// "Restituer et facturer". Flow :
//   1. Recherche client Odoo par nom
//   2. Sélection résultat OU création nouveau client
//   3. (Création) formulaire avec adresse Google Maps autocomplete
//   4. PATCH mission avec billed_to + infos client
//   5. POST force-status -> to_invoice
//   6. router.push('/facturation?q=<num>')
//
// Pas d obligation telephone (cf encaissement chauffeur).

import { useEffect, useRef, useState } from 'react'
import { X, Search, Plus, Loader2, Check, ArrowLeft, Receipt } from 'lucide-react'
import { createPortal } from 'react-dom'

interface OdooPartner {
  id:       number
  name:     string
  phone?:   string
  email?:   string
  street?:  string
  city?:    string
  zip?:     string
  address?: string
  vat?:     string
}

interface Mission {
  id:              string
  mission_number?: number | null
  external_id?:    string | null
  vehicle_plate?:  string | null
  client_name?:    string | null
  client_phone?:   string | null
  client_address?: string | null
  billed_to_id?:   number | null
  billed_to_name?: string | null
}

declare global {
  interface Window {
    google?: any
  }
}

export default function RestituerEtFacturerModal({ mission, onClose, onSuccess }: {
  mission:   Mission
  onClose:   () => void
  onSuccess: (redirectQ: string) => void
}) {
  type Step = 'search' | 'results' | 'create' | 'submitting'
  const [step, setStep] = useState<Step>('search')

  // Recherche
  const [searchName,  setSearchName]  = useState((mission.client_name || mission.billed_to_name || '').trim())
  const [searching,   setSearching]   = useState(false)
  const [results,     setResults]     = useState<OdooPartner[]>([])

  // Formulaire création
  const [createName,    setCreateName]    = useState('')
  const [createAddress, setCreateAddress] = useState((mission.client_address || ''))
  const [createStreet,  setCreateStreet]  = useState('')
  const [createCity,    setCreateCity]    = useState('')
  const [createZip,     setCreateZip]     = useState('')
  const [createCountry, setCreateCountry] = useState('BE')
  const [createPhone,   setCreatePhone]   = useState((mission.client_phone || ''))
  const [createEmail,   setCreateEmail]   = useState('')
  const [createVat,     setCreateVat]     = useState('')

  // Action final
  const [error,    setError]    = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // Autocomplete Google Maps
  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)

  // Escape ferme
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && step !== 'submitting') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [step, onClose])

  // Init Google Maps autocomplete sur le champ adresse (step=create)
  useEffect(() => {
    if (step !== 'create') return
    autocompleteRef.current = null
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const setupComponents = (place: any) => {
      const c = place.address_components || []
      const get = (t: string) => c.find((x: any) => x.types.includes(t))?.long_name || ''
      const getS = (t: string) => c.find((x: any) => x.types.includes(t))?.short_name || ''
      const num = get('street_number'); const box = get('subpremise')
      const route = get('route')
      setCreateStreet([route, num + (box ? `/${box}` : '')].filter(Boolean).join(' ').trim())
      setCreateZip(get('postal_code'))
      setCreateCity(get('locality') || get('postal_town'))
      setCreateCountry(getS('country') || 'BE')
      if (place?.formatted_address) setCreateAddress(place.formatted_address)
    }

    const tryInit = () => {
      if (cancelled) return false
      if (!addressInputRef.current) return false
      if (!window.google?.maps?.places) return false
      if (autocompleteRef.current) return true
      autocompleteRef.current = new window.google.maps.places.Autocomplete(addressInputRef.current, {
        types: ['address'],
        componentRestrictions: { country: ['be', 'fr', 'de', 'nl', 'lu'] },
      })
      autocompleteRef.current.addListener('place_changed', () => {
        const p = autocompleteRef.current.getPlace()
        if (p) setupComponents(p)
      })
      return true
    }

    if (!tryInit()) {
      let attempts = 0
      interval = setInterval(() => {
        attempts++
        if (tryInit() || attempts > 50) {
          if (interval) { clearInterval(interval); interval = null }
        }
      }, 200)
    }

    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [step])

  async function doSearch() {
    if (!searchName.trim()) return
    setSearching(true)
    setError(null)
    try {
      // Recherche directe + nom inversé pour rattraper les "Prénom Nom" / "Nom Prénom"
      const inverted = searchName.trim().split(' ').length > 1
        ? [...searchName.trim().split(' ').slice(1), searchName.trim().split(' ')[0]].join(' ')
        : searchName.trim()

      const all: OdooPartner[] = []
      for (const n of Array.from(new Set([searchName.trim(), inverted]))) {
        const r = await fetch(`/api/partners?name=${encodeURIComponent(n)}`)
        const j = await r.json()
        if (j.found && !all.find(p => p.id === j.partner.id)) {
          all.push(j.partner)
        }
      }
      setResults(all)
      setStep(all.length > 0 ? 'results' : 'create')
      if (all.length === 0) setCreateName(searchName.trim())
    } catch (e: any) {
      setError(`Recherche KO : ${e?.message || e}`)
    } finally {
      setSearching(false)
    }
  }

  async function selectPartner(p: OdooPartner) {
    setStep('submitting')
    setActionMsg('Mise à jour de la fiche...')
    setError(null)
    try {
      // 1. PATCH mission avec infos client
      const patchRes = await fetch(`/api/missions/${mission.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          billed_to_id:   p.id,
          billed_to_name: p.name,
          client_name:    p.name,
          client_phone:   p.phone || null,
          client_address: p.address || [p.street, p.zip, p.city].filter(Boolean).join(', ') || null,
        }),
      })
      if (!patchRes.ok) {
        const j = await patchRes.json().catch(() => ({}))
        setError(`Update mission KO : ${j.error || patchRes.status}`)
        setStep('results')
        return
      }

      // 2. force-status to_invoice
      setActionMsg('Clôture forcée en "À facturer"...')
      const forceRes = await fetch(`/api/missions/${mission.id}/force-status`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'to_invoice' }),
      })
      if (!forceRes.ok) {
        const j = await forceRes.json().catch(() => ({}))
        setError(`Force status KO : ${j.error || forceRes.status}`)
        setStep('results')
        return
      }

      // 3. Redirige
      const q = mission.mission_number != null ? String(mission.mission_number) : (mission.external_id || mission.id)
      onSuccess(q)
    } catch (e: any) {
      setError(`Erreur réseau : ${e?.message || e}`)
      setStep('results')
    }
  }

  async function createAndSelect() {
    if (!createName.trim()) { setError('Nom requis'); return }
    setStep('submitting')
    setActionMsg('Création du client dans Odoo...')
    setError(null)
    try {
      const createRes = await fetch('/api/odoo/create-client', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:    createName.trim(),
          street:  createStreet || createAddress,
          city:    createCity,
          zip:     createZip,
          phone:   createPhone || undefined,
          email:   createEmail || undefined,
          vat:     createVat || undefined,
          is_company: false,
        }),
      })
      const j = await createRes.json()
      if (!createRes.ok || !j.partner) {
        setError(`Création client KO : ${j.error || createRes.status}`)
        setStep('create')
        return
      }
      // Continue avec le client créé
      await selectPartner({
        ...j.partner,
        address: createAddress || [createStreet, createZip, createCity].filter(Boolean).join(', '),
      })
    } catch (e: any) {
      setError(`Erreur réseau : ${e?.message || e}`)
      setStep('create')
    }
  }

  if (typeof window === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => { if (step !== 'submitting') onClose() }}>
      <div className="bg-surface border rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>

        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-surface z-10">
          <h2 className="font-display text-lg font-bold text-ink flex items-center gap-2">
            <Receipt size={18} className="text-emerald-600" />
            Restituer et facturer
          </h2>
          {step !== 'submitting' && (
            <button onClick={onClose} className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-hover rounded transition">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-surface-2 border rounded-lg p-3 text-xs text-ink-secondary">
            Mission <b className="text-ink font-mono">#{mission.mission_number || mission.id.slice(0, 8)}</b>
            {mission.vehicle_plate && <> · Plaque <b className="text-ink font-mono">{mission.vehicle_plate}</b></>}
          </div>

          {step === 'search' && (
            <>
              <p className="text-xs text-ink-muted">Recherche le client par nom dans Odoo (nom et prénom inversés sont aussi essayés).</p>
              <div>
                <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
                  Nom du client
                </label>
                <input
                  value={searchName}
                  onChange={e => setSearchName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doSearch() }}
                  placeholder="Ex : Herman Olivier, Garage Truc..."
                  autoFocus
                  className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
                />
              </div>
              <button onClick={doSearch} disabled={searching || !searchName.trim()}
                className="w-full py-2.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                {searching ? 'Recherche...' : 'Rechercher dans Odoo'}
              </button>
              <button onClick={() => { setCreateName(searchName.trim()); setStep('create') }}
                className="w-full py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2">
                <Plus size={14} /> Créer directement un nouveau client
              </button>
            </>
          )}

          {step === 'results' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-muted">
                  {results.length} correspondance{results.length > 1 ? 's' : ''} pour "{searchName}"
                </p>
                <button onClick={() => setStep('search')} className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">
                  <ArrowLeft size={12} /> Modifier
                </button>
              </div>
              <div className="space-y-2">
                {results.map(p => (
                  <button key={p.id} onClick={() => selectPartner(p)}
                    className="w-full text-left bg-surface-2 border hover:border-brand rounded-lg p-3 transition active:scale-95">
                    <p className="text-ink font-semibold text-sm">{p.name}</p>
                    {p.phone && <p className="text-ink-muted text-xs mt-0.5">{p.phone}</p>}
                    {(p.address || p.street) && <p className="text-ink-muted text-xs mt-0.5 truncate">{p.address || `${p.street}, ${p.zip} ${p.city}`}</p>}
                    {p.vat && <p className="text-ink-muted text-xs mt-0.5">{p.vat}</p>}
                  </button>
                ))}
                <button onClick={() => { setCreateName(searchName.trim()); setStep('create') }}
                  className="w-full bg-surface-2 border border-dashed text-ink-secondary hover:text-ink rounded-lg p-3 text-sm font-medium text-center transition active:scale-95">
                  <Plus size={14} className="inline mr-1" /> Aucun de ces clients — créer un nouveau
                </button>
              </div>
            </>
          )}

          {step === 'create' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Nouveau client</p>
                <button onClick={() => setStep('search')} className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">
                  <ArrowLeft size={12} /> Retour
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">Nom *</label>
                  <input value={createName} onChange={e => setCreateName(e.target.value)} autoFocus
                    placeholder="Nom et prénom ou société"
                    className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
                    Adresse <span className="text-ink-faint">(Google Maps)</span>
                  </label>
                  <input ref={addressInputRef} value={createAddress} onChange={e => setCreateAddress(e.target.value)}
                    placeholder="Tape pour suggestions Google Maps"
                    className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                  {(createStreet || createZip || createCity) && (
                    <p className="text-xs text-ink-muted mt-1">
                      ↳ {[createStreet, createZip, createCity].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
                      Téléphone <span className="text-ink-faint">(opt)</span>
                    </label>
                    <input value={createPhone} onChange={e => setCreatePhone(e.target.value)} type="tel"
                      placeholder="+32 4xx xxx xxx"
                      className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
                      Email <span className="text-ink-faint">(opt)</span>
                    </label>
                    <input value={createEmail} onChange={e => setCreateEmail(e.target.value)} type="email"
                      placeholder="client@email.com"
                      className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1 block">
                    TVA <span className="text-ink-faint">(opt)</span>
                  </label>
                  <input value={createVat} onChange={e => setCreateVat(e.target.value)}
                    placeholder="BE0123.456.789"
                    className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                </div>
              </div>
              <button onClick={createAndSelect} disabled={!createName.trim()}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
                <Check size={14} /> Créer le client et facturer
              </button>
            </>
          )}

          {step === 'submitting' && (
            <div className="py-8 text-center text-ink-muted text-sm">
              <Loader2 size={28} className="mx-auto animate-spin mb-3 text-brand" />
              {actionMsg || 'Traitement...'}
            </div>
          )}

          {error && (
            <div className="bg-critical/10 border border-critical/40 rounded-lg px-3 py-2 text-critical text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
