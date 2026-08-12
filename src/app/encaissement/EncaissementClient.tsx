'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import VehiclePlateLookup from '@/components/vehicles/VehiclePlateLookup'
import QRScanner from '@/components/fourriere/QRScanner'
import { normalizePlate } from '@/lib/plate'
import { formatEur } from '@/lib/format'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import QRCode from 'qrcode'
import { buildEpcQrPayload, bankConfigFromEnv } from '@/lib/payments/epc-qr'
import { useT } from '@/lib/i18n/I18nProvider'
import { T }    from '@/lib/i18n/T'
import type { VehicleMatch } from '@/types/vehicles'

// ─────────────────────────────────────────────────────────
// CLASSES PARTAGÉES — pattern aligné avec /admin/depots et /admin/users.
// À promouvoir en composant atomique <Input> en sub-phase 2.3.B.
// ─────────────────────────────────────────────────────────

const inputCls =
  'w-full bg-surface border rounded-md px-3 py-2.5 text-sm text-ink ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft ' +
  'placeholder:text-ink-muted transition-colors'

const inputXLCls =
  'w-full bg-surface border rounded-md px-4 py-4 text-2xl font-bold text-ink ' +
  'text-center tracking-widest uppercase ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft ' +
  'placeholder:text-ink-muted transition-colors'

const inputMontantCls =
  'w-full bg-surface border rounded-md px-4 py-4 text-3xl font-bold text-ink ' +
  'text-center ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft ' +
  'placeholder:text-ink-muted transition-colors'

const labelCls = 'block text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1.5'

interface ListItem { value: string; label: string }
interface Brand { id: number; name: string }
interface Model { id: number; name: string }
interface OdooClient {
  id: number; name: string; phone: string; email: string
  address: string; street: string; zip: string; city: string
  countryCode: string; vat: string
}
interface OdooVehicle {
  id: number; licensePlate: string; brandName: string
  modelName: string; displayName: string; vinSn: string
}

declare global {
  interface Window { google?: any; initGooglePlaces?: () => void }
}


