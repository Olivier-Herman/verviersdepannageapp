'use client'

import { useState, useEffect, useRef }    from 'react'
import { useRouter }   from 'next/navigation'
import Link            from 'next/link'
import { signOut }     from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { DriverTimeline } from '@/components/missions/DriverTimeline'
import AddressField from '@/components/AddressField'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  external_id: string
  dossier_number: string | null
  source: string
  source_format: string
  mission_type: string | null
  incident_type: string | null
  incident_description: string | null
  client_name: string | null
  client_phone: string | null
  client_address: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_vin: string | null
  vehicle_fuel: string | null
  vehicle_gearbox: string | null
  incident_address: string | null
  incident_city: string | null
  incident_country: string
  incident_lat: number | null
  incident_lng: number | null
  destination_name: string | null
  destination_address: string | null
  amount_guaranteed: number | null
  amount_currency: string
  amount_to_collect: number | null
  vehicle_mileage: number | null
  driver_photos: string[] | null
  discharge_data: { motif: string; name: string; sig: string }[] | null
  discharge_motif: string | null
  discharge_name: string | null
  discharge_sig: string | null
  client_signature: string | null
  client_signature_name: string | null
  closing_notes: string | null
  payment_method: string | null
  odoo_helpdesk_id: number | null
  odoo_task_id: number | null
  odoo_ticket_url: string | null
  odoo_task_url: string | null
  amount_collected: number | null
  incident_at: string | null
  received_at: string
  status: string
  dispatch_mode: string
  assigned_to: string | null
  assigned_at: string | null
  assigned_user: { id: string; name: string; phone?: string } | null
  accepted_at: string | null
  on_way_at: string | null
  on_site_at: string | null
  completed_at: string | null
  parse_confidence: number | null
  raw_content: string | null
  billed_to_name: string | null
  billed_to_id: number | null
  assisted_name: string | null
  assisted_phone: string | null
}

interface MissionLog {
  id: string
  action: string
  notes: string | null
  created_at: string
  actor: { name: string } | null
}

interface Driver {
  id: string
  name: string
  avatar_url: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  touring:  { label: 'TOURING',  color: 'bg-blue-600' },
  ethias:   { label: 'ETHIAS',   color: 'bg-green-600' },
  vivium:   { label: 'VIVIUM',   color: 'bg-purple-600' },
  axa:      { label: 'IPA',      color: 'bg-red-600' },
  ardenne:  { label: 'ARDENNE (IPA)', color: 'bg-orange-600' },
  mondial:  { label: 'MONDIAL',  color: 'bg-teal-600' },
  vab:      { label: 'VAB',      color: 'bg-yellow-600' },
  police:   { label: 'POLICE',   color: 'bg-blue-900' },
  prive:    { label: 'PRIVÉ',    color: 'bg-zinc-700' },
  garage:   { label: 'GARAGE',   color: 'bg-amber-700' },
  unknown:  { label: '?',        color: 'bg-zinc-600' },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new:         { label: 'Nouvelle',     color: 'text-yellow-400' },
  dispatching: { label: 'En attente',   color: 'text-blue-400' },
  assigned:    { label: 'Assignée',     color: 'text-purple-400' },
  accepted:    { label: 'Acceptée',     color: 'text-green-400' },
  in_progress: { label: 'En cours',     color: 'text-orange-400' },
  completed:   { label: 'Terminée',     color: 'text-zinc-400' },
  cancelled:   { label: 'Annulée',      color: 'text-red-400' },
  ignored:     { label: 'Refusée',      color: 'text-red-500' },
  parse_error: { label: 'Erreur',       color: 'text-red-400' },
}

const MISSION_TYPES = ['remorquage', 'depannage', 'transport', 'trajet_vide', 'reparation_place', 'autre']
const FUEL_TYPES    = ['Diesel', 'Essence', 'Hybride', 'Électrique', 'GPL', 'Autre']
const GEARBOX_TYPES = ['Manuelle', 'Automatique', 'Semi-automatique']

const LOG_ICONS: Record<string, string> = {
  received:   '📥',
  parsed:     '🔍',
  dispatched: '✅',
  accepted:   '👍',
  refused:    '❌',
  reassigned: '🔄',
  completed:  '🏁',
  cancelled:  '🚫',
  error:      '⚠️',
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/dispatch',  label: 'Dispatch',  icon: '📡' },
  { href: '/admin',     label: 'Admin',     icon: '⚙️' },
  { href: '/profil',    label: 'Mon Profil',icon: '👤' },
]

