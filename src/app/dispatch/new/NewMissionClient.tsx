'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter }   from 'next/navigation'
import Link            from 'next/link'
import AppShell from '@/components/layout/AppShell'
import AddressField from '@/components/AddressField'
import CreateClientModal from '@/components/CreateClientModal'
import DriverPickerModal from '@/components/DriverPickerModal'
import ScanButton from '@/components/ScanButton'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OdooClient {
  id: number; name: string; phone: string|false; mobile: string|false
  street: string|false; city: string|false; zip: string|false; email: string|false
}
interface OdooVehicle {
  id: number; plate: string; vin: string|false; brand: string; model: string
  partner_id: number|null; partner_name: string|null; fuel: string; gearbox: string
}
interface Warning { id: string; label: string; icon: string; color: string }
interface Driver  { id: string; name: string }
interface Brand   { id: number; name: string }
interface Model   { id: number; name: string; brand_id: number }
interface Destination { id: string; label: string; address: string; lat: number|null; lng: number|null; city: string }

// ── Constantes ────────────────────────────────────────────────────────────────

// Les sub-types Police viennent maintenant du catalog (group_key='police').
// Plus de liste hardcodee : ajouter une source avec group_key='police' dans
// /admin/sources la fait apparaitre automatiquement comme sub-type.
// Les "labels courts" affiches dans les boutons sont derives en supprimant
// le prefixe "Police - " du label catalog (ex: "Police - Accident" -> "Accident").
const POLICE_GROUP_KEY = 'police'
function shortLabelForPoliceSubtype(label: string): string {
  return label.replace(/^Police\s*-\s*/i, '').trim()
}
const SNC_SCENARIOS = [
  { value: 'dsp',        label: 'DSP — Dépannage sur place' },
  { value: 'rem_client', label: 'REM — Remorquage chez le client' },
  { value: 'rem_depot',  label: 'REM — Mise en dépôt VD Soft' },
]
const MISSION_TYPES = [
  { value: 'DSP',       label: '🔧 DSP — Dépannage sur place' },
  { value: 'REM',       label: '🚛 REM — Remorquage' },
  { value: 'REM+REL',   label: '🚛 REM+REL — Remorquage avec relivraison ultérieure' },
  { value: 'REL',       label: '🚛 REL — Relivraison (depuis dépôt)' },
  { value: 'Transport', label: '🚐 Transport / Rapatriement' },
  { value: 'DPR',       label: '📍 DPR — Déplacement pour rien' },
]
// VR (Vehicule de Remplacement) retire de partout (Olivier 2026-05-25 :
// "VR ne servira jamais. On le retire de partout").

// Types de mission disponibles selon la source.
// Olivier 2026-05-25 : "REM+REL ne doit jamais etre dans l encodage d une
// mission. Et REL tout seul non plus. REM+REL est une consequence generee
// parce qu un chauffeur depose un vehicule dans le parc au lieu de relivrer.
// Une REL est creee uniquement via le bouton 'Creer une relivraison' sur
// une mission REM+REL existante".
//
//  - Police pure (accident/saisie/mg/rodeo/avp) : REM / DPR uniquement
//  - Siabis (police_snc, sia_couvert)           : DSP / REM / DPR
//  - Assistances / Prive / Garage / autres      : DSP / REM / Transport / DPR
const POLICE_PURE_SOURCES = new Set([
  'police_accident', 'police_saisie', 'police_mg', 'police_rodeo', 'police_avp',
])
const SIABIS_SOURCES = new Set(['police_snc', 'sia_couvert'])

function getAvailableMissionTypes(src: string) {
  const key = (src || '').toLowerCase()
  if (POLICE_PURE_SOURCES.has(key)) {
    return MISSION_TYPES.filter(t => ['REM', 'DPR'].includes(t.value))
  }
  // SNC : pas de DPR encodable (Olivier 2026-05-26 : "Rien n etant facture,
  // on ne va pas planifier un DPR. Le DPR dans ce cas est initie par le
  // chauffeur en arrivant sur place. On ne sait rien facturer a personne
  // etant donne qu on a pas les coordonnees").
  if (key === 'police_snc') {
    return MISSION_TYPES.filter(t => ['DSP', 'REM'].includes(t.value))
  }
  // SC : DSP/REM/DPR (DPR tarif = DSP cf useEffect derivation scenario).
  if (key === 'sia_couvert') {
    return MISSION_TYPES.filter(t => ['DSP', 'REM', 'DPR'].includes(t.value))
  }
  // Assistances / Prive / Garage : DSP, REM, Transport, DPR
  return MISSION_TYPES.filter(t => ['DSP', 'REM', 'Transport', 'DPR'].includes(t.value))
}
const FUEL_TYPES    = ['Autre', 'Diesel', 'Électrique', 'Essence', 'GPL', 'Hybride']
const GEARBOX_TYPES = ['Automatique', 'Manuelle', 'Semi-automatique']
// ── Hooks ─────────────────────────────────────────────────────────────────────

function useClientSearch() {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<OdooClient[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(query)}`).then(r => r.json())
        setResults(data.clients || [])
      } finally { setLoading(false) }
    }, 300)
  }, [query])
  return { query, setQuery, results, setResults, loading }
}

function useVehicleSearch() {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<OdooVehicle[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<NodeJS.Timeout>()
  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(query)}`).then(r => r.json())
        setResults(data.vehicles || [])
      } finally { setLoading(false) }
    }, 300)
  }, [query])
  return { query, setQuery, results, setResults, loading }
}

// ── Composant destinations multiples ──────────────────────────────────────────
// AddressField : composant partagé @/components/AddressField (autocomplete Google
// Places identique au reste de l'app). Olivier 2026-06-17 : on a retiré la copie
// locale dupliquée qui ne déclenchait pas l'autocomplete sur ce formulaire.

