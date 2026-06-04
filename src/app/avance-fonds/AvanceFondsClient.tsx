// src/app/avance-fonds/AvanceFondsClient.tsx
'use client'

import { useState, useRef, useEffect }  from 'react'
import { useRouter, useSearchParams }    from 'next/navigation'
import Link                   from 'next/link'
import Image                  from 'next/image'
import AppShell               from '@/components/layout/AppShell'
import { formatEur }           from '@/lib/format'
import VehiclePlateLookup     from '@/components/vehicles/VehiclePlateLookup'
import { normalizePlate }     from '@/lib/plate'
import type { VehicleMatch }  from '@/types/vehicles'

// ── Types ──────────────────────────────────────────────────
interface Brand { id: number; name: string }
interface Model { id: number; name: string }

type Step = 'photo' | 'plate' | 'vehicle_confirm' | 'vehicle_create' | 'details' | 'confirm' | 'success'

interface FormState {
  plate:         string
  brandName:     string
  modelName:     string
  amountHtva:    string
  amountTvac:    string
  paymentMethod: string
  notes:         string
  photoFile:     File | null
  photoPreview:  string | null
  vehicleMatch:  VehicleMatch | null
}

const EMPTY_FORM: FormState = {
  plate: '', brandName: '', modelName: '',
  amountHtva: '', amountTvac: '', paymentMethod: '', notes: '',
  photoFile: null, photoPreview: null, vehicleMatch: null,
}

const PAYMENT_METHODS = [
  { value: 'cash',       label: '💵 Cash'      },
  { value: 'bancontact', label: '💳 Bancontact' },
  { value: 'card',       label: '💳 Carte'      },
  { value: 'virement',   label: '🏦 Virement'   },
]