function Sidebar({ userName, userRole }: { userName: string; userRole: string }) {
  const pathname = usePathname()
  const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  return (
    <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-[#1A1A1A] border-r border-[#2a2a2a] fixed top-0 left-0 h-full z-30">
      <div className="px-6 py-5 border-b border-[#2a2a2a]">
        <Link href="/dashboard">
          <img src="/logo.jpg" alt="Verviers Dépannage" className="h-10 w-auto object-contain" />
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV_ITEMS.map(item => {
          const active = pathname.startsWith(item.href) && (item.href !== '/dashboard' || pathname === '/dashboard')
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active ? 'bg-brand/10 text-white border border-brand/20' : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-3 py-4 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs">{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{userName}</p>
            <p className="text-zinc-500 text-xs capitalize">{userRole}</p>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all w-full">
          <span>🚪</span> Déconnexion
        </button>
      </div>
    </aside>
  )
}

// ── Input helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-zinc-500 text-xs mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
    />
  )
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
    >
      <option value="">— Sélectionner —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function MissionDetailClient({
  mission: initialMission,
  logs,
  drivers,
  userName,
  userRole,
  googleMapsKey,
}: {
  mission:       Mission
  logs:          MissionLog[]
  drivers:       Driver[]
  userName:      string
  userRole:      string
  googleMapsKey: string
}) {
  const router = useRouter()

  // Formulaire éditable
  const [form, setForm] = useState({
    mission_type:         initialMission.mission_type         || '',
    incident_type:        initialMission.incident_type        || '',
    incident_description: initialMission.incident_description || '',
    billed_to_name:       initialMission.billed_to_name       || '',
    client_name:          initialMission.client_name          || '',
    client_phone:         initialMission.client_phone         || '',
    client_address:       initialMission.client_address       || '',
    vehicle_plate:        initialMission.vehicle_plate        || '',
    vehicle_brand:        initialMission.vehicle_brand        || '',
    vehicle_model:        initialMission.vehicle_model        || '',
    vehicle_vin:          initialMission.vehicle_vin          || '',
    vehicle_fuel:         initialMission.vehicle_fuel         || '',
    vehicle_gearbox:      initialMission.vehicle_gearbox      || '',
    incident_address:     initialMission.incident_address     || '',
    incident_lat:         initialMission.incident_lat         != null ? String(initialMission.incident_lat)  : '',
    incident_lng:         initialMission.incident_lng         != null ? String(initialMission.incident_lng)  : '',
    incident_city:        initialMission.incident_city        || '',
    destination_name:     initialMission.destination_name     || '',
    destination_address:  initialMission.destination_address  || '',
    destination_lat:      '',
    destination_lng:      '',
    amount_guaranteed:    initialMission.amount_guaranteed != null ? String(initialMission.amount_guaranteed) : '',
    amount_to_collect:    initialMission.amount_to_collect != null  ? String(initialMission.amount_to_collect)  : '',
  })

  const [selectedDriver, setSelectedDriver]   = useState(initialMission.assigned_to || '')
  const [showRawContent, setShowRawContent]   = useState(false)
  const [loadingConfirm, setLoadingConfirm]   = useState(false)
  const [loadingRefuse,  setLoadingRefuse]    = useState(false)
  const [loadingSave,    setLoadingSave]      = useState(false)
  const [brands,         setBrands]           = useState<{id:number;name:string}[]>([])
  const [models,         setModels]           = useState<{id:number;name:string}[]>([])
  const [loadingBrands,  setLoadingBrands]    = useState(false)
  const [loadingIMA,     setLoadingIMA]       = useState(false)
  const [imaSuccess,     setImaSuccess]       = useState(false)
  const [status,         setStatus]           = useState(initialMission.status)
  const [odooTicketUrl,  setOdooTicketUrl]    = useState<string | null>(initialMission.odoo_ticket_url || null)
  const [odooTaskUrl,    setOdooTaskUrl]      = useState<string | null>(initialMission.odoo_task_url || null)
  const [loadingOdoo,    setLoadingOdoo]      = useState(false)
  const [odooError,      setOdooError]        = useState<string | null>(null)

  // ── Recherche/lien client Odoo (facturé) ────────────────────────────────────
  const [billedPartnerId, setBilledPartnerId] = useState<number | null>(initialMission.billed_to_id || null)
  const [clientQuery,     setClientQuery]     = useState('')
  const [clientResults,   setClientResults]   = useState<Array<{id:number;name:string;phone?:string;mobile?:string;city?:string}>>([])
  const [showClientDrop,  setShowClientDrop]  = useState(false)
  const clientTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    if (clientQuery.length < 3) { setClientResults([]); return }
    clearTimeout(clientTimer.current)
    clientTimer.current = setTimeout(async () => {
      try {
        const data = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(clientQuery)}`).then(r => r.json())
        setClientResults(data.clients || [])
      } catch {}
    }, 300)
  }, [clientQuery])

  const selectBilledClient = (c: {id:number;name:string}) => {
    setBilledPartnerId(c.id)
    setForm(prev => ({ ...prev, billed_to_name: c.name }))
    setClientQuery('')
    setClientResults([])
    setShowClientDrop(false)
  }
  const clearBilledClient = () => {
    setBilledPartnerId(null)
    setForm(prev => ({ ...prev, billed_to_name: '' }))
  }

  // ── Recherche/lien véhicule Odoo (par plaque ou VIN) ────────────────────────
  const [odooVehicleId,    setOdooVehicleId]    = useState<number | null>(null)
  const [vehicleResults,   setVehicleResults]   = useState<Array<{id:number;plate:string;vin:string;brand:string;model:string;fuel:string;gearbox:string}>>([])
  const [showVehicleDrop,  setShowVehicleDrop]  = useState(false)
  const [vehicleSearched,  setVehicleSearched]  = useState(false)
  const vehicleTimer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    const q = (form.vehicle_plate || '').trim()
    if (q.length < 3) { setVehicleResults([]); setVehicleSearched(false); return }
    if (odooVehicleId) return  // déjà lié, on n'écrase pas
    clearTimeout(vehicleTimer.current)
    vehicleTimer.current = setTimeout(async () => {
      try {
        const data = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(q)}`).then(r => r.json())
        setVehicleResults(data.vehicles || [])
        setVehicleSearched(true)
        if ((data.vehicles || []).length > 0) setShowVehicleDrop(true)
      } catch {}
    }, 400)
  }, [form.vehicle_plate, odooVehicleId])

  const selectOdooVehicle = async (v: {id:number;plate:string;vin:string;brand:string;model:string;fuel:string;gearbox:string}) => {
    setOdooVehicleId(v.id)
    // Préserve les valeurs Odoo (source de vérité) sauf si vides → fallback sur le form
    setForm(prev => ({
      ...prev,
      vehicle_plate:   v.plate || prev.vehicle_plate,
      vehicle_brand:   v.brand || prev.vehicle_brand,
      vehicle_model:   v.model || prev.vehicle_model,
      vehicle_vin:     v.vin   || prev.vehicle_vin,
      vehicle_fuel:    v.fuel  || prev.vehicle_fuel,
      vehicle_gearbox: v.gearbox || prev.vehicle_gearbox,
    }))
    setVehicleResults([])
    setShowVehicleDrop(false)

    // Si le form a un VIN/fuel/boîte que le véhicule Odoo n'a pas → on complète Odoo
    const needsUpdate =
      (form.vehicle_vin     && !v.vin) ||
      (form.vehicle_fuel    && !v.fuel) ||
      (form.vehicle_gearbox && !v.gearbox)
    if (needsUpdate) {
      try {
        await fetch('/api/odoo/update-vehicle', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicle_id: v.id,
            vin:        !v.vin     ? form.vehicle_vin     : undefined,
            fuel:       !v.fuel    ? form.vehicle_fuel    : undefined,
            gearbox:    !v.gearbox ? form.vehicle_gearbox : undefined,
          }),
        })
      } catch {}
    }
  }
  const clearOdooVehicle = () => { setOdooVehicleId(null); setVehicleSearched(false) }

  // Comparaison fuzzy brand/model d'un véhicule Odoo vs ce qui est saisi dans le form
  const vehicleSimilarity = (v: {brand:string;model:string}): 'match' | 'mismatch' | 'unknown' => {
    if (!form.vehicle_brand && !form.vehicle_model) return 'unknown'
    const norm = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '').trim()
    const fuzzy = (a: string, b: string) => {
      const na = norm(a), nb = norm(b)
      if (!na || !nb) return false
      return na.includes(nb) || nb.includes(na)
    }
    const brandOk = !form.vehicle_brand || fuzzy(v.brand, form.vehicle_brand)
    const modelOk = !form.vehicle_model || fuzzy(v.model, form.vehicle_model)
    return brandOk && modelOk ? 'match' : 'mismatch'
  }

  const [M, setM] = useState<Mission>(initialMission)
  const [saveOk, setSaveOk] = useState(false)

  // Realtime — mise à jour automatique depuis le chauffeur
  useEffect(() => {
    const ch = sb.channel(`dispatch-mission-${initialMission.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'incoming_missions',
        filter: `id=eq.${initialMission.id}`,
      }, payload => {
        const updated = payload.new as any
        setM(prev => ({ ...prev, ...updated }))
        if (updated.status) setStatus(updated.status)
        // Mettre à jour uniquement les champs chauffeur (pas les champs du formulaire dispatch)
        const driverFields = ['driver_photos', 'discharge_data', 'client_signature',
          'closing_notes', 'on_way_at', 'on_site_at', 'completed_at',
          'accepted_at', 'assigned_at', 'parked_at', 'extra_addresses']
        const formUpdates: Partial<typeof form> = {}
        if (updated.vehicle_plate && updated.vehicle_plate !== form.vehicle_plate) formUpdates.vehicle_plate = updated.vehicle_plate
        if (updated.vehicle_brand && updated.vehicle_brand !== form.vehicle_brand) formUpdates.vehicle_brand = updated.vehicle_brand
        if (updated.vehicle_model && updated.vehicle_model !== form.vehicle_model) formUpdates.vehicle_model = updated.vehicle_model
        if (Object.keys(formUpdates).length > 0) setForm(prev => ({ ...prev, ...formUpdates }))
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [initialMission.id])

  const f = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // Détecter lien IMA dans raw_content
  const imaLink = initialMission.raw_content?.match(/https:\/\/imamobile\.ima\.eu\/[^\s"<>]+/)?.[0] || null

  // Enrichir depuis le portail IMA
  const handleFetchIMA = async () => {
    setLoadingIMA(true)
    setImaSuccess(false)
    try {
      const res  = await fetch('/api/missions/fetch-ima', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: initialMission.id })
      })
      const data = await res.json()
      if (data.ok) {
        setImaSuccess(true)
        setTimeout(() => window.location.reload(), 1500)
      }
    } finally {
      setLoadingIMA(false)
    }
  }

  // Normalisation pour fuzzy match marque/modèle (case + tirets/espaces ignorés)
  const normalizeBrand = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '').trim()

  // Charger les marques depuis l'API véhicules + auto-match insensible à la casse
  const loadBrands = async () => {
    if (brands.length > 0) return brands
    setLoadingBrands(true)
    try {
      const res  = await fetch('/api/vehicles?type=brands')
      const data: {id:number;name:string}[] = await res.json()
      setBrands(data || [])
      return data || []
    } finally { setLoadingBrands(false) }
  }

  const loadModels = async (brandId: number) => {
    const res  = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
    const data = await res.json()
    setModels(data || [])
    return data || []
  }

  useEffect(() => {
    (async () => {
      if (!form.vehicle_brand || brands.length > 0) return
      const list = await loadBrands()
      // Si le parser a retourné une marque qui matche un brand Odoo (insensible à la casse),
      // on réécrit la valeur du form avec la casse exacte d'Odoo pour que le <select> match.
      const target = normalizeBrand(form.vehicle_brand)
      const matched = list.find(b => normalizeBrand(b.name) === target)
                   ?? list.find(b => normalizeBrand(b.name).includes(target) || target.includes(normalizeBrand(b.name)))
      if (matched) {
        if (matched.name !== form.vehicle_brand) f('vehicle_brand')(matched.name)
        const modelList = await loadModels(matched.id)
        if (form.vehicle_model) {
          const targetModel = normalizeBrand(form.vehicle_model)
          const matchedModel = modelList.find((m: any) => normalizeBrand(m.name) === targetModel)
                            ?? modelList.find((m: any) => normalizeBrand(m.name).includes(targetModel) || targetModel.includes(normalizeBrand(m.name)))
          if (matchedModel && matchedModel.name !== form.vehicle_model) f('vehicle_model')(matchedModel.name)
        }
      }
    })()
  }, [])

  // Sauvegarder les modifications du formulaire
  const handleSave = async () => {
    setLoadingSave(true)
    setSaveOk(false)
    const payload = { ...form, billed_to_id: billedPartnerId }
    const res = await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })
    if (res.ok) {
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 3000)
    }
    setLoadingSave(false)
  }

  // Confirmer la mission
  const handleConfirm = async () => {
    setLoadingConfirm(true)
    const payload = { ...form, billed_to_id: billedPartnerId }
    await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })
    if (selectedDriver) {
      await fetch('/api/missions/assign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: initialMission.id, driver_id: selectedDriver })
      })
    }
    await fetch('/api/missions/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mission_id: initialMission.id, action: 'confirm' })
    })
    setStatus('dispatching')
    setLoadingConfirm(false)
    // Créer le dossier dans Odoo FSM (en arrière-plan, sans bloquer)
    createOdooFsmDossier().catch(console.error)
    window.location.href = '/dispatch'
  }

  // Créer Helpdesk ticket + FSM Task dans Odoo
  const createOdooFsmDossier = async () => {
    setLoadingOdoo(true)
    setOdooError(null)
    try {
      const res = await fetch('/api/fsm/create-mission', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mission_id:          initialMission.id,
          supabase_id:         initialMission.id,
          dossier_number:      initialMission.dossier_number || initialMission.external_id || '',
          source:              initialMission.source?.toUpperCase() || 'PRIVÉ',
          client_name:         form.client_name || 'Client inconnu',
          client_phone:        form.client_phone || '',
          vehicle_plate:       form.vehicle_plate || '',
          vehicle_brand:       form.vehicle_brand || '',
          vehicle_model:       form.vehicle_model || '',
          incident_address:    form.incident_address || '',
          incident_city:       form.incident_city || '',
          destination_address: form.destination_address || '',
          destination_name:    form.destination_name || '',
          description:         form.incident_description || '',
          chauffeur_id:        selectedDriver || '',
        })
      })
      const data = await res.json()
      if (data.ticketUrl) setOdooTicketUrl(data.ticketUrl)
      if (data.taskUrl)   setOdooTaskUrl(data.taskUrl)
    } catch (e: any) {
      setOdooError(e.message)
    } finally {
      setLoadingOdoo(false)
    }
  }

  // Refuser la mission
  const handleRefuse = async () => {
    if (!confirm('Confirmer le refus de cette mission ?')) return
    setLoadingRefuse(true)
    await fetch('/api/missions/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mission_id: initialMission.id, action: 'refuse' })
    })
    setStatus('ignored')
    setLoadingRefuse(false)
    router.push('/dispatch')
  }

  // Assigner la mission (dispatching → assigned)
  const handleAssign = async () => {
    if (!selectedDriver) {
      alert("Veuillez sélectionner un chauffeur avant d'assigner la mission.")
      return
    }
    setLoadingSave(true)
    await fetch(`/api/missions/${initialMission.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form)
    })
    await fetch('/api/missions/assign', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mission_id: initialMission.id, driver_id: selectedDriver })
    })
    setStatus('assigned')
    setLoadingSave(false)
    router.push('/dispatch')
  }

  const srcInfo    = SOURCE_LABELS[initialMission.source] || { label: '?', color: 'bg-zinc-600' }
  const statusInfo = STATUS_LABELS[status] || { label: status, color: 'text-zinc-400' }
  const canEdit    = ['new', 'dispatching'].includes(status)

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex">
      <Sidebar userName={userName} userRole={userRole} />

      <div className="flex-1 lg:ml-64 flex flex-col">
        {/* Header */}
        <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <Link href="/dispatch" className="text-zinc-400 hover:text-white transition text-lg">←</Link>
            <div className="flex items-center gap-3 flex-1">
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${srcInfo.color}`}>
                {srcInfo.label}
              </span>
              <h1 className="text-white font-bold text-xl">
                Mission {initialMission.external_id}
              </h1>
              {initialMission.dossier_number && (
                <span className="text-zinc-500 text-sm font-mono">{initialMission.dossier_number}</span>
              )}
              <span className={`text-sm font-medium ${statusInfo.color}`}>• {statusInfo.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 text-xs">
                Reçu le {new Date(initialMission.received_at).toLocaleString('fr-BE')}
              </span>
              {initialMission.parse_confidence !== null && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  initialMission.parse_confidence >= 0.8 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  IA {Math.round(initialMission.parse_confidence * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 px-8 py-6">
          <div className="grid grid-cols-3 gap-6">

            {/* ── Colonne gauche : formulaire ───────────────────────── */}
            <div className="col-span-2 space-y-5">

              {/* Intervention */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>📋</span> Intervention
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Type de mission">
                    <Select value={form.mission_type} onChange={f('mission_type')} options={MISSION_TYPES} />
                  </Field>
                  <Field label="Type d'incident">
                    <Input value={form.incident_type} onChange={f('incident_type')} placeholder="Ex: pneu crevé, batterie..." />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Description de l'incident">
                      <textarea
                        value={form.incident_description}
                        onChange={e => f('incident_description')(e.target.value)}
                        rows={3}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand resize-none placeholder:text-zinc-600"
                        placeholder="Description complète..."
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Client facturé */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>🧾</span> Client facturé
                </h2>

                {/* Recherche Odoo */}
                <div className="relative mb-3">
                  <label className="block text-zinc-500 text-xs mb-1.5">Rechercher dans Odoo</label>
                  <input
                    value={clientQuery}
                    onChange={e => { setClientQuery(e.target.value); setShowClientDrop(true) }}
                    onFocus={() => setShowClientDrop(true)}
                    onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                    placeholder="Min. 3 caractères — nom ou téléphone..."
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand placeholder:text-zinc-600"
                  />
                  {showClientDrop && clientResults.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                      {clientResults.map(c => (
                        <button key={c.id} type="button" onMouseDown={() => selectBilledClient(c)}
                          className="w-full text-left px-4 py-3 hover:bg-[#2a2a2a] transition border-b border-[#222] last:border-0">
                          <p className="text-white text-sm font-medium">{c.name}</p>
                          <p className="text-zinc-500 text-xs">{[c.phone || c.mobile, c.city].filter(Boolean).join(' · ')}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Badge lien Odoo */}
                {billedPartnerId && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-3">
                    <span className="text-green-400 text-xs">✓ Lié Odoo #{billedPartnerId}</span>
                    <span className="text-green-300 text-xs font-medium">{form.billed_to_name}</span>
                    <button type="button" onClick={clearBilledClient}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">✕</button>
                  </div>
                )}

                <Field label="Nom / Raison sociale">
                  <Input value={form.billed_to_name} onChange={f('billed_to_name')} placeholder="Ex: Touring SA, Police Zone Vesdre..." />
                </Field>
                {!billedPartnerId && form.billed_to_name && (
                  <p className="text-amber-400/80 text-xs mt-1.5">⚠ Pas de contact Odoo lié — un nouveau sera créé à la confirmation.</p>
                )}
              </div>

              {/* Client assisté */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>👤</span> Client assisté (personne en panne)
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Nom complet">
                    <Input value={form.client_name} onChange={f('client_name')} placeholder="Prénom Nom" />
                  </Field>
                  <Field label="Téléphone">
                    <Input value={form.client_phone} onChange={f('client_phone')} placeholder="+32..." />
                  </Field>
                  <div className="col-span-2">
                    <AddressField
                      label="Adresse domicile"
                      value={form.client_address}
                      onChange={f('client_address')}
                      gmKey={googleMapsKey}
                      placeholder="Rue, numéro, ville..."
                    />
                  </div>
                </div>
              </div>

              {/* Véhicule */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>🚗</span> Véhicule
                </h2>

                {/* Badge lien véhicule Odoo + lookup automatique par plaque */}
                {odooVehicleId && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
                    <span className="text-green-400 text-xs">✓ Lié Odoo véhicule #{odooVehicleId}</span>
                    <button type="button" onClick={clearOdooVehicle}
                      className="ml-auto text-zinc-500 hover:text-red-400 text-xs">Délier ✕</button>
                  </div>
                )}
                {!odooVehicleId && vehicleSearched && vehicleResults.length === 0 && form.vehicle_plate.trim().length >= 3 && (
                  <p className="text-amber-400/80 text-xs mb-3">⚠ Aucun véhicule Odoo avec cette plaque — un nouveau sera créé à la confirmation.</p>
                )}
                {!odooVehicleId && vehicleResults.length > 0 && (
                  <div className="mb-4 bg-[#111] border border-brand/30 rounded-xl p-3">
                    <p className="text-zinc-400 text-xs mb-2">{vehicleResults.length} véhicule(s) trouvé(s) dans Odoo — clique pour lier (évite le doublon) :</p>
                    <div className="space-y-1">
                      {vehicleResults.map(v => {
                        const sim = vehicleSimilarity(v)
                        return (
                          <button key={v.id} type="button" onClick={() => selectOdooVehicle(v)}
                            className={`w-full text-left px-3 py-2 border rounded-lg transition ${
                              sim === 'match'    ? 'bg-green-500/10 hover:bg-green-500/20 border-green-500/30'    :
                              sim === 'mismatch' ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30'    :
                                                    'bg-[#1A1A1A] hover:bg-[#222] border-[#2a2a2a]'
                            }`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-white text-sm">
                                <span className="font-mono font-semibold">{v.plate}</span>
                                <span className="text-zinc-400 ml-2">{[v.brand, v.model].filter(Boolean).join(' ')}</span>
                              </p>
                              {sim === 'match'    && <span className="text-green-400 text-xs">✓ correspond</span>}
                              {sim === 'mismatch' && <span className="text-amber-400 text-xs">⚠ marque/modèle ≠</span>}
                            </div>
                            {v.vin && <p className="text-zinc-500 text-xs">VIN: {v.vin}</p>}
                          </button>
                        )
                      })}
                    </div>
                    {/* Forcer la création d'un nouveau si l'utilisateur juge qu'aucun résultat ne correspond */}
                    {form.vehicle_plate.trim().length >= 3 && (
                      <button type="button" onClick={() => { setVehicleResults([]); setVehicleSearched(true) }}
                        className="mt-2 w-full text-center px-3 py-2 bg-[#0a0a0a] hover:bg-[#222] border border-dashed border-[#3a3a3a] rounded-lg text-zinc-400 hover:text-white text-xs transition">
                        ➕ Aucun ne correspond — créer un nouveau véhicule
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <Field label="Plaque">
                    <Input value={form.vehicle_plate} onChange={f('vehicle_plate')} placeholder="1ABC234" />
                  </Field>
                  <Field label="Marque">
                    <select
                      value={form.vehicle_brand}
                      onFocus={loadBrands}
                      onChange={e => {
                        const b = brands.find(b => b.name === e.target.value)
                        f('vehicle_brand')(e.target.value)
                        f('vehicle_model')('')
                        setModels([])
                        if (b) loadModels(b.id)
                      }}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
                    >
                      <option value="">{loadingBrands ? 'Chargement...' : '— Sélectionner —'}</option>
                      {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Modèle">
                    {models.length > 0 ? (
                      <select value={form.vehicle_model} onChange={e => f('vehicle_model')(e.target.value)}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                        <option value="">— Sélectionner —</option>
                        {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                        <option value="_custom">Autre (saisie libre)</option>
                      </select>
                    ) : (
                      <Input value={form.vehicle_model} onChange={f('vehicle_model')} placeholder={form.vehicle_brand ? 'Saisie libre...' : "Choisir une marque d'abord"} />
                    )}
                  </Field>
                  <Field label="Carburant">
                    <Select value={form.vehicle_fuel} onChange={f('vehicle_fuel')} options={FUEL_TYPES} />
                  </Field>
                  <Field label="Boîte de vitesses">
                    <Select value={form.vehicle_gearbox} onChange={f('vehicle_gearbox')} options={GEARBOX_TYPES} />
                  </Field>
                  <Field label="N° Châssis (VIN)">
                    <Input value={form.vehicle_vin} onChange={f('vehicle_vin')} placeholder="VIN..." />
                  </Field>
                </div>
              </div>

              {/* Lieu d'intervention / Destination */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>📍</span> Lieu d'intervention / Destination
                </h2>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Lieu d'incident</p>
                    <AddressField
                      label="Adresse complète"
                      value={form.incident_address}
                      onChange={f('incident_address')}
                      onSelect={(addr, lat, lng, city) => setForm(prev => ({
                        ...prev,
                        incident_address: addr,
                        incident_lat:     String(lat),
                        incident_lng:     String(lng),
                        ...(city ? { incident_city: city } : {}),
                      }))}
                      gmKey={googleMapsKey}
                      placeholder="Tapez et choisissez une suggestion Google..."
                    />
                    {initialMission.incident_address && initialMission.incident_address !== form.incident_address && (
                      <p className="text-zinc-600 text-xs">📥 Reçu : <span className="text-zinc-500">{initialMission.incident_address}</span></p>
                    )}
                  </div>
                  <div className="space-y-3">
                    <p className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Destination</p>
                    <AddressField
                      label="Adresse complète (nom de lieu inclus si garage, hôtel…)"
                      value={form.destination_address}
                      onChange={f('destination_address')}
                      onSelect={(addr, lat, lng, _city, name) => setForm(prev => ({
                        ...prev,
                        destination_address: addr,
                        destination_lat:     String(lat),
                        destination_lng:     String(lng),
                        ...(name ? { destination_name: name } : {}),
                      }))}
                      gmKey={googleMapsKey}
                      placeholder="Ex: Garage Citroën Verviers, Rue..."
                    />
                  </div>
                </div>
              </div>

              {/* Montant garanti + Paiement client */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <span>💶</span> Montants
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Montant garanti (EUR HTVA)">
                    <Input value={form.amount_guaranteed} onChange={f('amount_guaranteed')} placeholder="0.00" />
                  </Field>
                  <Field label="Paiement à réclamer au client (€)">
                    <Input value={form.amount_to_collect} onChange={f('amount_to_collect')} placeholder="0.00" />
                  </Field>
                </div>
              </div>

              {/* Compte rendu clôture */}
              {initialMission.status === 'completed' && (
                <div className="bg-[#1A1A1A] border border-green-500/20 rounded-2xl p-5">
                  <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                    <span>🏁</span> Compte rendu de mission
                  </h2>
                  <div className="space-y-3">
                    {initialMission.vehicle_mileage && (
                      <div><p className="text-zinc-500 text-xs">Kilométrage</p>
                        <p className="text-white text-sm font-semibold">{initialMission.vehicle_mileage.toLocaleString()} km</p></div>
                    )}
                    {initialMission.closing_notes && (
                      <div><p className="text-zinc-500 text-xs">Notes</p>
                        <p className="text-white text-sm whitespace-pre-wrap">{initialMission.closing_notes}</p></div>
                    )}
                    {initialMission.amount_collected && (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                        <p className="text-zinc-500 text-xs">Encaissement</p>
                        <p className="text-green-400 font-bold text-lg">{initialMission.amount_collected} €</p>
                        {initialMission.payment_method && <p className="text-zinc-400 text-xs capitalize">{initialMission.payment_method}</p>}
                      </div>
                    )}
                    {initialMission.client_signature && (
                      <div>
                        <p className="text-zinc-500 text-xs mb-1">Signature — {initialMission.client_signature_name}</p>
                        <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111]">
                          <img src={initialMission.client_signature} alt="Signature" className="w-full max-h-24 object-contain" />
                        </div>
                      </div>
                    )}
                    {initialMission.driver_photos && initialMission.driver_photos.length > 0 && (
                      <div>
                        <p className="text-zinc-500 text-xs mb-2">Photos ({initialMission.driver_photos.length})</p>
                        <div className="grid grid-cols-3 gap-2">
                          {initialMission.driver_photos.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt={`Photo ${i+1}`} className="w-full aspect-square object-cover rounded-xl" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Décharges */}
                    {(() => {
                      const discharges = initialMission.discharge_data?.length
                        ? initialMission.discharge_data
                        : initialMission.discharge_motif
                          ? [{ motif: initialMission.discharge_motif, name: initialMission.discharge_name || '', sig: initialMission.discharge_sig || '' }]
                          : []
                      if (!discharges.length) return null
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-zinc-500 text-xs">Décharge{discharges.length > 1 ? 's' : ''} ({discharges.length})</p>
                            <a
                              href={`/api/missions/${initialMission.id}/discharge-pdf`}
                              target="_blank" rel="noreferrer"
                              className="text-xs px-3 py-1 bg-blue-600/20 border border-blue-600/40 text-blue-400 rounded-lg hover:bg-blue-600/30 transition"
                            >
                              📄 Télécharger PDF
                            </a>
                          </div>
                          <div className="space-y-2">
                            {discharges.map((d, i) => (
                              <div key={i} className="bg-[#111] border border-amber-600/20 rounded-xl p-3 space-y-2">
                                <p className="text-amber-400 text-xs font-medium">Décharge {discharges.length > 1 ? i + 1 : ''}</p>
                                <p className="text-zinc-300 text-xs whitespace-pre-wrap">{d.motif}</p>
                                {d.name && <p className="text-zinc-500 text-xs">Signataire : <span className="text-zinc-300">{d.name}</span></p>}
                                {d.sig && (
                                  <div className="border border-[#2a2a2a] rounded-lg overflow-hidden bg-[#0F0F0F]">
                                    <img src={d.sig} alt="Signature" className="w-full max-h-16 object-contain" />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* Contenu brut */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
                <button
                  onClick={() => setShowRawContent(!showRawContent)}
                  className="w-full flex items-center justify-between px-5 py-3 text-zinc-400 hover:text-white text-sm transition"
                >
                  <span className="flex items-center gap-2">
                    <span>📄</span>
                    Contenu brut ({initialMission.source_format?.toUpperCase()})
                  </span>
                  <span>{showRawContent ? '▲' : '▼'}</span>
                </button>
                {showRawContent && initialMission.raw_content && (
                  <pre className="px-5 pb-4 text-xs text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap border-t border-[#2a2a2a] pt-3 max-h-96 overflow-y-auto">
                    {initialMission.raw_content}
                  </pre>
                )}
              </div>
            </div>

            {/* ── Colonne droite : actions + chauffeur + logs ───────── */}
            <div className="space-y-5">

              {/* Actions */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5 space-y-3 sticky top-[89px]">

                {/* Statut new → Confirmer / Refuser */}
                {status === 'new' && (
                  <>
                    <button
                      onClick={handleConfirm}
                      disabled={loadingConfirm}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                    >
                      {loadingConfirm ? 'Confirmation...' : '✅ Confirmer la mission'}
                    </button>
                    <button
                      onClick={handleRefuse}
                      disabled={loadingRefuse}
                      className="w-full py-3 bg-[#111] hover:bg-red-600/20 border border-[#2a2a2a] hover:border-red-600/50 text-zinc-400 hover:text-red-400 rounded-xl font-medium text-sm transition disabled:opacity-50"
                    >
                      {loadingRefuse ? 'Refus...' : '❌ Refuser'}
                    </button>
                    <div className="border-t border-[#2a2a2a] pt-3">
                      <button
                        onClick={handleSave}
                        disabled={loadingSave}
                        className="w-full py-2.5 bg-[#111] hover:bg-[#2a2a2a] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-xl text-sm transition disabled:opacity-50"
                      >
                        {loadingSave ? 'Sauvegarde...' : saveOk ? '✅ Sauvegardé !' : '💾 Sauvegarder'}
                      </button>
                    </div>
                  </>
                )}

                {/* Statut dispatching → Assigner / Annuler */}
                {status === 'dispatching' && (
                  <>
                    <div className="text-center py-2">
                      <span className="text-blue-400 font-semibold text-sm">📡 En attente d'assignation</span>
                    </div>
                    <button
                      onClick={handleAssign}
                      disabled={loadingSave}
                      className="w-full py-3 bg-brand hover:bg-brand/80 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                    >
                      {loadingSave ? 'Assignation...' : '👷 Assigner la mission'}
                    </button>
                    <button
                      onClick={handleRefuse}
                      disabled={loadingRefuse}
                      className="w-full py-2.5 bg-[#111] hover:bg-red-600/20 border border-[#2a2a2a] hover:border-red-600/50 text-zinc-400 hover:text-red-400 rounded-xl font-medium text-sm transition disabled:opacity-50"
                    >
                      {loadingRefuse ? 'Annulation...' : '🚫 Annuler la mission'}
                    </button>
                  </>
                )}

                {/* Autres statuts — statut + sauvegarder */}
                {!['new', 'dispatching'].includes(status) && (
                  <>
                    <div className={`text-center py-2 font-semibold text-sm ${statusInfo.color}`}>
                      {statusInfo.label}
                    </div>
                    {!['completed', 'ignored'].includes(status) && (
                      <button
                        onClick={handleSave}
                        disabled={loadingSave}
                        className="w-full py-2.5 bg-[#111] hover:bg-[#2a2a2a] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-xl text-sm transition disabled:opacity-50"
                      >
                        {loadingSave ? 'Sauvegarde...' : saveOk ? '✅ Sauvegardé !' : '💾 Sauvegarder'}
                      </button>
                    )}
                  </>
                )}

                {/* Assignation chauffeur */}
                <div className="border-t border-[#2a2a2a] pt-4">
                  <p className="text-zinc-500 text-xs mb-2">Assigner à un chauffeur</p>
                  {['completed', 'ignored', 'cancelled'].includes(status) ? (
                    <div className="bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-zinc-400 text-sm">
                      {initialMission.assigned_user?.name || '— Non assigné —'}
                    </div>
                  ) : (
                    <select
                      value={selectedDriver}
                      onChange={e => setSelectedDriver(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand mb-2"
                    >
                      <option value="">— Non assigné —</option>
                      {drivers.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  )}
                  {initialMission.assigned_user && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Assigné à <span className="text-green-400 font-medium">{initialMission.assigned_user.name}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* ── Suivi chauffeur (P6) ─────────────────────────────── */}
              {['assigned', 'accepted', 'in_progress', 'completed'].includes(status) && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-4">
                    🚗 Suivi chauffeur
                  </h3>
                  <DriverTimeline mission={{
                    status,
                    assigned_at:     M.assigned_at,
                    accepted_at:     M.accepted_at,
                    on_way_at:       M.on_way_at,
                    on_site_at:      M.on_site_at,
                    completed_at:    M.completed_at,
                    parked_at:       (M as any).parked_at,
                    delivering_at:   (M as any).delivering_at,
                    extra_addresses: (M as any).extra_addresses,
                    assigned_user:   M.assigned_user || initialMission.assigned_user,
                  }} />
                </div>
              )}

              {/* Photos chauffeur */}
              {M.driver_photos && M.driver_photos.length > 0 && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">
                    📷 Photos chauffeur ({M.driver_photos.length})
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {M.driver_photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="aspect-square rounded-xl overflow-hidden block">
                        <img src={url} className="w-full h-full object-cover hover:opacity-80 transition" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Récap numéros */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Référence</h3>
                <div className="space-y-2">
                  <div>
                    <p className="text-zinc-500 text-xs">N° Mission</p>
                    <p className="text-white font-mono text-sm">{initialMission.external_id}</p>
                  </div>
                  {initialMission.dossier_number && (
                    <div>
                      <p className="text-zinc-500 text-xs">N° Dossier</p>
                      <p className="text-white font-mono text-sm">{initialMission.dossier_number}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-zinc-500 text-xs">Source</p>
                    <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-xs font-bold text-white ${srcInfo.color}`}>
                      {srcInfo.label}
                    </span>
                  </div>
                  <div>
                    <p className="text-zinc-500 text-xs">Reçu</p>
                    <p className="text-zinc-300 text-xs">{new Date(initialMission.received_at).toLocaleString('fr-BE')}</p>
                  </div>
                  {initialMission.incident_at && (
                    <div>
                      <p className="text-zinc-500 text-xs">Incident</p>
                      <p className="text-zinc-300 text-xs">{new Date(initialMission.incident_at).toLocaleString('fr-BE')}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Bouton dossier Odoo FSM */}
              <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Dossier Odoo</h3>
                {odooTicketUrl ? (
                  <a href={odooTicketUrl} target="_blank" rel="noopener noreferrer"
                    className="block w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium text-center transition">
                    🔗 Ouvrir le dossier Odoo ↗
                  </a>
                ) : loadingOdoo ? (
                  <div className="text-zinc-500 text-sm text-center py-2">⏳ Création dossier Odoo...</div>
                ) : odooError ? (
                  <div className="space-y-2">
                    <p className="text-red-400 text-xs">{odooError}</p>
                    <button onClick={createOdooFsmDossier}
                      className="w-full py-2 bg-purple-600/20 border border-purple-600/30 text-purple-400 rounded-xl text-xs">
                      🔄 Réessayer
                    </button>
                  </div>
                ) : (
                  <button onClick={createOdooFsmDossier}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition">
                    📋 Créer dossier Odoo
                  </button>
                )}
              </div>

              {/* Bouton enrichissement IMA */}
              {imaLink && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Portail IMA</h3>
                  {imaSuccess ? (
                    <div className="text-green-400 text-sm text-center py-2">✅ Données enrichies !</div>
                  ) : (
                    <>
                      <button
                        onClick={handleFetchIMA}
                        disabled={loadingIMA}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition disabled:opacity-50 mb-2"
                      >
                        {loadingIMA ? 'Récupération...' : '🔗 Enrichir depuis IMA'}
                      </button>
                      <a href={imaLink} target="_blank" rel="noopener noreferrer"
                        className="block w-full py-2 bg-[#111] border border-[#2a2a2a] text-zinc-400 hover:text-white rounded-xl text-xs text-center transition">
                        Ouvrir le portail IMA ↗
                      </a>
                    </>
                  )}
                </div>
              )}

              {/* Historique */}
              {logs.length > 0 && (
                <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
                  <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-3">Historique</h3>
                  <div className="space-y-3">
                    {logs.slice(0, 8).map(log => (
                      <div key={log.id} className="flex gap-2">
                        <span className="text-base leading-none mt-0.5">{LOG_ICONS[log.action] || '•'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-300 text-xs">{log.notes || log.action}</p>
                          <p className="text-zinc-600 text-xs">
                            {log.actor?.name && `${log.actor.name} · `}
                            {new Date(log.created_at).toLocaleString('fr-BE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