function DestinationsBlock({ destinations, onChange, gmKey }: {
  destinations: Destination[]; onChange: (d: Destination[]) => void; gmKey: string
}) {
  // destinations capture la snapshot du render -> piege dans updateDest si on
  // appelle plusieurs updateDest successifs (les setState batched partent tous
  // de la meme snapshot, le dernier ecrase les precedents). Pour cela on utilise
  // une ref qui suit l etat courant + updateDestFields qui batch un objet partiel
  // en un seul appel.
  const destRef = useRef(destinations); destRef.current = destinations

  const addDest = () => {
    onChange([...destRef.current, { id: crypto.randomUUID(), label: '', address: '', lat: null, lng: null, city: '' }])
  }
  const removeDest = (id: string) => onChange(destRef.current.filter(d => d.id !== id))
  const updateDest = (id: string, key: keyof Destination, val: any) =>
    onChange(destRef.current.map(d => d.id === id ? { ...d, [key]: val } : d))
  /** Met a jour plusieurs champs d une destination en UN SEUL onChange.
      Necessaire pour le onSelect Google Maps qui doit set address+lat+lng+city
      en meme temps sans qu un setState ulterieur ecrase les precedents. */
  const updateDestFields = (id: string, fields: Partial<Destination>) =>
    onChange(destRef.current.map(d => d.id === id ? { ...d, ...fields } : d))

  return (
    <div className="space-y-4">
      {destinations.map((dest, i) => (
        <div key={dest.id} className="bg-surface border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary text-xs font-medium uppercase tracking-wide">
              {i === 0 ? '📍 Lieu d\'incident' : `🏁 Destination ${i}`}
            </span>
            {i > 0 && (
              <button onClick={() => removeDest(dest.id)}
                className="text-ink-faint hover:text-red-400 text-xs transition">✕ Supprimer</button>
            )}
          </div>
          {i > 0 && (
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">Libellé (ex: Garage Dupont)</label>
              <input value={dest.label} onChange={e => updateDest(dest.id, 'label', e.target.value)}
                placeholder="Nom du lieu..."
                className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
            </div>
          )}
          <AddressField
            label="Adresse"
            value={dest.address}
            onChange={v => updateDest(dest.id, 'address', v)}
            onSelect={(addr, lat, lng, city) => {
              // Update atomique : un seul onChange pour les 4 champs sinon
              // les setState batched s ecrasent (closure stale sur destinations).
              // city vient du composant partagé (address_components) ; fallback split.
              const parts = addr.split(',')
              const fallbackCity = parts.length > 1 ? (parts[parts.length - 2]?.trim() || '') : ''
              updateDestFields(dest.id, { address: addr, lat, lng, city: city || fallbackCity })
            }}
            gmKey={gmKey}
            placeholder="Rue, numéro, ville..."
          />
        </div>
      ))}
      <button onClick={addDest}
        className="w-full py-2.5 border border-dashedrounded-xl text-ink-muted hover:text-ink hover:border-strong text-sm transition">
        + Ajouter une destination
      </button>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function NewMissionClient({
  drivers, warnings, sources, userName, userRole, userModules = [], userEmail, userId, googleMapsKey
}: {
  drivers: Driver[]; warnings: Warning[]; sources: Array<{ key: string; label: string; display_color?: string | null; group_key?: string | null }>;
  userName: string; userRole: string; userModules?: string[]; userEmail?: string; userId?: string; googleMapsKey: string
}) {
  // Sub-types Police : sources du catalog avec group_key='police'.
  // Plus de liste hardcodee : ajouter une source avec group_key='police' dans
  // /admin/sources la fait apparaitre automatiquement comme sub-type.
  const policeSubtypeSources = sources.filter(s => s.group_key === POLICE_GROUP_KEY)

  // Construit la liste des sources affichees dans le dropdown principal.
  // Les sources avec group_key sont regroupees sous un meta-choix synthetique
  // ('police' pour les sub-types Police). Les sources sans group_key sont
  // affichees telles quelles. Tri alpha cote serveur (order by label).
  // Filtre 'unknown' du dropdown (Olivier 2026-05-26 : "retirer la source
  // Unknown"). La source reste en BDD pour les missions historiques mais
  // n est plus proposee a la creation manuelle.
  const isUnknownSource = (s: { key: string; label: string }) =>
    s.key.toLowerCase() === 'unknown' || s.label.toLowerCase() === 'unknown'
  const dropdownSources = [
    ...sources.filter(s => !s.group_key && !isUnknownSource(s)),
    // Si group 'police' a au moins une source mais pas d entree synthetique
    // 'police' dans le catalog : on l ajoute pour ouvrir le sub-selector.
    ...(policeSubtypeSources.length > 0 && !sources.some(s => s.key === 'police')
      ? [{ key: 'police', label: 'POLICE' }]
      : []),
  ].sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
  const router = useRouter()

  // ── RDV ───────────────────────────────────────────────────────────────────
  const now    = new Date()
  const pad    = (n: number) => String(n).padStart(2, '0')
  const today  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  const curTime= `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const [rdvDate, setRdvDate] = useState(today)
  const [rdvTime, setRdvTime] = useState(curTime)

  // ── Depot de depart ───────────────────────────────────────────────────────
  // Charge dynamiquement via /api/depots. Pepinster pre-selectionne par defaut
  // (depot principal). depots.id est un UUID (string).
  type Depot = { id: string; name: string; is_default?: boolean; lat?: number | null; lng?: number | null }
  const [depots,           setDepots]           = useState<Depot[]>([])
  const [departureDepotId, setDepartureDepotId] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/depots').then(r => r.json()).then((list: Depot[]) => {
      const arr = Array.isArray(list) ? list : []
      setDepots(arr)
      // Pepinster en priorite, sinon is_default, sinon premier
      const pep = arr.find(d => /pepin/i.test(d.name))
      const def = pep || arr.find(d => d.is_default) || arr[0]
      if (def) setDepartureDepotId(def.id)
    }).catch(() => {})
  }, [])

  // ── Source ────────────────────────────────────────────────────────────────
  // '' au demarrage : la selection est obligatoire (validation canSubmit).
  // sourceManuallySet : empeche selectClient d ecraser un choix manuel.
  const [source,             setSource]             = useState('')
  const [sourceFromOdoo,     setSourceFromOdoo]     = useState(false)
  const [sourceManuallySet,  setSourceManuallySet]  = useState(false)

  // ── Numero dossier (ref externe : PV police, ref assurance, etc.) ────────
  const [dossierNumber,  setDossierNumber]  = useState('')

  // ── Client facturé ────────────────────────────────────────────────────────
  const clientSearch = useClientSearch()
  const [showClientDrop,  setShowClientDrop]  = useState(false)
  const [selectedClient,  setSelectedClient]  = useState<OdooClient|null>(null)
  const [billedName,      setBilledName]      = useState('')
  const [odooPartnerId,   setOdooPartnerId]   = useState<number|null>(null)
  const [showCreateClient, setShowCreateClient] = useState(false)

  // ── Client assisté ────────────────────────────────────────────────────────
  const [assistedName,  setAssistedName]  = useState('')
  const [assistedPhone, setAssistedPhone] = useState('')
  const [assistedAddr,  setAssistedAddr]  = useState('')

  // ── Type + mission ────────────────────────────────────────────────────────
  // Olivier 2026-07-06 : aucun type pré-sélectionné. Avant, 'DSP' apparaissait
  // sélectionné mais n'était pas "effectif" (userPickedType restait false tant
  // qu'on ne cliquait pas) → confusion UI. L'user DOIT choisir le type.
  // (Exception : sources Police pures → REM auto-piqué dans le useEffect ci-dessous,
  //  car le type y est figé et l'auto-pick équivaut à un choix explicite.)
  const [missionType,  setMissionType]  = useState('')
  // Affichage progressif des blocs (Olivier 2026-05-25 : "les bloc s affiche
  // au fur et a mesure de la completion"). Les flags latchent (passent a true
  // une fois la condition remplie et restent, meme si on revient en arriere
  // pour modifier).
  const [userPickedType,     setUserPickedType]     = useState(false)
  const [showType,           setShowType]           = useState(false)
  const [showClients,        setShowClients]        = useState(false)
  const [showAddresses,      setShowAddresses]      = useState(false)
  const [showRest,           setShowRest]           = useState(false)
  const [description,  setDescription]  = useState('')

  // ── Chauffeur assigne (optionnel) ─────────────────────────────────────────
  // Selection via DriverPickerModal (meme composant que les fiches dispatch :
  // ETA temps reel cape a 90 km/h camion, statut libre/en mission, tri ETA).
  // Si selectionne au submit : la mission est creee, le chauffeur assigne
  // (status='assigned') et la push envoyee dans la foulee.
  const [assignedDriverId,   setAssignedDriverId]   = useState<string>('')
  const [assignedDriverName, setAssignedDriverName] = useState<string>('')
  const [showDriverPicker,   setShowDriverPicker]   = useState(false)

  // ── Police / Siabis specifiques ───────────────────────────────────────────
  // policeSubtype : choisi seulement si source === 'police'. Pilote la source
  // reelle envoyee a l API (police_accident, police_saisie, ...).
  const [policeSubtype, setPoliceSubtype] = useState('')
  // sncScenario : pour police_snc / sia_couvert. Pilote le mission_type par
  // defaut (dsp -> DSP, rem_* -> REM).
  const [sncScenario,   setSncScenario]   = useState('dsp')
  const [sncBalisage,   setSncBalisage]   = useState(false)

  // ── Estimation tarif live (panneau resume droite) ────────────────────────
  // Pour Siabis : appel /api/snc-preview-tarif avec debounce.
  // Pour Police/assurance : pas encore branche (placeholder).
  type TarifPreview = {
    total_htva: number
    total_tvac: number
    tva_rate:   number
    lines:      Array<{ name: string; qty: number; price_unit: number; kind?: string }>
  }
  const [tarifPreview, setTarifPreview] = useState<TarifPreview | null>(null)
  const [tarifLoading, setTarifLoading] = useState(false)
  const [tarifError,   setTarifError]   = useState<string | null>(null)

  // Auto-defaults missionType selon source :
  //   - Police pure (Accident/Saisie/Rodeo/AVP/Mal garee) : REM par defaut
  //   - Siabis : selon scenario (dsp->DSP, rem_client->REM, rem_depot->REM+REL)
  //   - Autres : on ne touche pas (sauf si le type courant n est plus dans la
  //     liste autorisee pour la nouvelle source -> reset au premier dispo)
  useEffect(() => {
    if (POLICE_PURE_SOURCES.has((source || '').toLowerCase())) {
      setMissionType('REM')
      // Police : le type est figé (REM ou DPR uniquement), donc auto-pick
      // est equivalent a un choix explicite -> revele la suite du formulaire.
      setUserPickedType(true)
    } else if (source === 'police_snc' || source === 'sia_couvert') {
      // SNC/SC : pas de pre-selection (le user choisit le type d intervention,
      // et sncScenario est derive depuis ce choix dans un autre useEffect).
      // sia_couvert n a pas rem_client comme option (filtre dans
      // getAvailableMissionTypes ailleurs).
    } else {
      // Autres sources : si le missionType courant n est plus dans la liste
      // autorisee pour cette source, reset au premier dispo. Sinon on garde.
      const available = getAvailableMissionTypes(source).map(t => t.value)
      if (missionType && !available.includes(missionType) && available.length > 0) {
        setMissionType(available[0])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sncScenario])

  // Derivation sncScenario depuis missionType (SNC/SC uniquement).
  // Olivier 2026-05-25 : "le scenario est defini via le type d intervention".
  // Olivier 2026-05-26 : "Pour Siabis couvert : Le tarif DPR = le tarif DSP".
  // DSP -> 'dsp', REM -> 'rem_client' par defaut, DPR(SC) -> 'dsp' (tarif).
  useEffect(() => {
    if (source !== 'police_snc' && source !== 'sia_couvert') return
    const isSc = source === 'sia_couvert'
    const derived: 'dsp' | 'rem_client' | 'rem_depot' | '' =
        missionType === 'DSP'                 ? 'dsp'
      : missionType === 'REM'                 ? 'rem_client'
      : (missionType === 'DPR' && isSc)       ? 'dsp'  // SC : DPR = DSP tarif
      :                                          ''
    if (derived !== sncScenario) setSncScenario(derived)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionType, source])

  // === Progressive disclosure : flags qui latchent vers true ===
  // (le flag destinations est plus bas, apres la declaration de `destinations`)
  useEffect(() => { if (source) setShowType(true) }, [source])
  useEffect(() => { if (userPickedType) setShowClients(true) }, [userPickedType])
  useEffect(() => {
    if (odooPartnerId || (billedName && billedName.trim().length >= 2)) setShowAddresses(true)
  }, [odooPartnerId, billedName])

  // ── Véhicule ──────────────────────────────────────────────────────────────
  const vehicleSearch = useVehicleSearch()
  const [showVehicleDrop,  setShowVehicleDrop]  = useState(false)
  const [selectedVehicle,  setSelectedVehicle]  = useState<OdooVehicle|null>(null)
  const [plate,        setPlate]        = useState('')
  const [brand,        setBrand]        = useState('')
  const [model,        setModel]        = useState('')
  const [vin,          setVin]          = useState('')
  const [fuel,         setFuel]         = useState('')
  const [gearbox,      setGearbox]      = useState('')
  // Toggle Voiture/Moto. Pilote la grille tarifaire (Police Accident PCD voiture vs PC moto).
  const [vehicleClass, setVehicleClass] = useState<'car' | 'moto'>('car')
  const [odooVehicleId, setOdooVehicleId] = useState<number|null>(null)
  const [brands,        setBrands]        = useState<Brand[]>([])
  const [models,        setModels]        = useState<Model[]>([])
  const [loadingBrands, setLoadingBrands] = useState(false)

  // ── Destinations ──────────────────────────────────────────────────────────
  const [destinations, setDestinations] = useState<Destination[]>([
    { id: 'incident', label: 'Incident', address: '', lat: null, lng: null, city: '' }
  ])

  // === Progressive disclosure (suite) : flag base sur destinations[0] ===
  useEffect(() => {
    if (destinations[0]?.address && destinations[0].address.trim().length > 3) setShowRest(true)
  }, [destinations])

  // ── Distance ──────────────────────────────────────────────────────────────
  // distanceKm = totalKm par defaut (affichage UI). totalKm et chargedKm
  // exposes separement pour que l API estimate-preview applique la bonne
  // selon le km_basis du tariff (cf 2026-05-25 Olivier "les km doivent
  // inclure les stops intermediaires").
  const [distanceKm,  setDistanceKm]  = useState<number|null>(null)
  const [durationMin, setDurationMin] = useState<number|null>(null)
  const [totalKm,     setTotalKm]     = useState<number|null>(null)
  const [chargedKm,   setChargedKm]   = useState<number|null>(null)

  // ── Avertissements ────────────────────────────────────────────────────────
  const [selectedWarnings, setSelectedWarnings] = useState<string[]>([])

  // Auto-coche le warning "Periphérique / Voie Rapide" pour les sources SNC
  // et SC (interventions autoroute systematiques). Olivier 2026-05-26.
  // Match du warning par label (insensible casse + accents). Si l user
  // l a deja decoche manuellement, on ne le re-coche pas (track via flag).
  const autoWarningAppliedRef = useRef(false)
  useEffect(() => {
    if (source !== 'police_snc' && source !== 'sia_couvert') {
      autoWarningAppliedRef.current = false
      return
    }
    if (autoWarningAppliedRef.current) return
    const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const w = warnings.find(w => {
      const n = norm(w.label)
      return n.includes('peripherique') || n.includes('voie rapide') || n.includes('autoroute')
    })
    if (w && !selectedWarnings.includes(w.id)) {
      setSelectedWarnings(prev => [...prev, w.id])
      autoWarningAppliedRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, warnings])

  // ── Remarques ─────────────────────────────────────────────────────────────
  const [remarksGeneral,  setRemarksGeneral]  = useState('')
  const [remarksBilling,  setRemarksBilling]  = useState('')
  const [amountToCollect, setAmountToCollect] = useState('')
  // Tarif spécial (forfait négocié) : écrase le tarif calculé. Saisi en HTVA ou
  // TVAC ; on stocke toujours HTVA en base (special_tarif_htva). Olivier 2026-07-07.
  const [specialTarif,    setSpecialTarif]    = useState('')
  const [specialTarifVat, setSpecialTarifVat] = useState<'htva' | 'tvac'>('htva')

  // ── Soumission ────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Calcul distance avec DirectionsService (un seul appel, gere les waypoints).
  // On expose 2 valeurs distinctes utilisees par l API estimate-preview :
  //   - totalKm   : depot -> incident -> stops -> retour depot
  //                 (utilise par km_basis='total' : Police Accident, Saisie,
  //                  Prive, Garage)
  //   - chargedKm : incident -> stops -> derniere destination
  //                 (utilise par km_basis='charged' : assurances classiques)
  // Si une seule destination (incident seul) : chargedKm = 0, totalKm =
  // 2 x depot-incident.
  // Resets a 0 si pas d incident.
  useEffect(() => {
    const inc = destinations[0]
    if (!inc?.lat || !inc?.lng) {
      setDistanceKm(0); setDurationMin(0); setTotalKm(0); setChargedKm(0); return
    }
    if (!(window as any).google?.maps) return

    const stops = destinations.slice(1).filter(d => d.lat != null && d.lng != null)
      .map(d => ({ lat: d.lat as number, lng: d.lng as number }))
    const depot = depots.find(d => d.id === departureDepotId)
    const hasDepot = !!(depot?.lat && depot?.lng)
    const depotCoord = hasDepot ? { lat: depot!.lat as number, lng: depot!.lng as number } : null

    const dirSvc = new (window as any).google.maps.DirectionsService()

    // === 1) totalKm : depot -> inc -> stops -> retour depot ===
    if (depotCoord) {
      const waypointsTotal = [
        { location: { lat: inc.lat, lng: inc.lng }, stopover: true },
        ...stops.map(s => ({ location: { lat: s.lat, lng: s.lng }, stopover: true })),
      ]
      dirSvc.route({
        origin:      depotCoord,
        destination: depotCoord,
        waypoints:   waypointsTotal,
        travelMode:  'DRIVING',
      }, (res: any, status: string) => {
        if (status === 'OK' && res?.routes?.[0]?.legs) {
          const totalMeters  = res.routes[0].legs.reduce((s: number, l: any) => s + (l.distance?.value || 0), 0)
          const totalSeconds = res.routes[0].legs.reduce((s: number, l: any) => s + (l.duration?.value || 0), 0)
          const km = Math.round(totalMeters / 1000)
          setTotalKm(km)
          setDistanceKm(km)  // distanceKm = total par defaut (utilise pour affichage UI)
          setDurationMin(Math.round(totalSeconds / 60))
        }
      })
    }

    // === 2) chargedKm : inc -> stops (pas de depot ni retour) ===
    if (stops.length === 0) {
      setChargedKm(0)
    } else {
      const last = stops[stops.length - 1]
      const middle = stops.slice(0, -1).map(s => ({ location: { lat: s.lat, lng: s.lng }, stopover: true }))
      dirSvc.route({
        origin:      { lat: inc.lat, lng: inc.lng },
        destination: { lat: last.lat, lng: last.lng },
        waypoints:   middle,
        travelMode:  'DRIVING',
      }, (res: any, status: string) => {
        if (status === 'OK' && res?.routes?.[0]?.legs) {
          const meters = res.routes[0].legs.reduce((s: number, l: any) => s + (l.distance?.value || 0), 0)
          setChargedKm(Math.round(meters / 1000))
        }
      })
    }
  }, [destinations, depots, departureDepotId])

  // ── Preview tarif live ───────────────────────────────────────────────────
  // Debounce 600ms. Deux endpoints selon la source :
  //   - Siabis (police_snc / sia_couvert) -> /api/snc-preview-tarif
  //     (calcul specifique : depots multiples, balisage, MAJ horaire)
  //   - Autres sources (assurance, prive, garage) -> /api/missions/estimate-preview
  //     (forfait + km extras + surcharges via source_tariffs)
  // Police accident/saisie/... pas branche : tarif pas encore parametre.
  useEffect(() => {
    const isSiabisLocal  = source === 'police_snc' || source === 'sia_couvert'
    const isPoliceLocal  = source === 'police'
    if (isPoliceLocal) {
      setTarifPreview(null); setTarifError(null); setTarifLoading(false); return
    }
    if (!missionType) {
      setTarifPreview(null); setTarifError(null); return
    }
    const inc = destinations[0]
    if (isSiabisLocal && (!inc?.lat || !inc?.lng)) {
      setTarifPreview(null); setTarifError(null); return
    }
    const dest = destinations[1]
    if (isSiabisLocal && sncScenario === 'rem_client' && (!dest?.lat || !dest?.lng)) {
      setTarifPreview(null); setTarifError('Destination requise pour REM-client'); return
    }
    const handle = setTimeout(async () => {
      setTarifLoading(true); setTarifError(null)
      try {
        const interventionAt = rdvDate && rdvTime ? new Date(`${rdvDate}T${rdvTime}:00`).toISOString() : new Date().toISOString()
        let res: Response
        if (isSiabisLocal) {
          res = await fetch('/api/snc-preview-tarif', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scenario:          sncScenario,
              requires_balisage: sncBalisage,
              incident_lat:      inc!.lat,
              incident_lng:      inc!.lng,
              destination_lat:   dest?.lat || null,
              destination_lng:   dest?.lng || null,
              intervention_at:   interventionAt,
              variant:           source === 'sia_couvert' ? 'sc' : 'snc',
            }),
          })
        } else {
          res = await fetch('/api/missions/estimate-preview', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source,
              mission_type:    missionType,
              distance_km:     distanceKm,
              total_km:        totalKm,
              charged_km:      chargedKm,
              intervention_at: interventionAt,
              client_name:     assistedName || billedName || null,
              vehicle_class:   vehicleClass,
              // Forfait Appel Prive saisi par le dispatcher (TVAC). Si rempli,
              // estimateMissionPrice retourne 1 ligne "Forfait negocie" au lieu
              // du fallback police_accident.
              amount_to_collect: amountToCollect ? Number(amountToCollect) : null,
            }),
          })
        }
        const data = await res.json()
        if (data.ok) {
          setTarifPreview({
            total_htva: data.total_htva,
            total_tvac: data.total_tvac,
            tva_rate:   data.tva_rate,
            lines:      data.lines || [],
          })
        } else {
          setTarifPreview(null)
          setTarifError(data.error || 'Erreur calcul tarif')
        }
      } catch (e: any) {
        setTarifPreview(null)
        setTarifError(e.message || 'Erreur réseau')
      } finally {
        setTarifLoading(false)
      }
    }, 600)
    return () => clearTimeout(handle)
  }, [source, missionType, sncScenario, sncBalisage, destinations, distanceKm, totalKm, chargedKm, rdvDate, rdvTime, assistedName, billedName, vehicleClass, amountToCollect])

  // Sélection client facturé → lookup source
  const selectClient = async (c: OdooClient) => {
    setSelectedClient(c)
    setBilledName(c.name)
    setOdooPartnerId(c.id)
    setShowClientDrop(false)
    clientSearch.setQuery(c.name)
    clientSearch.setResults([])

    // Lookup source depuis notre DB. Ne reset PAS la source si le dispatcher
    // a deja fait un choix manuel : on respecte son intention. On met juste a
    // jour sourceFromOdoo si la source connue pour ce partner matche.
    const res  = await fetch(`/api/missions/source-lookup?partner_id=${c.id}`)
    const data = await res.json()
    if (!sourceManuallySet) {
      setSource(data.source)
      setSourceFromOdoo(data.found)
    } else if (data.source === source) {
      setSourceFromOdoo(data.found)
    }
  }

  // Copier client facturé → assisté
  const copyBilledToAssisted = () => {
    if (!selectedClient) return
    setAssistedName(selectedClient.name)
    setAssistedPhone(String(selectedClient.phone || selectedClient.mobile || ''))
    if (selectedClient.street && selectedClient.city) {
      setAssistedAddr(`${selectedClient.street}, ${selectedClient.zip || ''} ${selectedClient.city}`.trim())
    }
  }

  // Sélection véhicule
  const selectVehicle = (v: OdooVehicle) => {
    setSelectedVehicle(v)
    setPlate(v.plate)
    setBrand(v.brand)
    setModel(v.model)
    setVin(String(v.vin || ''))
    setFuel(v.fuel)
    setGearbox(v.gearbox)
    setOdooVehicleId(v.id)
    if (v.partner_name && !selectedClient) setBilledName(v.partner_name)
    setShowVehicleDrop(false)
    vehicleSearch.setQuery(v.plate)
    vehicleSearch.setResults([])
  }

  // Change source : marque la source comme manuelle (empeche ecrasement par
  // selectClient), autosave pour le partner Odoo lie, et autocomplete le client
  // facture si la source a un default_billed_to dans le catalog et qu aucun
  // client n est deja lie.
  const changeSource = async (newSource: string) => {
    setSource(newSource)
    setSourceManuallySet(true)
    if (odooPartnerId) {
      fetch('/api/missions/source-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ odoo_partner_id: odooPartnerId, source: newSource, label: billedName })
      }).catch(() => {})
      setSourceFromOdoo(true)
    }
    // Autocomplete client facture depuis le default de la source (catalog).
    // Comportement attendu (Olivier 2026-05-23) :
    //   - Si la nouvelle source A un default_billed_to -> on REMPLACE le client
    //     courant (cas : on s est trompe de source au depart, on switche)
    //   - Si la nouvelle source N A PAS de default -> on garde le client
    //     courant (cas : source Privee, on a deja saisi le client a la main)
    if (newSource) {
      try {
        const r = await fetch(`/api/missions/source-defaults?source=${encodeURIComponent(newSource)}`)
        const d = await r.json()
        if (d.ok && d.default_billed_to_id) {
          setOdooPartnerId(d.default_billed_to_id)
          setBilledName(d.default_billed_to_name || '')
          clientSearch.setQuery(d.default_billed_to_name || '')
          setSelectedClient({
            id:     d.default_billed_to_id,
            name:   d.default_billed_to_name || '',
            phone:  false, mobile: false, street: false, city: false, zip: false, email: false,
          })
          setSourceFromOdoo(true)
        } else if (d.ok && !d.default_billed_to_id) {
          // Pas de default : on ne touche pas au client existant
          console.warn(`[dispatch/new] Aucun client par defaut pour source '${newSource}'. Configure-le dans /admin/sources si voulu.`)
        }
      } catch (e) {
        console.error('[dispatch/new] source-defaults fetch failed:', e)
      }
    }
  }

  const toggleWarning = (id: string) =>
    setSelectedWarnings(prev => prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id])

  const loadBrands = async () => {
    if (brands.length > 0) return
    setLoadingBrands(true)
    try {
      const res  = await fetch('/api/vehicles?type=brands')
      const data = await res.json()
      setBrands(data || [])
    } finally { setLoadingBrands(false) }
  }

  const loadModels = async (brandId: number) => {
    const res  = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
    const data = await res.json()
    setModels(data || [])
  }

  // Validation derivee pour l'UI (CTA pulse + disabled state)
  const policeSubtypeOk = source !== 'police' || !!policeSubtype
  const canSubmit = !!source
                 && !!missionType
                 && !!destinations[0]?.address
                 && (!!odooPartnerId || !!billedName.trim())
                 && policeSubtypeOk

  // Source reelle envoyee a l API : si Police, c'est le sous-type qui pilote.
  // policeSubtype stocke directement la cle catalog du sub-type (ex: 'police_accident')
  const resolvedSource = source === 'police' && policeSubtype
    ? policeSubtype
    : source

  const isSiabis = source === 'police_snc' || source === 'sia_couvert'

  const handleSubmit = async () => {
    if (!source)                    return setError('Source requise')
    if (!missionType)               return setError('Type de mission requis')
    if (!destinations[0]?.address)  return setError('Lieu d\'incident requis')
    if (!odooPartnerId && !billedName.trim()) {
      return setError('Client requis — sélectionne un client ou tape le nom')
    }
    if (source === 'police' && !policeSubtype) {
      return setError('Sous-type Police requis (Accident / Saisie / Rodéo / AVP / Mal garée)')
    }

    setSaving(true); setError('')

    try {
      // Créer client Odoo si pas lié
      let finalPartnerId = odooPartnerId
      if (!finalPartnerId && billedName.trim()) {
        const res  = await fetch('/api/odoo/create-client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: billedName })
        })
        const data = await res.json()
        if (data.partner) finalPartnerId = data.partner.id
      }

      // Créer véhicule Odoo si pas lié
      let finalVehicleId = odooVehicleId
      if (!finalVehicleId && plate.trim()) {
        const res  = await fetch('/api/odoo/create-vehicle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plate, vin, brand, model, fuel, gearbox, partner_id: finalPartnerId })
        })
        const data = await res.json()
        if (data.vehicle_id) finalVehicleId = data.vehicle_id
      }

      // Libellés des warnings sélectionnés
      const warningLabels = warnings
        .filter(w => selectedWarnings.includes(w.id))
        .map(w => `${w.icon} ${w.label}`)

      // Olivier 2026-06-29 : `${date}T${time}:00` est une heure LOCALE sans
      // fuseau → stockée telle quelle en timestamptz (= UTC) elle décalait
      // l'heure d'intervention de +2h à l'affichage. On convertit l'heure locale
      // du navigateur en UTC ISO avant l'envoi.
      const rdvAt = rdvDate && rdvTime ? new Date(`${rdvDate}T${rdvTime}:00`).toISOString() : null

      const res = await fetch('/api/missions/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source:              resolvedSource,
          mission_type:        missionType,
          dossier_number:      dossierNumber.trim() || null,
          departure_depot_id:  departureDepotId,
          billed_to_name:  billedName,
          billed_to_id:    finalPartnerId,
          assisted_name:   assistedName || billedName,
          assisted_phone:  assistedPhone,
          vehicle_plate:   plate,
          vehicle_brand:   brand,
          vehicle_model:   model,
          vehicle_vin:     vin,
          vehicle_fuel:    fuel,
          vehicle_gearbox: gearbox,
          vehicle_class:   vehicleClass,
          destinations,
          warnings:        warningLabels,
          amount_to_collect: amountToCollect ? parseFloat(amountToCollect) : null,
          // Tarif spécial : stocké en HTVA (÷1,21 si saisi en TVAC).
          special_tarif_htva: specialTarif && !isNaN(parseFloat(specialTarif))
            ? (specialTarifVat === 'tvac'
                ? Math.round((parseFloat(specialTarif) / 1.21) * 100) / 100
                : parseFloat(specialTarif))
            : null,
          description:       description,         // -> incident_description en BDD
          remarks_general:   remarksGeneral,
          remarks_billing:   remarksBilling,
          rdv_at:          rdvAt,
          odoo_partner_id: finalPartnerId,
          odoo_vehicle_id: finalVehicleId,
          distance_km:     distanceKm,
          duration_min:    durationMin,
          // Champs Police / Siabis (envoyes seulement si pertinents)
          snc_scenario:           isSiabis ? sncScenario : null,
          snc_requires_balisage:  isSiabis ? sncBalisage : false,
          police_blocked:         resolvedSource === 'police_avp',
        })
      })

      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Erreur création')

      // Si un chauffeur a ete selectionne : on assigne dans la foulee. L API
      // assign fait passer la mission a status='assigned', notifie le chauffeur
      // par push et met a jour la task FSM Odoo. Best-effort : si l assign
      // echoue, la mission reste creee (status='new'), l erreur affichee.
      if (assignedDriverId) {
        try {
          const assignRes = await fetch('/api/missions/assign', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mission_id: data.mission_id, driver_id: assignedDriverId }),
          })
          const assignData = await assignRes.json()
          if (!assignRes.ok) {
            console.error('[create+assign] assign failed:', assignData?.error)
            // On n affiche pas d erreur bloquante : la mission est creee, le user
            // pourra reassigner depuis la fiche.
          }
        } catch (e) {
          console.error('[create+assign] assign network error:', e)
        }
      }

      router.push(`/dispatch/${data.mission_id}`)
    } catch (err: any) {
      setError(err.message); setSaving(false)
    }
  }

  const warningColorMap: Record<string, string> = {
    red: 'border-red-500/50 bg-red-500/10 text-red-400',
    orange: 'border-orange-500/50 bg-orange-500/10 text-orange-400',
    yellow: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400',
    blue: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
  }

  return (
    <AppShell
      title="Nouvelle mission"
      userName={userName}
      userEmail={userEmail}
      userId={userId}
      userRole={userRole}
      userModules={userModules}
    >
      <style>{`
        @keyframes nm-fade-up {
          /* Olivier 2026-05-28 : on finit sur transform: none (pas translateY(0))
             pour ne PAS laisser un stacking context permanent sur la card. Sinon
             les dropdowns z-50 (recherche client / vehicule) restent prisonniers
             de la card et les cards suivantes leur passent par dessus. */
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes nm-pulse-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(225, 29, 46, 0.0); }
          50%      { box-shadow: 0 0 0 6px rgba(225, 29, 46, 0.15); }
        }
        @keyframes nm-sparkle {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.6; transform: scale(0.92); }
        }
        .nm-card-enter { animation: nm-fade-up 320ms ease-out both; }
        .nm-stagger-1  { animation-delay: 30ms;  }
        .nm-stagger-2  { animation-delay: 70ms;  }
        .nm-stagger-3  { animation-delay: 120ms; }
        .nm-stagger-4  { animation-delay: 180ms; }
        .nm-stagger-5  { animation-delay: 240ms; }
        .nm-stagger-6  { animation-delay: 300ms; }
        .nm-stagger-7  { animation-delay: 360ms; }
        .nm-stagger-8  { animation-delay: 420ms; }
        .nm-stagger-9  { animation-delay: 480ms; }
        .nm-pulse      { animation: nm-pulse-glow 2s ease-in-out infinite; }
        .nm-sparkle    { animation: nm-sparkle    1.6s ease-in-out infinite; }
      `}</style>

      {/* Sticky compact bar : retour + CTA principal (toujours accessible scroll) */}
      <div className="bg-surface/90 backdrop-blur-md border-b px-4 lg:px-8 py-3 sticky top-0 z-20">
        <div className="flex items-center gap-3 max-w-6xl">
          <Link href="/dispatch" className="text-ink-secondary hover:text-ink text-lg flex items-center gap-1.5 transition" title="Retour à la liste dispatch">
            ← <span className="hidden sm:inline text-sm">Dispatch</span>
          </Link>
          <span className="flex-1" />
          <button onClick={handleSubmit} disabled={saving || !canSubmit}
            className={`hidden lg:flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-brand to-brand-dark hover:opacity-90 text-white rounded-xl font-semibold text-sm transition disabled:opacity-40 ${canSubmit && !saving ? 'nm-pulse' : ''}`}>
            {saving ? '⏳ Création...' : '✓ Créer la mission'}
          </button>
        </div>
      </div>

      <div className="relative min-h-[calc(100vh-4rem)]">
        {/* Ambient gradient blobs — purement decoratif, pas d'interaction */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-50">
          <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-brand/15 to-purple-500/10 blur-3xl" />
          <div className="absolute top-1/3 -right-32 w-[480px] h-[480px] rounded-full bg-gradient-to-br from-info/15 to-success/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 w-[380px] h-[380px] rounded-full bg-gradient-to-br from-warning/10 to-brand/5 blur-3xl" />
        </div>

        <div className="relative flex-1 px-4 lg:px-8 py-6 lg:py-8">
          {/* Hero header */}
          <div className="max-w-6xl mb-6 nm-card-enter">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand/20 via-purple-500/15 to-info/15 flex items-center justify-center text-2xl shadow-lg shadow-brand/10 flex-shrink-0">
                <span className="nm-sparkle">✨</span>
              </div>
              <div>
                <h1 className="text-ink text-2xl lg:text-3xl font-bold leading-tight">Nouvelle mission</h1>
                <p className="text-ink-muted text-sm mt-1">Créer un nouveau dossier d'intervention. Les champs en gras se synchronisent automatiquement avec Odoo si lié.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">

            {/* ── Colonne principale ───────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* 1. Date / Heure RDV */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4">🕐 Date / Heure de rendez-vous</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Date</label>
                    <input type="date" value={rdvDate} onChange={e => setRdvDate(e.target.value)}
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Heure</label>
                    <input type="time" value={rdvTime} onChange={e => setRdvTime(e.target.value)}
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                </div>
              </div>

              {/* 2. Depot de depart */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4">🏭 Dépôt de départ</h2>
                <select
                  value={departureDepotId ?? ''}
                  onChange={e => setDepartureDepotId(e.target.value || null)}
                  className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                >
                  {depots.length === 0 && <option value="">Chargement...</option>}
                  {depots.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <p className="text-ink-faint text-xs mt-2">Dépôt depuis lequel le camion part. Modifiable si le chauffeur démarre d'un autre site.</p>
              </div>

              {/* 3. Source + numero dossier + sous-type Police / Siabis */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4">🎯 Source du dossier</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">
                      Source <span className="text-red-400">*</span>
                      {sourceFromOdoo ? <span className="text-ink-faint"> (memorisée pour ce client)</span> : ''}
                    </label>
                    <select value={source} onChange={e => changeSource(e.target.value)}
                      className={`w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand ${!source ? 'border-amber-500/50' : ''}`}>
                      <option value="">— Sélectionner une source —</option>
                      {dropdownSources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Numéro de dossier <span className="text-ink-faint">(optionnel)</span></label>
                    <input value={dossierNumber} onChange={e => setDossierNumber(e.target.value)}
                      placeholder="PV, ref assurance, ref interne..."
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm font-mono focus:outline-none focus:border-brand placeholder:text-ink-faint placeholder:font-sans" />
                  </div>
                </div>

                {/* Sous-type Police (si source=police) : liste dynamique du catalog */}
                {source === 'police' && (
                  <div className="mt-5 pt-5 border-t">
                    <p className="text-ink-muted text-xs mb-3">Sous-type d'intervention Police (pilote tarif et zone parc par défaut) :</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                      {policeSubtypeSources.length === 0 && (
                        <p className="col-span-full text-ink-faint text-xs italic">
                          Aucun sous-type Police configuré. Ajoute des sources avec <span className="font-mono">group_key=police</span> dans <a href="/admin/sources" className="underline">/admin/sources</a>.
                        </p>
                      )}
                      {policeSubtypeSources.map(t => (
                        <button key={t.key} onClick={() => setPoliceSubtype(t.key)} type="button"
                          className={`px-3 py-3 rounded-xl text-sm font-medium border transition text-center ${
                            policeSubtype === t.key
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-surface border text-ink-secondary hover:text-ink hover:border-strong'
                          }`}>
                          {shortLabelForPoliceSubtype(t.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Détails Siabis (si source=police_snc ou sia_couvert) */}
                {(source === 'police_snc' || source === 'sia_couvert') && (
                  <div className="mt-5 pt-5 border-t space-y-4">
                    <p className="text-ink-muted text-xs">
                      {source === 'sia_couvert'
                        ? '🛣️ Tarif assistance (forfait sans km). Le client facturé doit être l\'assistance qui paye.'
                        : '🛣️ Tarif Siabis Non Couvert (forfait + km dépanneuse). Encaissement immédiat sauf si mise en dépôt.'}
                      {' '}Le chauffeur peut tout modifier sur sa fiche.
                    </p>
                    {/* Le scenario SNC (dsp/rem_client/rem_depot) est derive
                        automatiquement du Type d intervention selectionne plus
                        bas (Olivier 2026-05-25 : "le scenario est defini via
                        le type d intervention"). Pas de champ separe. */}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={sncBalisage} onChange={e => setSncBalisage(e.target.checked)}
                        className="w-5 h-5 accent-cyan-500" />
                      <span className="text-ink text-sm">Balisage requis (autoroute / voie rapide)</span>
                    </label>
                  </div>
                )}
              </div>

              {/* 3. Type d'intervention (apparait apres choix de la source).
                  Boutons explicites avec descriptions contextuelles selon
                  la source choisie. Inspire de PoliceClient.tsx cote
                  chauffeur (Olivier 2026-05-25 : "version chauffeur dans
                  creer mission qui sont ok, on arrive pas a les reproduire
                  dans le dispatch"). */}
              {showType && (
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4">📋 Type d'intervention</h2>
                {(() => {
                  const isSnc        = source === 'police_snc'
                  const isSc         = source === 'sia_couvert'
                  const isPoliceHere = POLICE_PURE_SOURCES.has((source || '').toLowerCase())
                  // Descriptions par source. Si une source n a pas d entree
                  // specifique, on tombe sur 'default'.
                  const desc: Record<string, Record<string, string>> = {
                    snc: {
                      DSP: 'Dépannage sur place — réparation autoroute, client paye direct',
                      REM: 'Remorquage — paiement immédiat du client ou dépôt parc selon décision chauffeur',
                      DPR: 'Déplacement pour rien — intervention annulée',
                    },
                    sc: {
                      DSP: 'Dépannage sur place — facturé à l\'assistance',
                      REM: 'Remorquage vers destination ou dépôt — facturé à l\'assistance',
                      DPR: 'Déplacement pour rien — intervention annulée',
                    },
                    police: {
                      REM: 'Remorquage vers parc fourrière',
                      DPR: 'Déplacement pour rien — mission annulée par police',
                    },
                    default: {
                      DSP:       'Dépannage sur place — réparation directe au véhicule',
                      REM:       'Remorquage simple vers une destination',
                      Transport: 'Transport / rapatriement longue distance',
                      DPR:       'Déplacement pour rien — intervention annulée',
                    },
                  }
                  const pickDesc = (t: string) =>
                    (isSnc && desc.snc[t]) ||
                    (isSc  && desc.sc[t]) ||
                    (isPoliceHere && desc.police[t]) ||
                    desc.default[t] || ''
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {getAvailableMissionTypes(source).map(t => {
                        const selected = missionType === t.value
                        return (
                          <button key={t.value} onClick={() => { setMissionType(t.value); setUserPickedType(true) }} type="button"
                            className={`px-3 py-3 rounded-xl text-sm border-2 transition text-left ${
                              selected
                                ? 'bg-brand border-brand text-white shadow-md'
                                : 'bg-surface border-strong text-ink hover:border-brand/50 hover:bg-brand/5'
                            }`}>
                            <div className="font-bold flex items-center gap-1.5">
                              <span>{t.label.split(' ')[0]}</span>
                              <span>{t.value}</span>
                            </div>
                            <div className={`text-xs mt-1 leading-snug ${selected ? 'text-white/85' : 'text-ink-muted'}`}>
                              {pickDesc(t.value)}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
                <div className="mt-4">
                  <label className="block text-ink-muted text-xs mb-1.5">Description / Détails</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)}
                    rows={2} placeholder="Détails de l'intervention..."
                    className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand resize-none placeholder:text-ink-faint" />
                </div>
              </div>
              )}

              {/* 4. Client facturé + Client assisté (apparaissent apres choix d un type) */}
              {showClients && (<>
              <div
                className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter relative"
                style={showClientDrop ? { zIndex: 50 } : undefined}
              >
                <h2 className="text-ink font-semibold text-sm mb-4">🧾 Client facturé</h2>
                <div className="relative mb-3">
                  <label className="block text-ink-muted text-xs mb-1.5">Rechercher un client</label>
                  <input value={clientSearch.query}
                    onChange={e => { clientSearch.setQuery(e.target.value); setShowClientDrop(true) }}
                    onFocus={() => setShowClientDrop(true)}
                    onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                    placeholder="Min. 3 caractères — nom ou téléphone..."
                    className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
                  {showClientDrop && clientSearch.results.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border rounded-xl shadow-xl overflow-hidden">
                      {clientSearch.results.map(c => (
                        <button key={c.id} onMouseDown={() => selectClient(c)}
                          className="w-full text-left px-4 py-3 hover:bg-surface-hover transition border-b border last:border-0">
                          <p className="text-ink text-sm font-medium">{c.name}</p>
                          <p className="text-ink-muted text-xs">{[c.phone || c.mobile, c.city].filter(Boolean).join(' · ')}</p>
                        </button>
                      ))}
                      <button
                        type="button"
                        onMouseDown={() => { setShowClientDrop(false); setShowCreateClient(true) }}
                        className="w-full text-left px-4 py-3 bg-brand/5 hover:bg-brand/10 transition border-t border-brand/30"
                      >
                        <p className="text-brand text-sm font-semibold">＋ Créer un nouveau client</p>
                        <p className="text-ink-muted text-xs">Aucun de ces résultats ne convient ? Ouvre le formulaire de création.</p>
                      </button>
                    </div>
                  )}
                  {showClientDrop && clientSearch.query.trim().length >= 3 && clientSearch.results.length === 0 && !clientSearch.loading && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border rounded-xl shadow-xl overflow-hidden">
                      <div className="px-4 py-3 text-ink-muted text-xs">
                        Aucun client trouvé pour <span className="font-mono">{clientSearch.query}</span>.
                      </div>
                      <button
                        type="button"
                        onMouseDown={() => { setShowClientDrop(false); setShowCreateClient(true) }}
                        className="w-full text-left px-4 py-3 bg-brand/5 hover:bg-brand/10 transition border-t border-brand/30"
                      >
                        <p className="text-brand text-sm font-semibold">＋ Créer ce client</p>
                        <p className="text-ink-muted text-xs">Formulaire pré-rempli avec "{clientSearch.query}"</p>
                      </button>
                    </div>
                  )}
                </div>

                {selectedClient && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-3">
                    <span className="text-green-400 text-xs">✓ Client lié</span>
                    <span className="text-green-300 text-xs font-medium">{selectedClient.name}</span>
                    <button onClick={() => { setSelectedClient(null); setOdooPartnerId(null); clientSearch.setQuery(''); setBilledName('') }}
                      className="ml-auto text-ink-muted hover:text-red-400 text-xs">✕</button>
                  </div>
                )}

                <div>
                  <label className="block text-ink-muted text-xs mb-1.5">Nom / Raison sociale</label>
                  <input
                    value={billedName}
                    readOnly
                    placeholder="Rempli automatiquement via la recherche ci-dessus"
                    title="Champ en lecture seule — passe par la recherche ou clique sur '＋ Créer un nouveau client' si introuvable"
                    className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink-secondary text-sm placeholder:text-ink-faint cursor-not-allowed" />
                </div>
              </div>

              {/* 3. Client assisté */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-ink font-semibold text-sm">👤 Client assisté (personne en panne)</h2>
                  <button onClick={copyBilledToAssisted}
                    className="text-xs text-brand hover:underline">
                    = Copier client facturé
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Nom complet</label>
                    <input value={assistedName} onChange={e => setAssistedName(e.target.value)}
                      placeholder="Prénom Nom"
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Téléphone</label>
                    <input value={assistedPhone} onChange={e => setAssistedPhone(e.target.value)}
                      placeholder="+32..."
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint" />
                  </div>
                </div>
              </div>
              </>)}

              {/* 5. Adresses (apparait apres selection du client facture) */}
              {showAddresses && (
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4">📍 Adresses</h2>
                <DestinationsBlock
                  destinations={destinations}
                  onChange={setDestinations}
                  gmKey={googleMapsKey}
                />
                {distanceKm !== null && (
                  <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-surface border rounded-xl">
                    <span className="text-ink-secondary text-sm">🛣️</span>
                    <span className="text-ink font-semibold">{distanceKm} km</span>
                    <span className="text-ink-muted">·</span>
                    <span className="text-ink font-semibold">~{durationMin} min</span>
                    <span className="text-ink-muted text-xs">(voiture — camion +15-20%)</span>
                  </div>
                )}
              </div>
              )}

              {/* 6+. Vehicule + Avertissements + Remarques + autres
                  (apparaissent apres saisie d une adresse minimum) */}
              {showRest && (<>

              {/* 6. Véhicule */}
              <div
                className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter relative"
                style={showVehicleDrop ? { zIndex: 50 } : undefined}
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-ink font-semibold text-sm">🚗 Véhicule</h2>
                  {/* Toggle Voiture/Moto : pilote la grille tarifaire Police Accident (PCD voiture vs PC moto). */}
                  <div className="inline-flex bg-surface-2 rounded-lg p-0.5 border" role="radiogroup" aria-label="Type de véhicule">
                    <button type="button" onClick={() => setVehicleClass('car')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition ${vehicleClass === 'car' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}>
                      🚗 Voiture
                    </button>
                    <button type="button" onClick={() => setVehicleClass('moto')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition ${vehicleClass === 'moto' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}>
                      🏍️ Moto
                    </button>
                  </div>
                </div>
                <div className="relative mb-4">
                  <label className="block text-ink-muted text-xs mb-1.5">Rechercher dans le parc (plaque ou VIN)</label>
                  <input value={vehicleSearch.query}
                    onChange={e => { vehicleSearch.setQuery(e.target.value.toUpperCase()); setShowVehicleDrop(true) }}
                    onFocus={() => setShowVehicleDrop(true)}
                    onBlur={() => setTimeout(() => setShowVehicleDrop(false), 150)}
                    placeholder="Min. 3 caractères..."
                    className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm font-mono uppercase focus:outline-none focus:border-brand placeholder:normal-case placeholder:text-ink-faint" />
                  {showVehicleDrop && vehicleSearch.results.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border rounded-xl shadow-xl overflow-hidden">
                      {vehicleSearch.results.map(v => (
                        <button key={v.id} onMouseDown={() => selectVehicle(v)}
                          className="w-full text-left px-4 py-3 hover:bg-surface-hover transition border-b border last:border-0">
                          <p className="text-ink text-sm font-bold font-mono">{v.plate}</p>
                          <p className="text-ink-secondary text-xs">{[v.brand, v.model].filter(Boolean).join(' ')} {v.partner_name ? `· ${v.partner_name}` : ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedVehicle && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
                    <span className="text-green-400 text-xs">✓ Véhicule lié</span>
                    <span className="text-green-300 text-xs font-mono font-medium">{selectedVehicle.plate}</span>
                    <button onClick={() => { setSelectedVehicle(null); setOdooVehicleId(null); vehicleSearch.setQuery('') }}
                      className="ml-auto text-ink-muted hover:text-red-400 text-xs">✕</button>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {/* Plaque */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Plaque</label>
                    <div className="flex gap-1.5">
                      <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())}
                        className="flex-1 bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm font-mono uppercase focus:outline-none focus:border-brand" />
                      <ScanButton mode="plate" value={plate} onScan={setPlate}
                        className="px-2.5 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
                    </div>
                  </div>

                  {/* Marque */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Marque</label>
                    <select
                      value={brand}
                      onFocus={loadBrands}
                      onChange={e => {
                        const b = brands.find(b => b.name === e.target.value)
                        setBrand(e.target.value)
                        setModel('')
                        setModels([])
                        if (b) loadModels(b.id)
                      }}
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                    >
                      <option value="">{loadingBrands ? 'Chargement...' : '— Sélectionner —'}</option>
                      {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                    </select>
                  </div>

                  {/* Modèle */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Modèle</label>
                    {models.length > 0 ? (
                      <select value={model} onChange={e => setModel(e.target.value)}
                        className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand">
                        <option value="">— Sélectionner —</option>
                        {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                        <option value="_custom">Autre (saisie libre)</option>
                      </select>
                    ) : (
                      <input value={model} onChange={e => setModel(e.target.value)}
                        placeholder={brand ? 'Saisie libre...' : "Choisir une marque d'abord"}
                        disabled={!brand}
                        className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand disabled:opacity-40" />
                    )}
                  </div>

                  {/* VIN */}
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">VIN / Châssis</label>
                    <div className="flex gap-1.5">
                      <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())}
                        className="flex-1 bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm font-mono uppercase focus:outline-none focus:border-brand" />
                      <ScanButton mode="vin" value={vin} onScan={setVin}
                        className="px-2.5 bg-brand/10 text-brand rounded-xl text-sm flex items-center" label="📷" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Carburant</label>
                    <select value={fuel} onChange={e => setFuel(e.target.value)}
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand">
                      <option value="">—</option>
                      {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Boîte</label>
                    <select value={gearbox} onChange={e => setGearbox(e.target.value)}
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand">
                      <option value="">—</option>
                      {GEARBOX_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* 7. Avertissements */}
              {warnings.length > 0 && (
                <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                  <h2 className="text-ink font-semibold text-sm mb-4">⚠️ Avertissements</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {warnings.map(w => {
                      const selected = selectedWarnings.includes(w.id)
                      const colors   = warningColorMap[w.color] || warningColorMap.orange
                      return (
                        <button key={w.id} onClick={() => toggleWarning(w.id)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition ${
                            selected ? colors : 'border bg-surface text-ink-muted hover:text-ink'
                          }`}>
                          <span>{w.icon}</span>
                          <span className="text-xs text-left leading-tight">{w.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 8. Paiement à réclamer au client — mis en evidence pour eviter l oubli */}
              <div className={`rounded-2xl p-5 transition nm-card-enter ${amountToCollect ? 'bg-amber-500/10 border-2 border-amber-500/60 shadow-lg shadow-amber-500/10' : 'bg-amber-500/5 border-2 border-amber-500/30 hover:border-amber-500/50'}`}>
                <h2 className="text-ink font-bold text-base mb-2 flex items-center gap-2">
                  <span className="text-2xl">💳</span> Paiement à réclamer au client
                </h2>
                <p className="text-ink-secondary text-xs mb-4">⚠️ N'oublie pas si encaissement immédiat (DSP particulier, SNC, etc.). Laisser vide si facturation directe à l'assurance.</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={amountToCollect}
                    onChange={e => setAmountToCollect(e.target.value)}
                    placeholder="0.00"
                    className="w-40 bg-surface border-2 border-amber-500/40 rounded-xl px-3 py-2.5 text-ink text-base font-semibold focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-ink font-medium text-base">€</span>
                </div>
              </div>

              {/* 8b. Tarif spécial (forfait négocié) — écrase le tarif calculé.
                  Saisie HTVA ou TVAC ; stocké en HTVA. Olivier 2026-07-07. */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-1 flex items-center gap-2">
                  <span>🏷️</span> Tarif spécial <span className="text-ink-faint text-xs">(optionnel)</span>
                </h2>
                <p className="text-ink-muted text-xs mb-3">Forfait négocié qui <strong>remplace le tarif calculé automatiquement</strong>. Laisser vide pour le tarif normal.</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={specialTarif}
                    onChange={e => setSpecialTarif(e.target.value)}
                    placeholder="0.00"
                    className="w-40 bg-surface border rounded-xl px-3 py-2.5 text-ink text-base font-semibold focus:outline-none focus:border-brand"
                  />
                  <span className="text-ink font-medium text-base">€</span>
                  <div className="inline-flex rounded-xl overflow-hidden border">
                    <button type="button" onClick={() => setSpecialTarifVat('htva')}
                      className={`px-3 py-2 text-sm font-medium transition ${specialTarifVat === 'htva' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}>HTVA</button>
                    <button type="button" onClick={() => setSpecialTarifVat('tvac')}
                      className={`px-3 py-2 text-sm font-medium transition ${specialTarifVat === 'tvac' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}>TVAC</button>
                  </div>
                </div>
                {specialTarif && specialTarifVat === 'tvac' && !isNaN(parseFloat(specialTarif)) && (
                  <p className="text-ink-muted text-[11px] mt-2">
                    Enregistré en HTVA : <strong>{(parseFloat(specialTarif) / 1.21).toFixed(2)} €</strong> (TVA 21%)
                  </p>
                )}
              </div>

              {/* 9. Remarques (avant Chauffeur assigne : reorganise 2026-05-26).
                  Olivier : "Chauffeur assigne doit etre le dernier bloc etant
                  donne que ca correspond a la derniere action avant que la
                  mission ne parte vers un autre intervenant". */}
              <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter">
                <h2 className="text-ink font-semibold text-sm mb-4">📝 Remarques</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Remarques générales (visible bureau + chauffeur)</label>
                    <textarea value={remarksGeneral} onChange={e => setRemarksGeneral(e.target.value)}
                      rows={3} className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand resize-none" />
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1.5">Remarque de facturation</label>
                    <textarea value={remarksBilling} onChange={e => setRemarksBilling(e.target.value)}
                      rows={2} placeholder="Note pour la facturation (ex. facturer 2 dépannages ensemble, bon de commande à joindre, tarif dérogatoire convenu…)"
                      className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand resize-none placeholder:text-ink-faint" />
                    <p className="text-ink-faint text-[11px] mt-1">Enregistrée comme 1ʳᵉ remarque (signée) ; rappelée et bloquée à la facturation.</p>
                  </div>
                </div>
              </div>

              {/* 10. Chauffeur assigne (optionnel) — DERNIER bloc : c est la
                  derniere action avant que la mission ne parte vers un autre
                  intervenant (Olivier 2026-05-26). */}
              <div className={`rounded-2xl p-5 transition nm-card-enter ${assignedDriverId ? 'bg-green-500/10 border-2 border-green-500/60' : 'bg-surface border'}`}>
                <h2 className="text-ink font-semibold text-sm mb-2 flex items-center gap-2">
                  <span>👷</span> Chauffeur assigné <span className="text-ink-faint text-xs">(optionnel)</span>
                </h2>
                <p className="text-ink-muted text-xs mb-3">
                  Si tu choisis un chauffeur : la mission sera créée + assignée + envoyée à son téléphone en un clic.
                  Sinon elle restera dans la file d'attente du dispatch.
                </p>
                {assignedDriverId ? (
                  <div className="flex items-center gap-3 px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-xl">
                    <span className="text-2xl">🚛</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-green-300 text-sm font-semibold truncate">{assignedDriverName}</p>
                      <p className="text-green-400/80 text-xs">Sera notifié dès création de la mission</p>
                    </div>
                    <button type="button" onClick={() => { setAssignedDriverId(''); setAssignedDriverName('') }}
                      className="text-ink-muted hover:text-red-400 text-xs px-2">✕ Retirer</button>
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => setShowDriverPicker(true)}
                    disabled={!destinations[0]?.lat || !destinations[0]?.lng}
                    title={!destinations[0]?.lat ? 'Renseigne d abord le lieu d incident (avec autocomplete Google) pour calculer les ETA' : ''}
                    className="w-full py-2.5 bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand rounded-xl text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed">
                    {!destinations[0]?.lat
                      ? '📍 Renseigne d\'abord le lieu d\'incident'
                      : '🚛 Choisir un chauffeur (ETA temps réel)'}
                  </button>
                )}
              </div>

              </>)}
            </div>

            {/* ── Colonne droite : résumé + action (sticky en desktop) ──────
                Sticky direct sur la card avec align-self: start pour empecher
                le grid item de stretch (sinon sticky n a pas d effet visible
                car deja en haut). Pas de max-h/overflow interne (creerait un
                scroll context qui peut casser sticky par rapport a <main>).
            */}
            <div className="bg-surface border rounded-2xl p-5 hover:border-brand/30 transition nm-card-enter space-y-4 lg:sticky lg:top-24 lg:self-start">

                {error && (
                  <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <button onClick={handleSubmit} disabled={saving || !canSubmit}
                  title={!canSubmit ? 'Renseigne : source, type, lieu, client (+ sous-type Police si Police)' : ''}
                  className={`w-full py-3 bg-gradient-to-r from-brand to-brand-dark hover:opacity-90 text-white rounded-xl font-semibold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${canSubmit && !saving ? 'nm-pulse' : ''}`}>
                  {saving
                    ? '⏳ Création en cours...'
                    : !canSubmit
                      ? 'Compléter les champs requis'
                      : assignedDriverId
                        ? `✓ Créer + envoyer à ${(assignedDriverName || '').split(' ')[0]}`
                        : '✓ Créer la mission'}
                </button>

                <Link href="/dispatch"
                  className="block w-full py-2.5 bg-surface border text-ink-secondary hover:text-ink rounded-xl text-sm text-center transition">
                  Annuler
                </Link>

                {/* Résumé */}
                <div className="border-t border pt-4 space-y-2">
                  <p className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">Résumé</p>
                  {[
                    { label: 'RDV',      value: rdvDate && rdvTime ? `${rdvDate} ${rdvTime}` : '—' },
                    ...(dossierNumber ? [{ label: 'N° dossier', value: dossierNumber }] : []),
                    {
                      label: 'Source',
                      value: source === 'police'
                        ? `POLICE${policeSubtype ? ' — ' + shortLabelForPoliceSubtype(policeSubtypeSources.find(s => s.key === policeSubtype)?.label || policeSubtype) : ' (sous-type requis)'}`
                        : (dropdownSources.find(s => s.key === source)?.label || source),
                    },
                    ...(isSiabis ? [{
                      label: 'Scénario',
                      value: (SNC_SCENARIOS.find(s => s.value === sncScenario)?.label || sncScenario)
                           + (sncBalisage ? ' · 🚧 balisage' : ''),
                    }] : []),
                    { label: 'Type',     value: MISSION_TYPES.find(t => t.value === missionType)?.label || '—' },
                    { label: 'Facturé', value: billedName || '—' },
                    { label: 'Assisté', value: assistedName || billedName || '—' },
                    { label: 'Véhicule', value: plate || '—' },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between gap-2">
                      <span className="text-ink-muted text-xs flex-shrink-0">{r.label}</span>
                      <span className="text-ink text-xs text-right truncate">{r.value}</span>
                    </div>
                  ))}

                  {odooPartnerId && (
                    <div className="flex items-center gap-1.5 text-green-400 text-xs">✓ Client lié</div>
                  )}
                  {odooVehicleId && (
                    <div className="flex items-center gap-1.5 text-green-400 text-xs">✓ Véhicule lié</div>
                  )}
                  {distanceKm !== null && (
                    <div className="flex justify-between">
                      <span className="text-ink-muted text-xs">Distance</span>
                      <span className="text-ink text-xs">{distanceKm} km · ~{durationMin} min</span>
                    </div>
                  )}
                  {selectedWarnings.length > 0 && (
                    <div>
                      <span className="text-ink-muted text-xs">Avertissements</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {warnings.filter(w => selectedWarnings.includes(w.id)).map(w => (
                          <span key={w.id} className="text-xs">{w.icon} {w.label}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Estimation tarif live */}
                <div className="border-t border pt-4">
                  <p className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-2">💰 Estimation tarif</p>
                  {source === 'police' ? (
                    <p className="text-ink-faint text-xs italic">Tarif Police pas encore paramétré</p>
                  ) : tarifLoading ? (
                    <p className="text-ink-faint text-xs italic">Calcul...</p>
                  ) : tarifError ? (
                    <p className="text-amber-400 text-xs">{tarifError}</p>
                  ) : tarifPreview ? (
                    <>
                      <div className="space-y-1 mb-2">
                        {tarifPreview.lines.map((l, i) => {
                          const unit = l.kind === 'SERV-PARC' ? 'jour' : l.kind === 'SERV-KM' ? 'km' : 'u'
                          return (
                            <div key={i} className="flex justify-between text-xs gap-2">
                              <span className="text-ink-muted truncate" title={l.name}>{l.name}</span>
                              <span className={`whitespace-nowrap ${l.qty > 0 ? 'text-ink' : 'text-ink-faint italic'}`}>
                                {l.qty > 0
                                  ? `${(l.qty * l.price_unit).toFixed(2)} €`
                                  : `${l.price_unit.toFixed(2)} €/${unit}`}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="border-t pt-2 flex justify-between text-sm">
                        <span className="text-ink font-medium">Total HTVA</span>
                        <span className="text-ink font-bold">{tarifPreview.total_htva.toFixed(2)} €</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-ink-muted">TVAC ({Math.round(tarifPreview.tva_rate * 100)}%)</span>
                        <span className="text-ink-muted">{tarifPreview.total_tvac.toFixed(2)} €</span>
                      </div>
                    </>
                  ) : isSiabis ? (
                    <p className="text-ink-faint text-xs italic">
                      Renseigne le lieu d'incident{sncScenario === 'rem_client' ? ' et la destination' : ''}
                    </p>
                  ) : (
                    <p className="text-ink-faint text-xs italic">Renseigne les adresses pour estimer</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {showCreateClient && (
          <CreateClientModal
            initialName={clientSearch.query || billedName}
            gmKey={googleMapsKey}
            onClose={() => setShowCreateClient(false)}
            onCreated={(client) => {
              // Le nouveau client devient le client lie : on appelle selectClient
              // avec un objet conforme a l'interface OdooClient locale.
              const odooClient: OdooClient = {
                id:     client.id,
                name:   client.name,
                phone:  client.phone || false,
                mobile: client.mobile || false,
                street: client.street || false,
                city:   client.city || false,
                zip:    client.zip || false,
                email:  client.email || false,
              }
              selectClient(odooClient)
              setShowCreateClient(false)
            }}
          />
        )}
        {showDriverPicker && destinations[0]?.lat && destinations[0]?.lng && (
          <DriverPickerModal
            // La mission n existe pas encore : UUID placeholder. Le backend
            // utilise les coords passees en query, donc params.id ne sert qu a
            // exclure les missions actives — un UUID inexistant n exclut rien.
            missionId={'00000000-0000-0000-0000-000000000000'}
            incidentLat={destinations[0].lat}
            incidentLng={destinations[0].lng}
            onPick={(driverId) => {
              setAssignedDriverId(driverId)
              setAssignedDriverName(drivers.find(d => d.id === driverId)?.name || '')
              setShowDriverPicker(false)
            }}
            onClose={() => setShowDriverPicker(false)}
          />
        )}
    </AppShell>
  )
}