// ── Composants utilitaires ──────────────────────────────────
function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-ink-muted text-sm flex-shrink-0">{label}</span>
      <span className={`text-ink text-sm text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl p-3 text-sm">
      {message}
    </div>
  )
}

// ── Bouton retour mobile ────────────────────────────────────
function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="lg:hidden px-4 pt-3 pb-1">
      <button onClick={onClick} className="text-ink-secondary hover:text-ink text-sm transition-colors">
        ← Retour
      </button>
    </div>
  )
}

// ── Composant principal ─────────────────────────────────────
export default function AvanceFondsClient({ user }: { user: any }) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const fileRef      = useRef<HTMLInputElement>(null)
  const cameraRef    = useRef<HTMLInputElement>(null)

  const userRole    = user?.role ?? 'driver'
  const userName    = user?.name ?? ''
  const userModules = (user?.modules ?? []) as string[]

  // Olivier 2026-06-01 : pre-remplissage depuis query params quand le wizard
  // est ouvert depuis une fiche mission. mission_id sera envoye a l API pour
  // lier l avance a la mission. plate/brand/model preremplis permettent de
  // sauter les etapes correspondantes.
  const missionId    = searchParams.get('mission_id') || null
  const prefillPlate = searchParams.get('plate')      || ''
  const prefillBrand = searchParams.get('brand')      || ''
  const prefillModel = searchParams.get('model')      || ''
  const missionRef   = searchParams.get('mission_ref') || ''

  const [step,          setStep]          = useState<Step>('photo')
  const [loading,       setLoading]       = useState(false)
  /** Modal de lookup véhicule (Phase 1 multi-match Odoo) */
  const [showLookup,    setShowLookup]    = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [form,          setForm]          = useState<FormState>(EMPTY_FORM)
  const [ocrRunning,    setOcrRunning]    = useState(false)
  const [ocrInfo,       setOcrInfo]       = useState<string | null>(null)
  const [brands,        setBrands]        = useState<Brand[]>([])
  const [models,        setModels]        = useState<Model[]>([])
  const [loadingBrands, setLoadingBrands] = useState(false)

  // Pre-fill depuis query params (au mount uniquement). Si plate + brand +
  // model sont tous fournis (cas typique : ouverture depuis fiche mission),
  // on skip directement aux details apres la photo.
  useEffect(() => {
    if (prefillPlate || prefillBrand || prefillModel) {
      setForm(f => ({
        ...f,
        plate:     prefillPlate ? normalizePlate(prefillPlate) : f.plate,
        brandName: prefillBrand || f.brandName,
        modelName: prefillModel || f.modelName,
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Helpers ───────────────────────────────────────────────
  const goBack = (s: Step) => { setError(null); setStep(s) }

  // Olivier 2026-06-04 : OCR Claude Vision pour extraire HTVA + TVAC depuis
  // la facture. Lance en arriere-plan apres choix du fichier, prefille les
  // 2 champs si succes. User peut toujours corriger manuellement.
  const runOcr = async (file: File) => {
    setOcrRunning(true)
    setOcrInfo(null)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      const r = await fetch('/api/advances/ocr', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ base64, mimeType: file.type }),
      })
      const j = await r.json()
      if (j.ok) {
        setForm(f => ({
          ...f,
          amountHtva: j.amount_htva != null ? String(j.amount_htva) : f.amountHtva,
          amountTvac: j.amount_tvac != null ? String(j.amount_tvac) : f.amountTvac,
        }))
        const parts: string[] = []
        if (j.fournisseur) parts.push(j.fournisseur)
        if (j.amount_htva != null) parts.push(`HTVA ${j.amount_htva}€`)
        if (j.amount_tvac != null) parts.push(`TVAC ${j.amount_tvac}€`)
        setOcrInfo(parts.length > 0 ? `✓ ${parts.join(' · ')} (confiance ${j.confidence || 'medium'})` : null)
      } else {
        setOcrInfo(`⚠ OCR : ${j.error || 'echec, saisie manuelle requise'}`)
      }
    } catch (e: any) {
      setOcrInfo(`⚠ OCR : ${e?.message || 'erreur reseau'}`)
    } finally {
      setOcrRunning(false)
    }
  }

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setForm(f => ({ ...f, photoFile: file, photoPreview: URL.createObjectURL(file) }))
    // Lance l OCR en parallele (non bloquant, l user peut continuer)
    runOcr(file)
    // Si plate + brand + model sont preremplis (depuis fiche mission),
    // on saute directement a l'etape "details" (montant + paiement).
    if (prefillPlate && prefillBrand && prefillModel) {
      setStep('details')
    } else {
      setStep('plate')
    }
  }

  const loadBrands = async () => {
    if (brands.length > 0) return
    setLoadingBrands(true)
    try {
      const res  = await fetch('/api/vehicles?type=brands')
      setBrands(await res.json() || [])
    } finally {
      setLoadingBrands(false)
    }
  }

  const loadModels = async (brandId: number) => {
    setModels([])
    const res = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
    setModels(await res.json() || [])
  }

  /** Ouvre la modal lookup véhicule (Phase 1 multi-match via composant partagé). */
  const handlePlateLookup = () => {
    const normalized = normalizePlate(form.plate)
    if (!normalized) { setError('Veuillez saisir une immatriculation'); return }
    setError(null)
    setShowLookup(true)
  }

  /** Callback : véhicule existant choisi (skip auto si 1 seul résultat exact). */
  const handleVehicleSelect = (v: VehicleMatch) => {
    setForm(f => ({ ...f, vehicleMatch: v }))
    setShowLookup(false)
    setStep('vehicle_confirm')
  }

  /** Callback : "Aucun de ceux-là, créer nouveau" → step saisie marque/modèle. */
  const handleCreateNewVehicle = () => {
    setShowLookup(false)
    setStep('vehicle_create')
  }

  const uploadPhoto = async (file: File): Promise<string> => {
    const jpegBase64 = await new Promise<string>((resolve, reject) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        canvas.width  = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.88).split(',')[1])
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        const reader = new FileReader()
        reader.onload  = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      }
      img.src = url
    })

    const res  = await fetch('/api/advances/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: jpegBase64, mimeType: 'image/jpeg', filename: 'photo.jpg' }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload échoué')
    return data.url as string
  }

  const handleSubmit = async () => {
    if (!form.photoFile) return
    setLoading(true); setError(null)
    try {
      const invoiceUrl = await uploadPhoto(form.photoFile)
      const res = await fetch('/api/advances', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate:         normalizePlate(form.plate),
          amountHtva:    form.amountHtva,
          amountTvac:    form.amountTvac || undefined,
          paymentMethod: form.paymentMethod,
          invoiceUrl,
          notes:         form.notes || undefined,
          brandName:     form.brandName || undefined,
          modelName:     form.modelName || undefined,
          missionId:     missionId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setStep('success')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  const validateDetails = (): string | null => {
    if (!form.amountHtva)                 return 'Veuillez saisir le montant HTVA'
    if (parseFloat(form.amountHtva) <= 0) return 'Le montant HTVA doit être supérieur à 0'
    if (!form.amountTvac)                 return 'Veuillez saisir le montant TVAC'
    if (parseFloat(form.amountTvac) <= 0) return 'Le montant TVAC doit être supérieur à 0'
    if (!form.paymentMethod)              return 'Veuillez sélectionner un mode de paiement'
    return null
  }

  // Bandeau "Liée à la mission" affiche en haut quand on vient d une fiche.
  const MissionBanner = () => missionId ? (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-4 text-center">
      <p className="text-blue-700 text-xs uppercase tracking-wider font-bold">🔗 Avance liée à la mission</p>
      {missionRef && <p className="text-blue-900 text-sm font-semibold mt-0.5">{missionRef}</p>}
      <p className="text-blue-700 text-[11px] mt-1">La facture sera ajoutée au devis lors de la facturation.</p>
    </div>
  ) : null

  // ── STEP : PHOTO ───────────────────────────────────────────
  if (step === 'photo') return (
    <AppShell title="Avance de fonds" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 gap-8 max-w-md mx-auto">
        <MissionBanner />
        <div className="text-center">
          <div className="text-6xl mb-3">📄</div>
          <p className="text-ink font-semibold text-lg">Photographiez la facture</p>
          <p className="text-ink-muted text-sm mt-1">Photo de la facture reçue chez le garage</p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <button onClick={() => cameraRef.current?.click()}
            className="w-full py-5 bg-brand hover:bg-brand/90 text-ink rounded-2xl font-semibold text-lg flex items-center justify-center gap-3">
            <span className="text-2xl">📷</span> Prendre une photo
          </button>
          <input ref={cameraRef} type="file" accept="image/*"
            className="hidden" onChange={handlePhoto} />
          <button onClick={() => fileRef.current?.click()}
            className="w-full py-4 bg-surface border border text-ink-secondary rounded-2xl font-medium flex items-center justify-center gap-3">
            <span className="text-xl">🗂️</span> Galerie / PDF
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf"
            className="hidden" onChange={handlePhoto} />
        </div>
      </div>
    </AppShell>
  )

  // ── STEP : PLAQUE ───────────────────────────────────────────
  if (step === 'plate') return (
    <AppShell title="Immatriculation" userRole={userRole} userName={userName} userModules={userModules}>
      <BackBtn onClick={() => goBack('photo')} />
      <div className="px-4 py-6 flex flex-col gap-5 max-w-md mx-auto">
        {form.photoPreview && (
          <div className="rounded-2xl overflow-hidden border border">
            <img src={form.photoPreview} alt="Facture" className="w-full max-h-40 object-cover" />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-2">Immatriculation *</label>
          <input type="text" inputMode="text" autoCapitalize="characters"
            placeholder="1ABC234 ou 1-ABC-234" value={form.plate}
            onChange={e => setForm(f => ({ ...f, plate: e.target.value.toUpperCase() }))}
            className="w-full bg-surface border border rounded-xl px-4 py-4
                       text-ink text-2xl font-mono tracking-widest placeholder-zinc-700
                       focus:outline-none focus:border-brand" />
          <p className="text-ink-faint text-xs mt-1.5">Les tirets et points sont ignorés automatiquement</p>
        </div>
        {error && <ErrorBox message={error} />}
        <button onClick={handlePlateLookup} disabled={!form.plate.trim()}
          className="w-full py-4 bg-brand hover:bg-brand/90 disabled:bg-surface-2 disabled:text-ink-faint
                     text-ink rounded-2xl font-bold text-lg transition-colors">
          Rechercher →
        </button>
      </div>
      <VehiclePlateLookup
        plate={form.plate}
        open={showLookup}
        onSelect={handleVehicleSelect}
        onCreateNew={handleCreateNewVehicle}
        onCancel={() => setShowLookup(false)}
      />
    </AppShell>
  )

  // ── STEP : VÉHICULE CONFIRMÉ ────────────────────────────────
  if (step === 'vehicle_confirm') return (
    <AppShell title="Véhicule trouvé" userRole={userRole} userName={userName} userModules={userModules}>
      <BackBtn onClick={() => goBack('plate')} />
      <div className="px-4 py-6 flex flex-col gap-4 max-w-md mx-auto">
        <div className="bg-surface border border rounded-2xl p-5">
          <p className="text-ink-secondary text-xs font-semibold uppercase tracking-widest mb-3">Véhicule identifié</p>
          <div className="flex items-center gap-4">
            <div className="text-4xl">🚗</div>
            <div>
              <p className="text-ink text-xl font-mono font-bold">{form.vehicleMatch?.plate}</p>
              {form.vehicleMatch?.model && (
                <p className="text-ink-secondary text-sm mt-0.5">{form.vehicleMatch.model}</p>
              )}
            </div>
          </div>
        </div>
        <p className="text-ink-secondary text-sm text-center mt-2">S'agit-il bien de ce véhicule ?</p>
        <div className="flex flex-col gap-3 mt-2">
          <button onClick={() => setStep('details')}
            className="w-full py-4 bg-green-700 hover:bg-green-600 text-ink rounded-2xl font-bold text-lg">
            ✅ Oui, c'est ce véhicule
          </button>
          <button onClick={() => { setForm(f => ({ ...f, vehicleMatch: null })); setStep('vehicle_create') }}
            className="w-full py-3 bg-surface border border text-ink-secondary rounded-2xl font-medium">
            Non, saisir manuellement
          </button>
        </div>
      </div>
    </AppShell>
  )

  // ── STEP : NOUVEAU VÉHICULE — MARQUE ───────────────────────
  if (step === 'vehicle_create' && !form.brandName) {
    if (brands.length === 0 && !loadingBrands) loadBrands()
    return (
      <AppShell title="Quelle est la marque ?" userRole={userRole} userName={userName} userModules={userModules}>
        <BackBtn onClick={() => goBack('plate')} />
        <div className="px-4 py-6 flex flex-col gap-3 max-w-md mx-auto overflow-y-auto pb-10">
          <div className="bg-surface border border rounded-xl px-4 py-3 mb-2">
            <p className="text-ink-secondary text-xs mb-1">Immatriculation</p>
            <p className="text-ink font-mono text-xl font-bold">{normalizePlate(form.plate)}</p>
          </div>
          {loadingBrands ? (
            <p className="text-ink-muted text-sm text-center py-8">Chargement…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {brands.map(b => (
                <button key={b.id}
                  onClick={() => { setForm(f => ({ ...f, brandName: b.name, modelName: '' })); loadModels(b.id) }}
                  className="w-full text-left px-5 py-4 rounded-2xl border border bg-surface
                             text-ink font-medium hover:border-brand transition-all active:scale-95">
                  {b.name}
                </button>
              ))}
            </div>
          )}
          {error && <ErrorBox message={error} />}
        </div>
      </AppShell>
    )
  }

  // ── STEP : NOUVEAU VÉHICULE — MODÈLE ───────────────────────
  if (step === 'vehicle_create' && form.brandName) return (
    <AppShell title="Quel est le modèle ?" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="px-4 py-6 flex flex-col gap-3 max-w-md mx-auto pb-10">
        <div className="bg-surface border border rounded-xl px-4 py-3 mb-2 flex items-center justify-between">
          <div>
            <p className="text-ink-secondary text-xs mb-0.5">Marque sélectionnée</p>
            <p className="text-ink font-bold">{form.brandName}</p>
          </div>
          <button onClick={() => setForm(f => ({ ...f, brandName: '', modelName: '' }))}
            className="text-ink-muted hover:text-ink text-sm">Changer</button>
        </div>
        <div className="flex flex-col gap-2">
          {models.map(m => (
            <button key={m.id}
              onClick={() => { setForm(f => ({ ...f, modelName: m.name })); setError(null); setStep('details') }}
              className="w-full text-left px-5 py-4 rounded-2xl border border bg-surface
                         text-ink font-medium hover:border-brand transition-all active:scale-95">
              {m.name}
            </button>
          ))}
          <div className="mt-2">
            <input type="text" placeholder="Autre modèle…"
              value={form.modelName.startsWith('_custom:') ? form.modelName.replace('_custom:', '') : ''}
              onChange={e => setForm(f => ({ ...f, modelName: `_custom:${e.target.value}` }))}
              className="w-full bg-surface border border rounded-2xl px-5 py-4
                         text-ink placeholder-zinc-600 focus:outline-none focus:border-brand text-xl font-bold text-center" />
          </div>
        </div>
        {error && <ErrorBox message={error} />}
        <button
          onClick={() => {
            const modelVal = form.modelName.startsWith('_custom:')
              ? form.modelName.replace('_custom:', '').trim()
              : form.modelName.trim()
            if (!modelVal) { setError('Veuillez choisir ou saisir un modèle'); return }
            setForm(f => ({ ...f, modelName: modelVal })); setError(null); setStep('details')
          }}
          className="w-full py-4 bg-brand hover:bg-brand/90 text-ink rounded-2xl font-bold text-lg mt-2">
          Continuer →
        </button>
      </div>
    </AppShell>
  )

  // ── STEP : DÉTAILS ─────────────────────────────────────────
  if (step === 'details') return (
    <AppShell title="Détails de la facture" userRole={userRole} userName={userName} userModules={userModules}>
      <BackBtn onClick={() => goBack(form.vehicleMatch ? 'vehicle_confirm' : 'vehicle_create')} />
      <div className="px-4 py-6 flex flex-col gap-5 max-w-md mx-auto pb-10">
        {/* Recap véhicule */}
        <div className="bg-surface border border rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-xl">🚗</span>
          <div>
            <p className="text-ink font-mono font-bold">{normalizePlate(form.plate)}</p>
            {(form.vehicleMatch?.model || form.modelName) && (
              <p className="text-ink-muted text-xs">
                {form.vehicleMatch?.model ?? `${form.brandName} ${form.modelName}`}
              </p>
            )}
          </div>
        </div>

        {/* Bloc montants : HTVA (PU facturation Odoo) + TVAC (mouvement caisse).
            Olivier 2026-06-04 : OCR Claude Vision pre-remplit automatiquement
            les 2 depuis la facture uploadee. User peut corriger. */}
        {(ocrRunning || ocrInfo) && (
          <div className={`rounded-lg px-3 py-2 text-xs ${
            ocrRunning ? 'bg-info-50 text-info-800 border border-info-200'
            : ocrInfo?.startsWith('⚠') ? 'bg-warning-50 text-warning-800 border border-warning-200'
            : 'bg-success-50 text-success-800 border border-success-200'
          }`}>
            {ocrRunning ? '🔍 Analyse OCR de la facture...' : ocrInfo}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1.5">Montant HTVA *</label>
            <div className="relative">
              <input type="number" inputMode="decimal" step="0.01" min="0"
                placeholder="0.00" value={form.amountHtva}
                onChange={e => setForm(f => ({ ...f, amountHtva: e.target.value }))}
                className="w-full bg-surface border border rounded-xl px-3 py-3
                           text-ink text-xl font-semibold pr-8 placeholder-zinc-700
                           focus:outline-none focus:border-brand" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm font-medium">€</span>
            </div>
            <p className="text-[10px] text-ink-muted mt-1">→ PU ligne facturation</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1.5">Montant TVAC *</label>
            <div className="relative">
              <input type="number" inputMode="decimal" step="0.01" min="0"
                placeholder="0.00" value={form.amountTvac}
                onChange={e => setForm(f => ({ ...f, amountTvac: e.target.value }))}
                className="w-full bg-surface border border rounded-xl px-3 py-3
                           text-ink text-xl font-semibold pr-8 placeholder-zinc-700
                           focus:outline-none focus:border-brand" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm font-medium">€</span>
            </div>
            <p className="text-[10px] text-ink-muted mt-1">→ mouvement caisse</p>
          </div>
        </div>

        {/* Mode de paiement */}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-2">Mode de paiement *</label>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map(pm => (
              <button key={pm.value}
                onClick={() => setForm(f => ({ ...f, paymentMethod: pm.value }))}
                className={`py-3 rounded-xl font-medium transition-all ${
                  form.paymentMethod === pm.value
                    ? 'bg-brand text-white ring-2 ring-brand/50'
                    : 'bg-surface text-ink-secondary border border hover:border-zinc-500'
                }`}>
                {pm.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">
            Notes <span className="text-ink-faint">(optionnel)</span>
          </label>
          <textarea rows={2} placeholder="Nom du garage, remarques…" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full bg-surface border border rounded-xl px-4 py-3
                       text-ink placeholder-zinc-700 focus:outline-none focus:border-brand resize-none" />
        </div>

        {error && <ErrorBox message={error} />}

        <button
          onClick={() => {
            const err = validateDetails()
            if (err) { setError(err); return }
            setError(null); setStep('confirm')
          }}
          className="w-full py-4 bg-brand hover:bg-brand/90 text-ink rounded-2xl font-bold text-lg">
          Vérifier →
        </button>
      </div>
    </AppShell>
  )

  // ── STEP : CONFIRMATION ────────────────────────────────────
  if (step === 'confirm') return (
    <AppShell title="Confirmation" userRole={userRole} userName={userName} userModules={userModules}>
      <BackBtn onClick={() => goBack('details')} />
      <div className="px-4 py-6 flex flex-col gap-4 max-w-md mx-auto pb-10">
        <div className="bg-surface border border rounded-2xl overflow-hidden">
          {form.photoPreview && (
            <img src={form.photoPreview} alt="Facture"
              className="w-full max-h-56 object-cover border-b border" />
          )}
          <div className="p-4 space-y-3">
            <Row label="Immatriculation" value={normalizePlate(form.plate)} mono />
            {(form.vehicleMatch?.model || form.modelName) && (
              <Row label="Véhicule" value={form.vehicleMatch?.model ?? `${form.brandName} ${form.modelName}`} />
            )}
            <Row label="Montant HTVA"    value={formatEur(parseFloat(form.amountHtva))} />
            <Row label="Mode de paiement"
              value={PAYMENT_METHODS.find(p => p.value === form.paymentMethod)?.label ?? form.paymentMethod} />
            {form.notes && <Row label="Notes" value={form.notes} />}
          </div>
        </div>

        <div className="bg-blue-950/40 border border-blue-900 rounded-xl p-4 space-y-1.5">
          <p className="font-semibold text-blue-200 text-sm mb-2">Actions automatiques</p>
          <p className="text-blue-300 text-sm">✉️ Facture transmise au service comptable</p>
          <p className="text-blue-300 text-sm">📋 Ajout au dossier client du véhicule</p>
          <p className="text-blue-300 text-sm">🚗 Véhicule renseigné sur le devis</p>
          <p className="text-blue-300 text-sm">💾 Enregistré dans l'application</p>
        </div>

        {error && <ErrorBox message={error} />}

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-4 bg-green-700 hover:bg-green-600 disabled:bg-surface-2
                     disabled:text-ink-faint text-ink rounded-2xl font-bold text-lg transition-colors">
          {loading
            ? <span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Envoi…</span>
            : '✅ Confirmer et envoyer'}
        </button>
      </div>
    </AppShell>
  )

  // ── STEP : SUCCÈS ──────────────────────────────────────────
  return (
    <AppShell title="Avance enregistrée" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center gap-7 max-w-md mx-auto">
        <div className="text-8xl">✅</div>
        <div>
          <h2 className="text-2xl font-bold text-ink">Avance enregistrée</h2>
          <p className="text-ink-muted mt-2 text-sm max-w-xs mx-auto">
            {missionId
              ? `La facture est liée à la mission${missionRef ? ` ${missionRef}` : ''} et sera ajoutée au devis lors de la facturation.`
              : 'La facture a été transmise au service comptable et le dossier véhicule mis à jour.'}
          </p>
        </div>
        <div className="bg-surface border border rounded-2xl p-4 w-full max-w-xs text-left space-y-3">
          {missionId && missionRef && <Row label="Mission" value={missionRef} />}
          <Row label="Plaque"   value={normalizePlate(form.plate)} mono />
          <Row label="Montant"  value={`${formatEur(parseFloat(form.amountHtva))} HTVA`} />
          <Row label="Paiement" value={PAYMENT_METHODS.find(p => p.value === form.paymentMethod)?.label ?? form.paymentMethod} />
        </div>
        <div className="flex flex-col w-full max-w-xs gap-3">
          {missionId ? (
            <button onClick={() => router.push(`/mission/${missionId}`)}
              className="w-full py-3 bg-brand hover:bg-brand/90 text-ink rounded-xl font-semibold">
              ← Retour à la mission
            </button>
          ) : (
            <button onClick={() => router.push('/dashboard')}
              className="w-full py-3 bg-brand hover:bg-brand/90 text-ink rounded-xl font-semibold">
              Tableau de bord
            </button>
          )}
          <button onClick={() => { setForm(EMPTY_FORM); setError(null); setStep('photo') }}
            className="w-full py-3 bg-surface border border text-ink-secondary rounded-xl font-medium">
            Nouvelle avance
          </button>
        </div>
      </div>
    </AppShell>
  )
}