// ── Composants UI définis HORS du composant principal ──────
function BaseShell({
  children, title, page, totalPages, onBack, topNotice,
  userRole = '', userName = '', userModules = [],
}: {
  children:     React.ReactNode
  title:        string
  page:         number
  totalPages:   number
  onBack?:      () => void
  topNotice?:   React.ReactNode  // banner contextuel (ex: restitution fourriere)
  userRole?:    string
  userName?:    string
  userModules?: string[]
}) {
  // Barre de progression — passée à AppShell via headerExtra (mobile + desktop)
  const progressBar = (
    <div className="flex gap-1">
      {Array.from({ length: totalPages }).map((_, i) => (
        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= page ? 'bg-brand' : 'bg-surface-hover'}`} />
      ))}
    </div>
  )

  return (
    <AppShell title={title} userRole={userRole} userName={userName} userModules={userModules} headerExtra={progressBar}>
      {/* Bouton "Retour étape" — visible mobile et desktop, juste au-dessus du contenu wizard.
          Sub-phase 2.3.A : on a supprimé le sous-header mobile dupliqué (qui re-rendait
          back + title + progressBar par-dessus l'AppShell). L'AppShell mobile gère déjà
          le burger, le logo, le titre et la progress bar via headerExtra. Ce bouton-ci
          ne sert qu'au "retour d'étape" du wizard, distinct du ← global qui revient au
          dashboard. */}
      {onBack && (
        <div className="px-5 lg:px-8 pt-4">
          <button onClick={onBack}
            className="inline-flex items-center gap-1.5 text-ink-secondary hover:text-ink text-sm font-medium transition-colors">
            <ArrowLeft size={14} />
            <T k="encaissement.btn_back" />
          </button>
        </div>
      )}

      {topNotice && (
        <div className="px-5 lg:px-8 pt-3 max-w-md lg:max-w-2xl mx-auto w-full">
          {topNotice}
        </div>
      )}

      <AmbientBackground>
      <div className="flex-1 px-5 lg:px-8 py-6 overflow-y-auto max-w-md lg:max-w-2xl mx-auto w-full ambient-fade-up">{children}</div>
      </AmbientBackground>
    </AppShell>
  )
}

function BigBtn({ label, onClick, disabled, secondary }: {
  label: string; onClick: () => void; disabled?: boolean; secondary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-2xl py-4 text-base font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
        secondary
          ? 'bg-surface border text-ink-secondary hover:bg-surface-hover hover:border-strong'
          : 'bg-brand text-white shadow-brand hover:bg-brand-hover hover:shadow-brand-hover'
      }`}
    >
      {label}
    </button>
  )
}

function ChoiceBtn({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-2xl border font-medium transition-all active:scale-95 ${
        selected
          ? 'bg-brand-soft border-brand text-brand'
          : 'bg-surface text-ink hover:bg-surface-hover hover:border-strong'
      }`}
    >
      {label}
    </button>
  )
}

// ── Composant principal ─────────────────────────────────────
interface Prefill {
  mission_id?: string
  plate?:      string
  brand?:      string
  model?:      string
  amount?:     number
  // Olivier 2026-05-26 : adresse + motif precision precompletes depuis la mission
  location?:        string
  motif_precision?: string
  // Olivier 2026-05-27 : label du motif a pre-selectionner (matching dans motifs[])
  motif_label?:     string
  return_to?:  string
  // Prefill fourriere (bouton "Restituer" depuis /recherche)
  type?:       'fourriere'
  vehicle_id?: string
  ticket_id?:  string
  entry_date?: string
  days?:       number
}

export default function EncaissementClient({
  motifs, paymentModes, prefill,
  userRole = '', userName = '', userModules = [],
}: {
  motifs:        ListItem[]
  paymentModes:  ListItem[]
  prefill?:      Prefill
  userRole?:     string
  userName?:     string
  userModules?:  string[]
}) {
  const router = useRouter()
  const { t } = useT()

  // Si on vient d une mission (prefill mission_id), on skip page 0 (saisie plaque)
  // et page 1 (lookup vehicule Odoo) car ces infos sont deja remplies depuis
  // la mission liee. On demarre directement page 3 (lieu intervention) car le
  // motif est aussi auto-pre-rempli via le mecanisme prefill_motif_label (Fix G/H
  // Olivier 2026-05-27). Operation en doublon evitee.
  const [page, setPage] = useState(prefill?.mission_id ? 3 : 0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const TOTAL = 9
  // Banner contextuel pour restitution fourriere : visible sur toutes les pages
  // du wizard pour rappeler le contexte. Calcule la duree de garde.
  const fourriereBanner = useMemo(() => {
    if (prefill?.type !== 'fourriere') return null
    const days = prefill.days ?? null
    const entryDate = prefill.entry_date
      ? new Date(prefill.entry_date).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : null
    return (
      <div className="bg-warning-soft border border-warning/40 rounded-xl p-3 text-xs">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🚓</span>
          <span className="font-semibold text-warning">Restitution fourrière</span>
        </div>
        <div className="text-ink-secondary space-y-0.5">
          <div>
            <span className="font-medium">{prefill.plate}</span>
            {prefill.brand || prefill.model ? ` · ${[prefill.brand, prefill.model].filter(Boolean).join(' ')}` : ''}
          </div>
          {(entryDate || days != null) && (
            <div className="text-ink-faint">
              {entryDate && `Entrée le ${entryDate}`}
              {days != null && ` · ${days} jour${days > 1 ? 's' : ''} de garde`}
            </div>
          )}
        </div>
      </div>
    )
  }, [prefill])

  // Wrapper local stable : injecte les props utilisateur dans BaseShell
  // Mémoisé pour garder la même identité de composant entre rendus (sinon les
  // enfants — inputs du wizard — seraient remontés à chaque render et perdraient le focus).
  const Shell = useMemo(() => {
    return function Shell(props: {
      children: React.ReactNode; title: string; page: number; totalPages: number; onBack?: () => void
    }) {
      return <BaseShell {...props} topNotice={fourriereBanner} userRole={userRole} userName={userName} userModules={userModules} />
    }
  }, [userRole, userName, userModules, fourriereBanner])

  // Auto-redirect après sauvegarde
  //  - return_to explicite (passe en query) prime
  //  - sinon, si l encaissement etait lie a une mission : retour sur la fiche mission
  //  - sinon : dashboard (encaissement standalone)
  useEffect(() => {
    if (!saved) return
    const dest = prefill?.return_to
      || (prefill?.mission_id ? `/mission/${prefill.mission_id}` : '/dashboard')
    const t = setTimeout(() => router.push(dest), 3000)
    return () => clearTimeout(t)
  }, [saved])

  // Page 0 — pré-rempli depuis mission si prefill fourni
  // Auto-lien mission ouverte (mode standalone uniquement). Si prefill_mission_id
  // deja set, le user vient deja d une mission, pas besoin de chercher.
  const [plate, setPlate] = useState(prefill?.plate || '')
  const [odooVehicle, setOdooVehicle] = useState<OdooVehicle | null>(null)
  /** Modal de lookup véhicule (Phase 1 multi-match Odoo) */
  const [showLookup, setShowLookup] = useState(false)
  /** Auto-lien vers mission ouverte si plaque match (Olivier 2026-05-26).
   *  Affiche un bandeau "Mission #XXX trouvee" qui propose de l encaisser direct. */
  const [openMission, setOpenMission] = useState<null | {
    id: string; mission_number: number | null; source: string;
    mission_type: string | null; vehicle_brand: string | null; vehicle_model: string | null;
    amount_to_collect: number | null; status: string; client_name: string | null;
    incident_address: string | null; incident_city: string | null;
  }>(null)
  // Debounce 400ms sur changement de plaque (mode standalone uniquement).
  useEffect(() => {
    // Si on est deja arrive avec une mission prefilled, pas besoin de chercher.
    if (prefill?.mission_id) return
    if (!plate || plate.length < 4) { setOpenMission(null); return }
    const ctrl = new AbortController()
    const handler = setTimeout(async () => {
      try {
        const res = await fetch(`/api/missions/open-by-plate?plate=${encodeURIComponent(plate)}`, {
          signal: ctrl.signal,
        })
        const j = await res.json()
        if (j.found && j.mission) setOpenMission(j.mission)
        else setOpenMission(null)
      } catch (e: any) {
        if (e.name !== 'AbortError') setOpenMission(null)
      }
    }, 400)
    return () => { clearTimeout(handler); ctrl.abort() }
  }, [plate, prefill?.mission_id])

  // Page 1
  const [vehicleConfirmed, setVehicleConfirmed] = useState<boolean | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [modelOther, setModelOther] = useState('')

  // Page 2 — motif (pre-selectionne depuis prefill : type=fourriere OU label arbitraire)
  // Olivier 2026-05-27 (Fix H) : si prefill.motif_label fourni (ex: "Mal Garée",
  // "Intervention Privée"), on cherche un match insensible casse dans motifs[]
  // pour pre-selectionner. Fallback sur type=fourriere si label vide.
  const prefilledMotif = useMemo(() => {
    if (prefill?.motif_label) {
      const needle = prefill.motif_label.toLowerCase().trim()
      const match = motifs.find(m =>
        m.label.toLowerCase().includes(needle) ||
        m.value.toLowerCase().includes(needle) ||
        needle.includes(m.label.toLowerCase()) ||
        needle.includes(m.value.toLowerCase())
      )
      if (match) return match
    }
    if (prefill?.type === 'fourriere') {
      return motifs.find(m =>
        m.value.toLowerCase().includes('fourri') ||
        m.label.toLowerCase().includes('fourri')
      ) || null
    }
    return null
  }, [prefill?.motif_label, prefill?.type, motifs])
  const [motif, setMotif] = useState(prefilledMotif?.value || '')
  const [motifLabel, setMotifLabel] = useState(prefilledMotif?.label || '')
  const [motifPrecision, setMotifPrecision] = useState(prefill?.motif_precision || '')

  // Page 3
  const [location, setLocation] = useState(prefill?.location || '')
  const [locationLoading, setLocationLoading] = useState(false)

  // Page 4
  const [amount, setAmount] = useState(prefill?.amount ? String(prefill.amount) : '')
  // Solde réellement dû sur la mission (transmis par la fiche). Tant qu'il existe,
  // le montant n'est PAS librement modifiable : on propose le solde, et il faut un
  // geste explicite pour encaisser autre chose. Vu en test le 12/08 : 533,96 € dus,
  // 0,01 € tapé, mission passée « à facturer 0,01 € ». Olivier 2026-08-12.
  const dueAmount = prefill?.amount && prefill.amount > 0 ? Number(prefill.amount) : 0
  const [amountUnlocked, setAmountUnlocked] = useState(false)
  const [amountReason, setAmountReason] = useState('')
  const amountLocked = dueAmount > 0 && !amountUnlocked
  const typedAmount  = parseFloat(amount) || 0
  const restAfter    = dueAmount > 0 ? Math.round((dueAmount - typedAmount) * 100) / 100 : 0
  const [paymentMode, setPaymentMode] = useState('')

  // ── Easter egg : QR virement bancaire (plan B quand SumUp est down) ──────────
  // 3 tapotages sur le « € » de la page montant → affiche un QR EPC/SEPA vers
  // notre compte, pré-rempli avec le montant. PAIEMENT VALIDÉ UNIQUEMENT après
  // photo OBLIGATOIRE de l'écran de confirmation du client. Olivier 2026-07-13.
  const bankTaps  = useRef(0)
  const bankTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [bankQrOpen,   setBankQrOpen]   = useState(false)
  const [bankQrImg,    setBankQrImg]    = useState('')
  const [bankProofUrl, setBankProofUrl] = useState('')
  const [bankUploading, setBankUploading] = useState(false)
  const handleBankTap = async () => {
    bankTaps.current += 1
    if (bankTimer.current) clearTimeout(bankTimer.current)
    bankTimer.current = setTimeout(() => { bankTaps.current = 0 }, 1500)
    if (bankTaps.current < 3) return
    bankTaps.current = 0
    if (bankTimer.current) clearTimeout(bankTimer.current)
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { setError('Saisis d\'abord le montant.'); return }
    const bank = bankConfigFromEnv()
    if (!bank) { setError('IBAN non configuré (NEXT_PUBLIC_BANK_IBAN).'); return }
    try {
      // Communication = plaque (bien visible) + réf VD Soft. Défensif : plaque
      // reprise du state OU du prefill, en majuscules.
      const commPlate = String(plate || prefill?.plate || '').toUpperCase().trim()
      const remittance = commPlate ? `Plaque ${commPlate} - VD Soft` : 'VD Soft'
      const payload = buildEpcQrPayload({ name: bank.name, iban: bank.iban, bic: bank.bic, amount: amt, remittance })
      const img = await QRCode.toDataURL(payload, { width: 320, margin: 1 })
      try { navigator.vibrate?.(30) } catch { /* pas de haptique */ }
      setBankQrImg(img); setBankProofUrl(''); setBankQrOpen(true)
    } catch (e: any) { setError('Génération QR impossible : ' + (e?.message || '')) }
  }
  const uploadBankProof = async (files: FileList | null) => {
    const f = files?.[0]; if (!f) return
    setBankUploading(true); setError('')
    try {
      const fd = new FormData()
      fd.append('mission_id', prefill?.mission_id || openMission?.id || `enc-${plate || 'x'}`)
      fd.append('files', f, 'virement-confirmation.jpg')
      const r = await fetch('/api/missions/photos-upload', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Upload KO')
      setBankProofUrl(j.urls?.[0] || '')
    } catch (e: any) { setError('Photo non enregistrée : ' + (e?.message || '')) }
    finally { setBankUploading(false) }
  }

  // Page 4 — état SumUp
  const [sumupLoading, setSumupLoading] = useState(false)
  const [sumupData, setSumupData] = useState<any>(null)
  const [sumupMode, setSumupMode] = useState<string | null>(null)
  const [sumupPolling, setSumupPolling] = useState(false)
  const [sumupStatus, setSumupStatus] = useState<string | null>(null)
  const sumupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Page 5
  const [previousClients, setPreviousClients] = useState<OdooClient[]>([])
  const [selectedClient, setSelectedClient] = useState<OdooClient | null>(null)
  const [isNewClient, setIsNewClient] = useState(false)

  // Pages 6-8
  const [clientVat, setClientVat] = useState('')
  const [viesLoading, setViesLoading] = useState(false)
  const [viesResult, setViesResult] = useState<any>(null)
  const [clientName, setClientName] = useState('')
  const [odooNameMatches, setOdooNameMatches] = useState<any[]>([])
  const [nameSearchLoading, setNameSearchLoading] = useState(false)
  const [clientAddress, setClientAddress] = useState('')
  const [clientStreet, setClientStreet] = useState('')
  const [clientZip, setClientZip] = useState('')
  const [clientCity, setClientCity] = useState('')
  const [clientCountryCode, setClientCountryCode] = useState('BE')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [notes, setNotes] = useState('')

  // Auto-prefill complet depuis la mission : si mission_id est fourni, on
  // fetch /api/missions/[id] au mount pour recuperer brand, model, client,
  // phone, lieu d intervention, etc. et pre-remplir le formulaire. Si le
  // montant n est pas deja pre-saisi (forfait dispatch), on fetch aussi
  // /price-estimate pour pre-remplir avec le total TVAC calcule.
  // Olivier 2026-05-25 : "le chauffeur ne va pas faire deux fois le travail".
  useEffect(() => {
    if (!prefill?.mission_id) return
    let cancelled = false
    const missionId = prefill.mission_id
    Promise.all([
      fetch(`/api/missions/${missionId}`).then(r => r.json()).catch(() => null),
      prefill.amount ? Promise.resolve(null) : fetch(`/api/missions/${missionId}/price-estimate`).then(r => r.json()).catch(() => null),
    ]).then(([m, est]) => {
      if (cancelled) return
      // Mission : plate / brand / model / client / phone / email / lieu
      if (m && !m.error) {
        if (m.vehicle_plate)     setPlate(prev => prev || m.vehicle_plate)
        if (m.vehicle_brand)     setSelectedBrand(prev => prev || m.vehicle_brand)
        if (m.vehicle_model)     setSelectedModel(prev => prev || m.vehicle_model)
        const cname = m.client_name || m.billed_to_name || ''
        if (cname)               setClientName(prev => prev || cname)
        if (m.client_phone)      setClientPhone(prev => prev || m.client_phone)
        if (m.client_email)      setClientEmail(prev => prev || m.client_email)
        // Lieu d intervention : pre-remplit le champ location avec
        // l adresse de l incident concatenee (rue + ville).
        const loc = [m.incident_address, m.incident_city].filter(Boolean).join(', ')
        if (loc)                 setLocation(prev => prev || loc)
      }
      // Estimate : pre-remplit le montant TVAC si pas deja set.
      // Olivier 2026-05-27 (Fix C) : utiliser total_tvac_exact si fourni
      // (forfait TVAC saisi a la creation) pour eviter derive d arrondi.
      if (est?.ok) {
        const tvac = typeof est.total_tvac_exact === 'number' && est.total_tvac_exact > 0
          ? est.total_tvac_exact
          : (typeof est.total_eur === 'number' && est.total_eur > 0
              ? Math.round(est.total_eur * 1.21 * 100) / 100
              : null)
        if (tvac != null) setAmount(prev => prev || String(tvac))
      }
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.mission_id])

  const locationInputRef = useRef<HTMLInputElement>(null)
  const clientAddressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const autocompleteClientRef = useRef<any>(null)

  const PLACES_OPTIONS = {
    types: ['address'] as string[],
    componentRestrictions: { country: ['be', 'fr', 'de', 'nl', 'lu'] }
  }

  const initAC = (
    inputRef: React.RefObject<HTMLInputElement>,
    acRef: React.MutableRefObject<any>,
    setter: (v: string) => void,
    componentSetter?: (place: any) => void
  ) => {
    if (!inputRef.current || !window.google?.maps?.places || acRef.current) return
    acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, PLACES_OPTIONS)
    acRef.current.addListener('place_changed', () => {
      const place = acRef.current.getPlace()
      if (place?.formatted_address) setter(place.formatted_address)
      if (componentSetter && place) componentSetter(place)
    })
  }

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) return
    window.initGooglePlaces = () => initAC(locationInputRef, autocompleteRef, setLocation)
    if (!document.getElementById('google-maps-script')) {
      const s = document.createElement('script')
      s.id = 'google-maps-script'
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&region=BE&callback=initGooglePlaces`
      s.async = true; document.head.appendChild(s)
    } else if (window.google?.maps?.places) {
      initAC(locationInputRef, autocompleteRef, setLocation)
    }
  }, [])

  // Init autocomplete lieu quand on arrive page 3
  // Olivier 2026-06-04 : polling au lieu de timeout fixe
  useEffect(() => {
    if (page !== 3) return
    autocompleteRef.current = null
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null
    const tryInit = () => {
      if (cancelled) return false
      if (!locationInputRef.current) return false
      if (!window.google?.maps?.places) return false
      if (autocompleteRef.current) return true
      initAC(locationInputRef, autocompleteRef, setLocation)
      return !!autocompleteRef.current
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
  }, [page])

  // Init autocomplete adresse client page 8
  // Olivier 2026-06-04 : polling au lieu de timeout fixe car le script
  // Google Maps charge en async et peut ne pas etre pret a 150ms si l user
  // arrive directement page 8 sans passer par page 3 (lieu intervention).
  useEffect(() => {
    if (page !== 8) return
    autocompleteClientRef.current = null // forcer la reinitialisation
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const setupComponents = (place: any) => {
      const c = place.address_components || []
      const get = (t: string) => c.find((x: any) => x.types.includes(t))?.long_name || ''
      const getS = (t: string) => c.find((x: any) => x.types.includes(t))?.short_name || ''
      const num = get('street_number'); const box = get('subpremise')
      const route = get('route')
      setClientStreet([route, num + (box ? `/${box}` : '')].filter(Boolean).join(' ').trim())
      setClientZip(get('postal_code'))
      setClientCity(get('locality') || get('postal_town'))
      setClientCountryCode(getS('country') || 'BE')
    }

    const tryInit = () => {
      if (cancelled) return false
      if (!clientAddressInputRef.current) return false
      if (!window.google?.maps?.places) return false
      if (autocompleteClientRef.current) return true  // deja init
      initAC(clientAddressInputRef, autocompleteClientRef, setClientAddress, setupComponents)
      return !!autocompleteClientRef.current
    }

    // Tentative immediate
    if (!tryInit()) {
      // Sinon retry toutes les 200ms (max 10s)
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
  }, [page])

  useEffect(() => {
    fetch('/api/vehicles?type=brands').then(r => r.json()).then(setBrands)
  }, [])

  useEffect(() => {
    if (!selectedBrandId) { setModels([]); return }
    fetch(`/api/vehicles?type=models&brandId=${selectedBrandId}`).then(r => r.json()).then(setModels)
  }, [selectedBrandId])

  /**
   * Ouvre la modal de lookup véhicule. La modal gère elle-même le fetch
   * /api/vehicles/lookup-by-plate (multi-match supporté Phase 1) et appelle
   * onSelect / onCreateNew selon le résultat.
   */
  const checkPlate = async () => {
    if (plate.length < 3) { setError('Immatriculation trop courte'); return }
    setError('')
    // Nouveau déroulé (Olivier 2026-07-13) : on N'AUTORISE le paiement QUE si une
    // fiche est trouvée pour la plaque. Le flow standalone (encaissement sans
    // dossier) est supprimé → source de paiements orphelins / mauvais client.
    if (openMission) return  // fiche déjà trouvée → l'utilisateur clique le bandeau vert
    try {
      const r = await fetch(`/api/missions/open-by-plate?plate=${encodeURIComponent(plate)}`)
      const j = await r.json()
      if (j.found && j.mission) { setOpenMission(j.mission); return }
    } catch (e) {
      setError('Erreur de recherche, réessaie.')
      return
    }
    // Aucune fiche liée → modal : scanner le QR du véhicule si présent, sinon
    // créer la mission (procédure complète). Olivier 2026-07-13.
    setNoMissionModal(true)
  }

  // Modal "aucune mission" + scan QR + création.
  const [noMissionModal, setNoMissionModal] = useState(false)
  const [showQrScanner,  setShowQrScanner]  = useState(false)
  const [qrError,        setQrError]        = useState('')
  // Portail vers <body> : sinon un ancêtre avec transform (AmbientBackground)
  // confine le position:fixed du modal. Olivier 2026-07-13.
  const [portalReady, setPortalReady] = useState(false)
  useEffect(() => { setPortalReady(true) }, [])

  // Easter egg : 3 tapotages sur le titre du modal « Aucune mission trouvée »
  // → bypass vers un encaissement STANDALONE (sans dossier). Geste discret, réservé
  // aux cas exceptionnels. Olivier 2026-07-13.
  const bypassTaps  = useRef(0)
  const bypassTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleBypassTap = () => {
    bypassTaps.current += 1
    if (bypassTimer.current) clearTimeout(bypassTimer.current)
    bypassTimer.current = setTimeout(() => { bypassTaps.current = 0 }, 1500)
    if (bypassTaps.current >= 3) {
      bypassTaps.current = 0
      if (bypassTimer.current) clearTimeout(bypassTimer.current)
      try { navigator.vibrate?.(30) } catch { /* pas de haptique */ }
      setNoMissionModal(false)
      setShowLookup(true)   // ouvre le flow standalone (lookup véhicule → pages de saisie)
    }
  }
  const onQrScan = (qrText: string) => {
    const tx = (qrText || '').trim()
    // Le QR étiquette véhicule pointe vers /qr/mission/[numéro] (hub VD Soft qui
    // propose l'encaissement). On y navigue → réutilise toute la résolution.
    if (/^https?:\/\//i.test(tx)) { window.location.href = tx; return }
    const m = tx.match(/\/qr\/mission\/([^/?#]+)/i)
    if (m) { window.location.href = `/qr/mission/${m[1]}`; return }
    if (/^[\w-]+$/.test(tx)) { window.location.href = `/qr/mission/${tx}`; return }
    setQrError('QR non reconnu')
  }

  /** Callback : un véhicule a été choisi (skip auto si 1 seul résultat exact). */
  const handleVehicleSelect = (v: VehicleMatch) => {
    setOdooVehicle({
      id:          v.id,
      licensePlate: v.plate,
      brandName:   v.brand,
      modelName:   v.model,
      displayName: [v.brand, v.model].filter(Boolean).join('/') || v.plate,
      vinSn:       v.vin || '',
    })
    setPreviousClients(v.previousClients || [])
    setSelectedBrand(v.brand)
    setSelectedModel(v.model)
    setShowLookup(false)
    setPage(1)
  }

  /** Callback : aucun véhicule existant ne correspond → saisie manuelle. */
  const handleCreateNewVehicle = () => {
    setShowLookup(false)
    setOdooVehicle(null)
    setPage(10)
  }

  const checkVies = async (): Promise<any> => {
    if (!clientVat || clientVat.length < 5) return null
    setViesLoading(true); setViesResult(null)
    try {
      const res = await fetch(`/api/vies?vat=${encodeURIComponent(clientVat)}`)
      const data = await res.json()

      if (data.valid) {
        if (data.name) setClientName(data.name)
        if (data.address) {
          const lines = data.address.split('\n').map((l: string) => l.trim()).filter(Boolean)
          if (lines.length >= 2) {
            const street = lines[0].charAt(0) + lines[0].slice(1).toLowerCase()
            const zipCity = lines[1].match(/^(\d{4,5})\s+(.+)$/)
            if (zipCity) {
              setClientStreet(street)
              setClientZip(zipCity[1])
              setClientCity(zipCity[2].charAt(0) + zipCity[2].slice(1).toLowerCase())
              setClientAddress(`${street}, ${zipCity[1]} ${zipCity[2].charAt(0) + zipCity[2].slice(1).toLowerCase()}`)
            } else {
              setClientAddress(lines.join(', '))
            }
          } else {
            setClientAddress(data.address)
          }
        }

        // Chercher dans Odoo par TVA
        const odooRes = await fetch(`/api/partners?vat=${encodeURIComponent(clientVat)}`)
        const odooData = await odooRes.json()
        if (odooData.found) {
          const p = odooData.partner
          setClientName(p.name); setClientPhone(p.phone); setClientEmail(p.email)
          setClientStreet(p.street); setClientZip(p.zip); setClientCity(p.city)
          setClientCountryCode(p.countryCode); setClientAddress(p.address); setClientVat(p.vat)
          const result = { ...data, odooFound: true, odooName: p.name, hasPhone: !!p.phone }
          setViesResult(result)
          return result
        }
      }

      setViesResult(data)
      return data
    } finally { setViesLoading(false) }
  }

  const getMyLocation = () => {
    if (!navigator.geolocation) return
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
          { headers: { 'Accept-Language': 'fr' } }
        )
        const data = await res.json()
        setLocation(data.display_name || `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
      } catch {
        setLocation(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
      }
      finally { setLocationLoading(false) }
    }, () => setLocationLoading(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  const handleSubmit = async () => {
    setSaving(true); setError('')
    const client = selectedClient || {
      name: clientName, phone: clientPhone, email: clientEmail,
      address: clientAddress, street: clientStreet, zip: clientZip,
      city: clientCity, countryCode: clientCountryCode, vat: clientVat
    }
    try {
      const res = await fetch('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_type: 'encaissement', plate,
          // mission_id : lien vers la mission qui a declenche l'encaissement.
          // Olivier 2026-07-13 : en mode standalone (saisie plaque), on lie AUSSI
          // à la mission trouvée par plaque (openMission) — sinon le paiement était
          // ORPHELIN : payment_amount jamais posé sur la fiche + client non mis à
          // jour (la fiche restait sur le client d'origine « Siabis »).
          mission_id: prefill?.mission_id || openMission?.id || null,
          // brand_id / model_id sur interventions sont legacy (FK vers tables
          // Supabase vehicle_brands/vehicle_models deprecated, alimentées par Odoo
          // via /api/vehicles → IDs Odoo absents côté Supabase = FK violation).
          // brand_text / model_text suffisent pour la sync Odoo et l'email récépissé.
          // TODO: Sub-phase post-incident — DROP FK + colonnes mortes (Stratégie A).
          brand_id: null,
          model_id: null,
          brand_text: selectedBrand,
          model_text: selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel,
          motif_id: motif, motif_text: motifLabel,
          motif_precision: motifPrecision || null,
          // « Non payé — à facturer » : c'est le SOLDE qui part en facture. Un
          // montant partiel n'a aucun sens ici — on ne facture pas 0,01 € parce
          // qu'il a été tapé dans la case. Olivier 2026-08-12.
          location_address: location,
          amount: (paymentMode === 'unpaid' && dueAmount > 0) ? String(dueAmount) : amount,
          payment_mode: paymentMode || (sumupStatus === 'PAID' ? 'sumup' : 'unpaid'),
          payment_reference: sumupData?.sumupReference || undefined,
          // Preuve du virement (photo de la confirmation client) → référence + notes.
          payment_proof_url: paymentMode === 'virement_qr' ? (bankProofUrl || undefined) : undefined,
          // Olivier 2026-05-26 : si client Odoo selectionne, on le remonte pour
          // que l API auto-lie billed_to_id sur la mission (uniquement si la
          // mission n a pas encore de client liee).
          client_id: selectedClient?.id || null,
          client_vat: client.vat, client_name: client.name,
          client_address: client.address, client_street: client.street,
          client_zip: client.zip, client_city: client.city,
          client_country_code: client.countryCode,
          client_phone: client.phone, client_email: client.email,
          notes: [notes, amountReason.trim() && dueAmount > 0 && typedAmount < dueAmount
            ? `Montant partiel (solde dû ${formatEur(dueAmount)}) — ${amountReason.trim()}`
            : ''].filter(Boolean).join(' · ') || notes,
        })
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Erreur'); return }
      setSaved(true)
    } finally { setSaving(false) }
  }

  const resetForm = () => {
    setPage(0); setSaved(false); setError('')
    setPlate(''); setOdooVehicle(null); setVehicleConfirmed(null)
    setPreviousClients([]); setSelectedClient(null); setIsNewClient(false)
    setSelectedBrand(''); setSelectedBrandId(null)
    setSelectedModel(''); setSelectedModelId(null); setModelOther('')
    setMotif(''); setMotifLabel(''); setMotifPrecision(''); setLocation('')
    setAmount(''); setPaymentMode('')
    setClientVat(''); setClientName(''); setClientAddress('')
    setClientStreet(''); setClientZip(''); setClientCity(''); setClientCountryCode('BE')
    setClientPhone(''); setClientEmail(''); setNotes(''); setViesResult(null)
    setOdooNameMatches([])
    autocompleteRef.current = null; autocompleteClientRef.current = null
  }

  if (saved) {
    // Flow mission : retour automatique sur la fiche, pas de bouton "Nouvelle
    // intervention" ni de lien "Dashboard" (clic accidentel = casse le flow).
    if (prefill?.mission_id || prefill?.return_to) {
      const back = prefill.return_to || `/mission/${prefill.mission_id}`
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
          <div className="text-6xl mb-6" aria-hidden="true">✅</div>
          <h2 className="font-display text-ink text-2xl font-bold mb-2">Enregistré !</h2>
          <p className="text-ink-muted text-sm mb-2">Paiement lié à la mission.</p>
          <p className="text-ink-faint text-xs mb-8">Retour à la mission dans 3 secondes…</p>
          <Link href={back}
            className="w-full max-w-sm bg-brand text-white font-bold rounded-xl py-3.5 shadow-brand hover:bg-brand-hover hover:shadow-brand-hover transition-all">
            ← Retour à la mission
          </Link>
        </div>
      )
    }
    // Flow standalone (passage caisse) : comportement inchange
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl mb-6" aria-hidden="true">✅</div>
        <h2 className="font-display text-ink text-2xl font-bold mb-2">Enregistré !</h2>
        <p className="text-ink-muted text-sm mb-2">Intervention sauvegardée avec succès.</p>
        <p className="text-ink-faint text-xs mb-8">Retour au dashboard dans 3 secondes…</p>
        <button onClick={resetForm}
          className="w-full max-w-sm bg-brand text-white font-bold rounded-xl py-3.5 mb-3 shadow-brand hover:bg-brand-hover hover:shadow-brand-hover transition-all">
          + Nouvelle intervention
        </button>
        <Link href="/dashboard" className="text-ink-muted hover:text-ink text-sm transition-colors">← Dashboard</Link>
      </div>
    )
  }

  // ── Page 0 — Immatriculation ──────────────────────────────
  if (page === 0) return (
    <Shell title={t('encaissement.step_plate')} page={0} totalPages={TOTAL}>
      <div className="mt-4">
        <input
          value={plate}
          onChange={e => setPlate(normalizePlate(e.target.value))}
          onKeyDown={e => e.key === 'Enter' && checkPlate()}
          placeholder="1ABC123"
          autoComplete="off"
          autoFocus
          className={`${inputXLCls} mb-2`}
        />
        <p className="text-ink-muted text-xs text-center mb-4">Sans tirets ni espaces</p>

        {/* Bandeau "Mission ouverte trouvee" — Olivier 2026-05-26 (Chantier 4).
            Si la plaque match une mission ouverte (parked/in_progress/...), on
            propose un saut direct vers le mode encaissement mission-prefilled
            avec le montant deja calcule. */}
        {openMission && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 mb-4">
            <p className="text-emerald-900 text-sm font-semibold mb-1">
              💡 Mission ouverte trouvée pour cette plaque
            </p>
            <p className="text-emerald-800 text-xs leading-relaxed mb-3">
              <span className="font-mono">{openMission.mission_number != null ? `#${openMission.mission_number}` : openMission.id.slice(0, 8)}</span>
              {' · '}{openMission.source}
              {openMission.mission_type ? ` · ${openMission.mission_type}` : ''}
              {' · '}<span className="capitalize">{openMission.status}</span>
              {openMission.amount_to_collect != null && (
                <span className="block mt-0.5">
                  Montant attendu : <strong>{openMission.amount_to_collect.toFixed(2)} €</strong>
                </span>
              )}
              {(openMission.vehicle_brand || openMission.vehicle_model) && (
                <span className="block mt-0.5">
                  {[openMission.vehicle_brand, openMission.vehicle_model].filter(Boolean).join(' ')}
                </span>
              )}
              {openMission.client_name && (
                <span className="block mt-0.5">{openMission.client_name}</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                const url = buildEncaissementUrl({
                  id:               openMission.id,
                  source:           openMission.source,
                  vehicle_plate:    plate,
                  vehicle_brand:    openMission.vehicle_brand,
                  vehicle_model:    openMission.vehicle_model,
                  incident_address: openMission.incident_address,
                  incident_city:    openMission.incident_city,
                }, {
                  amount:   openMission.amount_to_collect,
                  returnTo: `/mission/${openMission.id}`,
                })
                window.location.href = url
              }}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition"
            >
              💳 Encaisser cette mission →
            </button>
          </div>
        )}

        {!openMission && (
          <BigBtn
            label="Rechercher →"
            onClick={checkPlate}
            disabled={plate.length < 3}
          />
        )}
        {error && <p className="text-critical text-sm text-center mt-3">{error}</p>}
      </div>
      <VehiclePlateLookup
        plate={plate}
        open={showLookup}
        withPreviousClients
        onSelect={handleVehicleSelect}
        onCreateNew={handleCreateNewVehicle}
        onCancel={() => setShowLookup(false)}
      />

      {/* Modal "aucune mission trouvée" : scanner le QR du véhicule si présent,
          sinon créer la mission (procédure complète). Rendu via portail sur <body>
          pour un vrai plein écran (ancêtre transformé). Olivier 2026-07-13. */}
      {portalReady && noMissionModal && createPortal(
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setNoMissionModal(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4 shadow-2xl">
            <div>
              <h3 className="text-ink font-bold text-lg select-none" onClick={handleBypassTap}>Aucune mission trouvée</h3>
              <p className="text-ink-muted text-sm mt-1">
                Aucune mission ouverte pour la plaque <span className="font-mono font-semibold">{plate}</span>.
                Scanne le QR code s'il est présent sur le véhicule, sinon crée la mission.
              </p>
            </div>

            <button
              type="button"
              onClick={() => { setQrError(''); setNoMissionModal(false); setShowQrScanner(true) }}
              className="w-full py-3.5 bg-brand hover:bg-brand-hover text-white rounded-2xl text-sm font-bold transition flex items-center justify-center gap-2">
              📷 Scanner le QR du véhicule
            </button>

            <button
              type="button"
              onClick={() => { window.location.href = `/mission/police?plate=${encodeURIComponent(plate)}` }}
              className="w-full py-3.5 bg-surface-2 hover:bg-surface-hover border text-ink rounded-2xl text-sm font-bold transition flex items-center justify-center gap-2">
              ➕ Créer la mission
            </button>

            {qrError && <p className="text-critical text-sm text-center">{qrError}</p>}

            <button
              type="button"
              onClick={() => setNoMissionModal(false)}
              className="w-full py-2 text-ink-muted hover:text-ink text-sm transition">
              Annuler
            </button>
          </div>
        </div>,
        document.body,
      )}

      {portalReady && showQrScanner && createPortal(
        <QRScanner title="Scan QR — Véhicule" onScan={onQrScan} onClose={() => setShowQrScanner(false)} />,
        document.body,
      )}
    </Shell>
  )

  // ── Page 1 — Confirmation véhicule ───────────────────────
  if (page === 1 && odooVehicle) return (
    <Shell title={t('encaissement.step_identify_vehicle')} page={1} totalPages={TOTAL} onBack={() => setPage(0)}>
      <div className="mt-4">
        <div className="bg-surface border rounded-card shadow-card p-6 text-center mb-8">
          <p className="text-ink-muted text-xs uppercase tracking-wider mb-3">Le véhicule est-il un :</p>
          <p className="font-display text-ink text-3xl font-bold">{odooVehicle.brandName}</p>
          <p className="text-ink-secondary text-2xl mt-1">{odooVehicle.modelName}</p>
          <p className="text-ink-muted text-xs uppercase tracking-widest mt-3 font-mono">{plate}</p>
        </div>
        <div className="flex flex-col gap-3">
          <BigBtn label="✓ Oui" onClick={() => { setVehicleConfirmed(true); setPage(2) }} />
          <BigBtn label="✗ Non, autre véhicule" secondary onClick={() => {
            setVehicleConfirmed(false)
            setSelectedBrand(''); setSelectedBrandId(null)
            setSelectedModel(''); setSelectedModelId(null)
            setPage(10)
          }} />
        </div>
      </div>
    </Shell>
  )

  // ── Page 10 — Saisie marque ───────────────────────────────
  if (page === 10) return (
    <Shell title={t('encaissement.step_brand')} page={2} totalPages={TOTAL} onBack={() => odooVehicle ? setPage(1) : setPage(0)}>
      <div className="mt-2 flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
        {brands.map(b => (
          <ChoiceBtn key={b.id} label={b.name} selected={selectedBrandId === b.id}
            onClick={() => { setSelectedBrand(b.name); setSelectedBrandId(b.id); setPage(11) }} />
        ))}
      </div>
    </Shell>
  )

  // ── Page 11 — Saisie modèle ───────────────────────────────
  if (page === 11) return (
    <Shell title={`${t('encaissement.step_brand')} ${selectedBrand} ?`} page={2} totalPages={TOTAL} onBack={() => setPage(10)}>
      <div className="mt-2 flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
        {models.map(m => (
          <ChoiceBtn key={m.id} label={m.name} selected={selectedModelId === m.id}
            onClick={() => {
              setSelectedModel(m.name); setSelectedModelId(m.id)
              setPage(m.name === 'Autre' ? 12 : 2)
            }} />
        ))}
      </div>
    </Shell>
  )

  // ── Page 12 — Modèle Autre ────────────────────────────────
  if (page === 12) return (
    <Shell title={t('encaissement.step_model_other')} page={2} totalPages={TOTAL} onBack={() => setPage(11)}>
      <div className="mt-4">
        <input
          value={modelOther}
          onChange={e => setModelOther(e.target.value)}
          placeholder="Ex: 308 SW, Clio V…"
          autoFocus
          className={`${inputCls} text-base text-center font-semibold mb-2`}
        />
        <p className="text-ink-muted text-xs text-center mb-8">Optionnel — laisse vide si inconnu</p>
        <BigBtn label="Continuer →" onClick={() => setPage(2)} />
      </div>
    </Shell>
  )

  // ── Page 2 — Motif ────────────────────────────────────────
  if (page === 2) return (
    <Shell title={t('encaissement.step_motif')} page={3} totalPages={TOTAL} onBack={() => {
      if (!odooVehicle || vehicleConfirmed === false) setPage(11)
      else setPage(1)
    }}>
      <div className="mt-2 flex flex-col gap-3">
        {motifs.map(m => (
          <ChoiceBtn key={m.value} label={m.label} selected={motif === m.value}
            onClick={() => {
              setMotif(m.value); setMotifLabel(m.label)
              setPage(m.value === 'autre' ? 13 : 3)
            }} />
        ))}
      </div>
    </Shell>
  )

  // ── Page 13 — Motif Autre ─────────────────────────────────
  if (page === 13) return (
    <Shell title={t('encaissement.step_motif_other')} page={3} totalPages={TOTAL} onBack={() => setPage(2)}>
      <div className="mt-4">
        <input
          value={motifPrecision}
          onChange={e => setMotifPrecision(e.target.value)}
          placeholder="Décris l'intervention…"
          autoFocus
          className={`${inputCls} text-base mb-2`}
        />
        <p className="text-ink-muted text-xs text-center mb-8">Apparaîtra sur le devis</p>
        <BigBtn label="Continuer →" onClick={() => setPage(3)} disabled={!motifPrecision.trim()} />
      </div>
    </Shell>
  )

  // ── Page 3 — Lieu ─────────────────────────────────────────
  if (page === 3) return (
    <Shell title={t('encaissement.step_location')} page={4} totalPages={TOTAL} onBack={() => setPage(motif === 'autre' ? 13 : 2)}>
      <div className="mt-4">
        <div className="relative mb-2">
          <input
            ref={locationInputRef}
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="Adresse du lieu…"
            className={`${inputCls} text-base pr-14`}
          />
          <button onClick={getMyLocation} disabled={locationLoading}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-surface-hover hover:bg-surface-2 rounded-md px-3 py-2 text-sm transition-colors disabled:opacity-40">
            {locationLoading ? '⏳' : '🎯'}
          </button>
        </div>
        <p className="text-ink-muted text-xs mb-8">Tape une adresse ou utilise ta position GPS</p>
        <BigBtn label="Continuer →" onClick={() => setPage(5)} disabled={!location.trim()} />
      </div>
    </Shell>
  )

  // Lancer un paiement SumUp
  const startSumup = async (mode: string) => {
    if (!amount || parseFloat(amount) <= 0) { setError('Montant requis'); return }
    setSumupLoading(true); setSumupMode(mode); setError('')
    const reference = `VD${Date.now().toString(36).toUpperCase()}`
    try {
      const res = await fetch('/api/sumup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(amount),
          reference,
          description: `Intervention véhicule ${plate}`,
          mode,
          clientEmail: mode === 'email' ? clientEmail : undefined,
          clientName,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSumupData(data)

      if (mode === 'terminal') {
        window.location.href = data.terminalDeepLink
      } else if (mode === 'tap') {
        // Tap to Pay nécessite l'app SumUp — deep link vers l'app
        window.location.href = data.tapToPayDeepLink || data.terminalDeepLink
      }

      // Polling statut. NB : ne fonctionne QUE pour les modes où le CLIENT paye
      // le checkout en ligne (qr / email). Pour terminal / tap-to-pay, le
      // paiement part dans l'app SumUp (deep link affiliate-key) = une
      // transaction SÉPARÉE qui ne touche jamais ce checkout → le statut reste
      // PENDING. D'où la validation manuelle proposée pour ces modes.
      if (sumupIntervalRef.current) clearInterval(sumupIntervalRef.current)
      setSumupPolling(true)
      // Terminal / tap-to-pay : réconciliation par notre référence (transaction
      // faite dans l'app SumUp). QR / email : statut du checkout en ligne.
      const pollUrl = (mode === 'terminal' || mode === 'tap')
        ? `/api/sumup?ref=${encodeURIComponent(reference)}`
        : `/api/sumup?checkoutId=${data.checkoutId}`
      const interval = setInterval(async () => {
        const s = await fetch(pollUrl)
        const status = await s.json()
        if (status.status === 'PAID') {
          setSumupStatus('PAID')
          setPaymentMode('sumup')
          clearInterval(interval); sumupIntervalRef.current = null
          setSumupPolling(false)
          setTimeout(() => setPage(9), 1500)
        } else if (status.status === 'FAILED' || status.status === 'EXPIRED') {
          setSumupStatus(status.status)
          clearInterval(interval); sumupIntervalRef.current = null
          setSumupPolling(false)
        }
      }, 3000)
      sumupIntervalRef.current = interval
      setTimeout(() => { clearInterval(interval); if (sumupIntervalRef.current === interval) sumupIntervalRef.current = null; setSumupPolling(false) }, 5 * 60 * 1000)

    } catch (err: any) {
      setError(err.message)
      setSumupMode(null)
    } finally {
      setSumupLoading(false)
    }
  }

  // ── Page 4 — Montant & paiement ──────────────────────────
  if (page === 4) return (
    <Shell title={t('encaissement.step_amount')} page={5} totalPages={TOTAL} onBack={() => isNewClient ? setPage(8) : setPage(5)}>
      <div className="mt-4">
        <div className="relative mb-6">
          <input
            type="text"
            id="amount-field"
            value={amount}
            readOnly={amountLocked}
            onChange={e => { setAmount(e.target.value.replace(',', '.').replace(/[^0-9.]/g, '')); setSumupData(null); setSumupStatus(null) }}
            placeholder="0.00"
            autoFocus={!amountLocked}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="decimal"
            data-lpignore="true"
            data-form-type="other"
            className={inputMontantCls}
          />
          <span onClick={handleBankTap} className="absolute right-5 top-1/2 -translate-y-1/2 text-ink-muted text-xl select-none cursor-default">€</span>
        </div>

        {/* Solde dû : affiché en clair, et proposé par défaut. Le paiement en
            plusieurs fois reste possible (200 € cash + solde par carte), mais il
            se déclare — il ne s'obtient pas en écrasant le champ. */}
        {dueAmount > 0 && (
          <div className="mb-6 -mt-3 space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <span className="text-ink-muted text-sm">Solde à encaisser</span>
              <span className="text-ink font-bold tabular-nums">{formatEur(dueAmount)}</span>
            </div>
            {amountLocked ? (
              <button type="button"
                onClick={() => setAmountUnlocked(true)}
                className="w-full py-2.5 rounded-xl border border text-ink-secondary text-sm font-medium">
                Encaisser un autre montant (acompte, dérogation)
              </button>
            ) : (
              <>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setAmount(String(dueAmount)); setAmountUnlocked(false); setAmountReason('') }}
                    className="flex-1 py-2.5 rounded-xl border border text-ink-secondary text-sm font-medium">
                    ↩︎ Revenir au solde
                  </button>
                </div>
                {typedAmount > 0 && restAfter > 0 && (
                  <div className="bg-warning-soft border border-warning rounded-xl px-4 py-3 text-warning text-sm">
                    Il restera <b>{formatEur(restAfter)}</b> à encaisser après ce paiement.
                    <span className="block opacity-80">Le client peut payer le reste par un autre moyen — refais un encaissement.</span>
                  </div>
                )}
                {typedAmount > 0 && restAfter > 0 && (
                  <input
                    value={amountReason}
                    onChange={e => setAmountReason(e.target.value)}
                    placeholder="Pourquoi ce montant ? (acompte, accord bureau…)"
                    className={inputCls}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Statut SumUp */}
        {sumupStatus === 'PAID' && (
          <div className="bg-success-soft border border-success rounded-xl px-4 py-3 text-success text-sm text-center mb-4">
            ✅ Paiement SumUp confirmé !
          </div>
        )}
        {sumupStatus === 'FAILED' && (
          <div className="bg-critical-soft border border-critical rounded-xl px-4 py-3 text-critical text-sm text-center mb-4">
            ❌ Paiement refusé — réessaie
          </div>
        )}
        {sumupPolling && !sumupStatus && sumupMode !== 'terminal' && sumupMode !== 'tap' && (
          <div className="bg-warning-soft border border-warning rounded-xl px-4 py-3 text-warning text-sm text-center mb-4">
            ⏳ En attente du paiement…
          </div>
        )}

        {/* Terminal / Tap to Pay : paiement dans l'app SumUp, réconcilié
            AUTOMATIQUEMENT via l'API Transactions (foreign-tx-id = notre réf).
            La bascule vers l'écran suivant se fait dès que SumUp confirme.
            Validation manuelle en secours (réseau lent / cas limite). */}
        {(sumupMode === 'terminal' || sumupMode === 'tap') && sumupData && !sumupStatus && (
          <div className="flex flex-col gap-3 mb-4">
            <div className="bg-info-soft border border-info rounded-xl px-4 py-3 text-info text-sm text-center">
              📲 Paiement dans l'app SumUp… <span className="opacity-80">confirmation automatique dès validation.</span>
            </div>
            <details className="text-center">
              <summary className="text-ink-muted text-xs cursor-pointer select-none">La confirmation n'arrive pas ?</summary>
              <button
                type="button"
                onClick={() => {
                  if (sumupIntervalRef.current) { clearInterval(sumupIntervalRef.current); sumupIntervalRef.current = null }
                  setSumupPolling(false)
                  setSumupStatus('PAID')
                  setPaymentMode('sumup')
                  setTimeout(() => setPage(9), 600)
                }}
                className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl py-3 active:scale-95 transition"
              >
                ✅ Paiement reçu — Valider manuellement
              </button>
            </details>
            <button
              type="button"
              onClick={() => {
                if (sumupIntervalRef.current) { clearInterval(sumupIntervalRef.current); sumupIntervalRef.current = null }
                setSumupPolling(false); setSumupData(null); setSumupMode(null)
              }}
              className="w-full text-ink-muted text-sm py-1"
            >
              ✕ Annuler / choisir un autre moyen
            </button>
          </div>
        )}

        {/* QR Code SumUp */}
        {sumupData?.qrUrl && sumupMode === 'qr' && !sumupStatus && (
          <div className="bg-white rounded-2xl p-4 mb-4 text-center">
            <p className="text-ink-muted text-xs mb-2">Montrez ce QR au client — il paye sur son téléphone</p>
            <img
              src={sumupData.qrUrl}
              alt="QR Code SumUp"
              className="mx-auto w-52 h-52 pointer-events-none"
              draggable={false}
            />
            <p className="text-ink-secondary text-xs mt-2">Carte, Apple Pay, Google Pay acceptés</p>
          </div>
        )}

        {/* Email envoyé */}
        {sumupData && sumupMode === 'email' && !sumupStatus && (
          <div className="bg-info-soft border border-info rounded-xl px-4 py-3 text-info text-sm text-center mb-4">
            📧 Lien de paiement envoyé à {clientEmail}
          </div>
        )}

        {/* 6 boutons de paiement */}
        {!sumupStatus && (
          <div className="flex flex-col gap-2 mb-6">
            {[
              { mode: 'cash',          icon: '💵', label: 'Espèces',              sumup: false },
              { mode: 'terminal',      icon: '💳', label: 'SumUp Terminal',        sumup: true  },
              { mode: 'qr',            icon: '📱', label: 'QR Code',               sumup: true  },
              { mode: 'tap',           icon: '📲', label: 'Tap to Pay',            sumup: true  },
              { mode: 'email',         icon: '✉️',  label: 'Lien Email',            sumup: true, disabled: !clientEmail },
              { mode: 'sumup_manual',  icon: '🔵', label: 'SumUp Manuel',          sumup: false },
              { mode: 'bancontact',    icon: '🏦', label: 'Bancontact Bureau',     sumup: false },
              { mode: 'unpaid',        icon: '📋', label: 'Non payé — À facturer', sumup: false },
            ].map(btn => (
              <button
                key={btn.mode}
                type="button"
                onClick={() => {
                  if (btn.disabled) return
                  // Réinitialiser SumUp si on change de mode
                  setSumupData(null)
                  setSumupStatus(null)
                  setSumupMode(null)
                  setSumupPolling(false)
                  if (btn.sumup) {
                    startSumup(btn.mode)
                  } else {
                    setPaymentMode(btn.mode)
                  }
                }}
                disabled={!!btn.disabled}
                className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl border text-left font-medium transition-all active:scale-95 disabled:opacity-40 ${
                  paymentMode === btn.mode
                    ? 'bg-brand border-brand text-white'
                    : sumupMode === btn.mode && sumupPolling
                    ? 'bg-warning-soft border-warning text-warning'
                    : btn.mode === 'unpaid'
                    ? 'bg-surface-2 border-dashed border text-ink-muted'
                    : 'bg-surface-2 border text-ink hover:border-brand'
                }`}>
                <span className="text-xl">{btn.icon}</span>
                <span className="flex-1">{btn.label}</span>
                {btn.mode === 'email' && !clientEmail && <span className="text-ink-muted text-xs">Email requis</span>}
                {btn.sumup && btn.mode !== 'email' && <span className="text-ink-muted text-xs">SumUp</span>}
              </button>
            ))}
          </div>
        )}

        <BigBtn label="Continuer →" onClick={() => setPage(9)}
          disabled={!amount || (!paymentMode && !sumupStatus)} />
      </div>

      {/* Easter egg : QR virement bancaire (plan B SumUp down). Photo de la
          confirmation client OBLIGATOIRE avant validation. Portail = plein écran. */}
      {portalReady && bankQrOpen && createPortal(
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setBankQrOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div>
              <h3 className="text-ink font-bold text-lg">Virement bancaire</h3>
              <p className="text-ink-muted text-sm mt-1">
                Le client scanne ce QR avec son app bancaire et effectue le virement de{' '}
                <span className="font-semibold text-ink">{formatEur(parseFloat(amount) || 0)}</span>.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-4 text-center">
              {bankQrImg && <img src={bankQrImg} alt="QR virement" className="mx-auto w-56 h-56" draggable={false} />}
            </div>

            {/* Photo OBLIGATOIRE de la confirmation client */}
            <div className="border-2 border-dashed rounded-2xl p-3 text-center">
              {bankProofUrl ? (
                <div>
                  <img src={bankProofUrl} alt="Confirmation" className="mx-auto max-h-40 rounded-lg mb-2" />
                  <p className="text-success text-xs font-semibold">✓ Confirmation enregistrée</p>
                  <label className="text-ink-muted text-xs underline cursor-pointer">
                    Reprendre la photo
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={e => uploadBankProof(e.target.files)} />
                  </label>
                </div>
              ) : (
                <label className="block cursor-pointer py-3">
                  <span className="block text-3xl mb-1">📷</span>
                  <span className="text-ink text-sm font-semibold">{bankUploading ? '⏳ Envoi…' : 'Photo de la confirmation client'}</span>
                  <span className="block text-ink-muted text-xs mt-0.5">Obligatoire — écran du client montrant le virement effectué</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={bankUploading}
                    onChange={e => uploadBankProof(e.target.files)} />
                </label>
              )}
            </div>

            <button
              type="button"
              disabled={!bankProofUrl}
              onClick={() => { setPaymentMode('virement_qr'); setSumupData(null); setSumupStatus(null); setBankQrOpen(false) }}
              className="w-full py-3.5 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white rounded-2xl text-sm font-bold transition">
              ✅ Virement confirmé
            </button>
            {!bankProofUrl && <p className="text-ink-muted text-xs text-center">Prends la photo de confirmation pour valider.</p>}

            <button type="button" onClick={() => setBankQrOpen(false)}
              className="w-full py-2 text-ink-muted hover:text-ink text-sm transition">Annuler</button>
          </div>
        </div>,
        document.body,
      )}
    </Shell>
  )

  // ── Page 5 — Sélection client ─────────────────────────────
  if (page === 5) return (
    <Shell title={t('encaissement.step_who_client')} page={6} totalPages={TOTAL} onBack={() => setPage(3)}>
      <div className="mt-2 flex flex-col gap-3">
        {previousClients.map(client => (
          <button key={client.id}
            onClick={() => { setSelectedClient(client); setIsNewClient(false); setPage(4) }}
            className="w-full text-left bg-surface-2 border border hover:border-brand rounded-2xl p-4 transition-all active:scale-95">
            <p className="text-ink font-semibold">{client.name}</p>
            {client.phone && <p className="text-ink-muted text-sm mt-0.5">{client.phone}</p>}
            {client.address && <p className="text-ink-muted text-xs mt-0.5 truncate">{client.address}</p>}
          </button>
        ))}
        <button onClick={() => { setSelectedClient(null); setIsNewClient(true); setPage(6) }}
          className="w-full bg-surface-2 border border-dashed border rounded-2xl p-4 text-ink-secondary font-medium text-center hover:border-ink-faint transition-all active:scale-95">
          Pas dans cette liste
        </button>
      </div>
    </Shell>
  )

  // ── Page 6 — TVA ─────────────────────────────────────────
  if (page === 6) return (
    <Shell title={t('encaissement.step_vat')} page={6} totalPages={TOTAL} onBack={() => setPage(5)}>
      <div className="mt-4">
        <input
          value={clientVat}
          onChange={e => { setClientVat(e.target.value.toUpperCase()); setViesResult(null) }}
          placeholder="BE0460759205"
          autoComplete="off"
          autoFocus
          className={`${inputCls} text-base font-semibold text-center uppercase mb-2`}
        />
        {viesResult && (
          <div className={`rounded-xl px-4 py-3 text-sm border mb-4 ${viesResult.valid ? 'bg-success-soft border-success text-success' : 'bg-critical-soft border-critical text-critical'}`}>
            {viesResult.valid
              ? viesResult.odooFound
                ? `✓ ${viesResult.odooName} — client existant`
                : `✓ ${viesResult.name || 'TVA valide'}`
              : '✗ TVA invalide ou introuvable'}
          </div>
        )}
        <p className="text-ink-muted text-xs text-center mb-8">Pour un particulier, passe directement</p>
        <div className="flex flex-col gap-3">
          <BigBtn
            label={viesLoading ? 'Vérification…' : 'Continuer →'}
            disabled={viesLoading}
            onClick={async () => {
              if (clientVat.length >= 5) {
                const result = await checkVies()
                if (result?.valid && result?.odooFound && result?.hasPhone) {
                  setPage(4); return
                }
              }
              setPage(7)
            }}
          />
          <BigBtn label="Client particulier →" secondary onClick={() => { setClientVat(''); setViesResult(null); setPage(7) }} />
        </div>
      </div>
    </Shell>
  )

  // Helper — remplir client depuis Odoo
  const fillFromOdooPartner = (p: any) => {
    setClientName(p.name)
    setClientPhone(p.phone)
    setClientEmail(p.email)
    setClientStreet(p.street)
    setClientZip(p.zip)
    setClientCity(p.city)
    setClientCountryCode(p.countryCode)
    setClientAddress(p.address)
    setClientVat(p.vat)
  }

  const searchOdooByName = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/partners?name=${encodeURIComponent(clientName.trim())}`)
      const data = await res.json()
      if (data.found) { fillFromOdooPartner(data.partner); return true }
    } catch {}
    return false
  }

  const searchOdooByPhone = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/partners?phone=${encodeURIComponent(clientPhone.trim())}`)
      const data = await res.json()
      if (data.found) { fillFromOdooPartner(data.partner); return true }
    } catch {}
    return false
  }

  const searchOdooByNameMultiple = async (): Promise<any[]> => {
    try {
      const inverted = clientName.trim().split(' ').length > 1
        ? [...clientName.trim().split(' ').slice(1), clientName.trim().split(' ')[0]].join(' ')
        : clientName.trim()

      const results: any[] = []
      for (const n of [clientName.trim(), inverted]) {
        const res = await fetch(`/api/partners?name=${encodeURIComponent(n)}`)
        const data = await res.json()
        if (data.found && !results.find(r => r.id === data.partner.id)) {
          results.push(data.partner)
        }
      }
      return results
    } catch {}
    return []
  }

  // ── Page 7 — Nom ─────────────────────────────────────────
  if (page === 7) return (
    <Shell title={t('encaissement.step_client_name')} page={7} totalPages={TOTAL} onBack={() => setPage(6)}>
      <div className="mt-4">
        <input
          value={clientName}
          onChange={e => setClientName(e.target.value)}
          placeholder="Nom et prénom ou société"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          className={`${inputCls} text-base font-semibold mb-8`}
        />
        <BigBtn
          label={nameSearchLoading ? 'Recherche…' : 'Continuer →'}
          disabled={!clientName.trim() || nameSearchLoading}
          onClick={async () => {
            if (!clientName.trim()) return
            setNameSearchLoading(true)
            const matches = await searchOdooByNameMultiple()
            setNameSearchLoading(false)
            if (matches.length > 0) {
              setOdooNameMatches(matches)
              setPage(14) // page de sélection des correspondances
            } else {
              setPage(8) // nouveau client direct
            }
          }}
        />
      </div>
    </Shell>
  )

  // ── Page 14 — Correspondances Odoo par nom ────────────────
  if (page === 14) return (
    <Shell title={t('encaissement.step_known_client')} page={7} totalPages={TOTAL} onBack={() => setPage(7)}>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-ink-muted text-xs mb-2">
          {odooNameMatches.length} correspondance{odooNameMatches.length > 1 ? 's' : ''} trouvée{odooNameMatches.length > 1 ? 's' : ''} pour "{clientName}"
        </p>
        {odooNameMatches.map(client => (
          <button
            key={client.id}
            onClick={() => {
              fillFromOdooPartner(client)
              setSelectedClient(client)
              setIsNewClient(false)
              setPage(4) // montant directement
            }}
            className="w-full text-left bg-surface-2 border border hover:border-brand rounded-2xl p-4 transition-all active:scale-95">
            <p className="text-ink font-semibold">{client.name}</p>
            {client.phone && <p className="text-ink-muted text-sm mt-0.5">{client.phone}</p>}
            {client.address && <p className="text-ink-muted text-xs mt-0.5 truncate">{client.address}</p>}
            {client.vat && <p className="text-ink-muted text-xs mt-0.5">{client.vat}</p>}
          </button>
        ))}
        <button
          onClick={() => {
            setSelectedClient(null)
            setIsNewClient(true)
            setOdooNameMatches([])
            setPage(8) // coordonnées nouveau client
          }}
          className="w-full bg-surface-2 border border-dashed border rounded-2xl p-4 text-ink-secondary font-medium text-center hover:border-ink-faint transition-all active:scale-95">
          Aucun de ces clients — créer un nouveau
        </button>
      </div>
    </Shell>
  )

  // ── Page 8 — Adresse + contact ───────────────────────────
  if (page === 8) return (
    <Shell title={t('encaissement.step_client_coords')} page={8} totalPages={TOTAL} onBack={() => setPage(7)}>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label className={labelCls}>Adresse</label>
          <input
            ref={clientAddressInputRef}
            value={clientAddress}
            onChange={e => setClientAddress(e.target.value)}
            placeholder="Rue, numéro, code postal, ville"
            autoCorrect="off"
            spellCheck={false}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Téléphone <span className="text-ink-faint text-xs">(optionnel)</span></label>
          <input
            value={clientPhone}
            onChange={e => setClientPhone(e.target.value)}
            type="tel" placeholder="+32 4xx xxx xxx"
            autoComplete="tel"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Email <span className="text-ink-faint text-xs">(optionnel)</span></label>
          <input
            value={clientEmail}
            onChange={e => setClientEmail(e.target.value)}
            type="email" placeholder="client@email.com"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={inputCls}
          />
        </div>
        {/* Olivier 2026-06-04 : telephone non obligatoire. Continuer toujours
            possible. Si telephone fourni et pas encore d adresse, on tente
            une derniere recherche Odoo par telephone. */}
        <BigBtn label="Continuer →" onClick={async () => {
          if (clientPhone.trim() && !clientStreet && !clientAddress) {
            await searchOdooByPhone()
          }
          setPage(4)
        }} />
      </div>
    </Shell>
  )

  // ── Page 9 — Récapitulatif ────────────────────────────────
  if (page === 9) {
    const client = selectedClient || {
      name: clientName, phone: clientPhone, email: clientEmail, address: clientAddress, vat: clientVat
    }
    const vehicleDisplay = vehicleConfirmed && odooVehicle
      ? `${odooVehicle.brandName} ${odooVehicle.modelName}`
      : `${selectedBrand} ${selectedModel === 'Autre' ? (modelOther || 'Autre') : selectedModel}`

    return (
      <Shell title={t('encaissement.step_recap')} page={9} totalPages={TOTAL} onBack={() => setPage(4)}>
        <div className="mt-2">
          {[
            { label: 'Immat', value: plate },
            { label: 'Véhicule', value: vehicleDisplay.trim() },
            { label: 'Motif', value: motifPrecision || motifLabel },
            { label: 'Lieu', value: location },
            // Le récap doit montrer ce qui part vraiment : en « à facturer », c'est
            // le solde complet, pas le montant tapé. Olivier 2026-08-12.
            { label: 'Montant', value: `${formatEur(paymentMode === 'unpaid' && dueAmount > 0 ? dueAmount : (parseFloat(amount || '0')))} TVAC` },
            { label: 'Paiement', value: paymentModes.find(p => p.value === paymentMode)?.label },
            { label: 'Client', value: client.name },
            { label: 'Téléphone', value: client.phone },
            { label: 'Adresse', value: client.address },
          ].filter(r => r.value).map(row => (
            <div key={row.label} className="flex justify-between items-start gap-3 py-2.5 border-b border">
              <span className="text-ink-muted text-sm flex-shrink-0">{row.label}</span>
              <span className="text-ink text-sm text-right">{row.value}</span>
            </div>
          ))}

          <div className="mt-5">
            <label className={labelCls}>Remarques (optionnel)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes internes…"
              rows={2}
              className={`${inputCls} resize-none mb-5`}
            />
            <BigBtn label={saving ? 'Enregistrement…' : '✓ Enregistrer'} onClick={handleSubmit} disabled={saving} />
            {error && <p className="text-critical text-sm text-center mt-3">{error}</p>}
          </div>
        </div>
      </Shell>
    )
  }

  return null
}
