// src/app/avance-fonds/AvanceFondsClient.tsx
'use client'

import { useState, useRef } from 'react'
import { useRouter }        from 'next/navigation'
import Link                 from 'next/link'
import Image                from 'next/image'

interface Brand { id: number; name: string }
interface Model { id: number; name: string }

const PAYMENT_METHODS = [
  { value: 'cash',       label: '💵 Cash'      },
  { value: 'bancontact', label: '💳 Bancontact' },
  { value: 'card',       label: '💳 Carte'      },
  { value: 'virement',   label: '🏦 Virement'   },
]

type Step = 'photo' | 'plate' | 'vehicle_confirm' | 'vehicle_create' | 'details' | 'confirm' | 'success'

interface VehicleMatch {
  id:    number
  plate: string
  model: string | null
}

interface FormState {
  plate:         string
  brandName:     string
  modelName:     string
  amountHtva:    string
  paymentMethod: string
  notes:         string
  photoFile:     File | null
  photoPreview:  string | null
  vehicleMatch:  VehicleMatch | null
}

const EMPTY_FORM: FormState = {
  plate: '', brandName: '', modelName: '',
  amountHtva: '', paymentMethod: '', notes: '',
  photoFile: null, photoPreview: null, vehicleMatch: null,
}

// Normalise la plaque : supprime - . espaces, majuscules
function normalizePlate(p: string): string {
  return p.replace(/[-.\s]/g, '').toUpperCase().trim()
}

export default function AvanceFondsClient({ user }: { user: any }) {
  const router      = useRouter()
  const fileRef     = useRef<HTMLInputElement>(null)
  const cameraRef   = useRef<HTMLInputElement>(null)

  const [step,      setStep]      = useState<Step>('photo')
  const [loading,   setLoading]   = useState(false)
  const [searching, setSearching] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [form,      setForm]      = useState<FormState>(EMPTY_FORM)
  const [brands,    setBrands]    = useState<Brand[]>([])
  const [models,    setModels]    = useState<Model[]>([])
  const [loadingBrands, setLoadingBrands] = useState(false)

  // ── Header commun ──────────────────────────────────────────
  const Header = ({ title, backStep }: { title: string; backStep?: Step }) => (
    <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-4 pt-12 pb-3 safe-top">
      <div className="flex items-center justify-between mb-3">
        <Link href="/dashboard" className="bg-white rounded-lg px-2.5 py-1">
          <Image src="/logo.jpg" alt="Verviers Dépannage" width={80} height={36} className="h-9 w-auto object-contain" />
        </Link>
        {backStep ? (
          <button onClick={() => { setError(null); setStep(backStep) }}
            className="text-zinc-400 hover:text-white text-sm transition-colors">
            ← Retour
          </button>
        ) : (
          <Link href="/dashboard" className="text-zinc-400 hover:text-white text-sm transition-colors">
            ← Dashboard
          </Link>
        )}
      </div>
      <p className="text-white font-bold text-lg">{title}</p>
    </div>
  )

  // ── Charger les marques ───────────────────────────────────
  const loadBrands = async () => {
    if (brands.length > 0) return
    setLoadingBrands(true)
    try {
      const res  = await fetch('/api/vehicles?type=brands')
      const data = await res.json()
      setBrands(data || [])
    } catch (e) {
      console.error('loadBrands:', e)
    } finally {
      setLoadingBrands(false)
    }
  }

  const loadModels = async (brandId: number) => {
    setModels([])
    try {
      const res  = await fetch(`/api/vehicles?type=models&brandId=${brandId}`)
      const data = await res.json()
      setModels(data || [])
    } catch (e) {
      console.error('loadModels:', e)
    }
  }

  // ── Photo ──────────────────────────────────────────────────
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setForm(f => ({ ...f, photoFile: file, photoPreview: URL.createObjectURL(file) }))
    setStep('plate')
  }

  // ── Recherche véhicule ─────────────────────────────────────
  const handlePlateLookup = async () => {
    const normalized = normalizePlate(form.plate)
    if (!normalized) { setError('Veuillez saisir une immatriculation'); return }

    setSearching(true)
    setError(null)

    try {
      const res  = await fetch(`/api/advances/lookup?plate=${encodeURIComponent(normalized)}`)
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? 'Erreur recherche')

      if (data.found) {
        setForm(f => ({ ...f, vehicleMatch: data }))
        setStep('vehicle_confirm')
      } else {
        setStep('vehicle_create')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSearching(false)
    }
  }

  // ── Upload photo ───────────────────────────────────────────
  // 1. Convertit via canvas → vrai JPEG (gère HEIC iOS)
  // 2. Envoie en base64 JSON (évite le rejet FormData iOS)
  const uploadPhoto = async (file: File): Promise<string> => {
    // Convertir en vrai JPEG via canvas (résout HEIC + ratio correct)
    const jpegBase64 = await new Promise<string>((resolve, reject) => {
      const img = new window.Image()
      const url = URL.createObjectURL(file)

      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        // Conserver les dimensions originales exactes
        canvas.width  = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        // Extraire base64 sans le préfixe data:image/jpeg;base64,
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
        resolve(dataUrl.split(',')[1])
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        // Fallback : lire via FileReader sans conversion
        const reader = new FileReader()
        reader.onload  = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      }

      img.src = url
    })

    const res = await fetch('/api/advances/upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        base64:   jpegBase64,
        mimeType: 'image/jpeg',
        filename: 'photo.jpg',
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload échoué')
    return data.url as string
  }

  // ── Soumission ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.photoFile) return
    setLoading(true)
    setError(null)
    try {
      const invoiceUrl = await uploadPhoto(form.photoFile)
      const res = await fetch('/api/advances', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate:         normalizePlate(form.plate),
          amountHtva:    form.amountHtva,
          paymentMethod: form.paymentMethod,
          invoiceUrl,
          notes:         form.notes || undefined,
          brandName:     form.brandName || undefined,
          modelName:     form.modelName || undefined,
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
    if (parseFloat(form.amountHtva) <= 0) return 'Le montant doit être supérieur à 0'
    if (!form.paymentMethod)              return 'Veuillez sélectionner un mode de paiement'
    return null
  }

  // ────────────────────────────────────────────────────────────
  // STEP : PHOTO
  // ────────────────────────────────────────────────────────────
  if (step === 'photo') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <Header title="Avance de fonds" />
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div className="text-center">
          <div className="text-6xl mb-3">📄</div>
          <p className="text-white font-semibold text-lg">Photographiez la facture</p>
          <p className="text-zinc-500 text-sm mt-1">Photo de la facture reçue chez le garage</p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <button onClick={() => cameraRef.current?.click()}
            className="w-full py-5 bg-brand hover:bg-brand/90 text-white rounded-2xl font-semibold text-lg flex items-center justify-center gap-3">
            <span className="text-2xl">📷</span> Prendre une photo
          </button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment"
            className="hidden" onChange={handlePhoto} />

          <button onClick={() => fileRef.current?.click()}
            className="w-full py-4 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-300 rounded-2xl font-medium flex items-center justify-center gap-3">
            <span className="text-xl">🗂️</span> Galerie / PDF
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf"
            className="hidden" onChange={handlePhoto} />
        </div>
      </div>
    </div>
  )

  // ────────────────────────────────────────────────────────────
  // STEP : SAISIE PLAQUE
  // ────────────────────────────────────────────────────────────
  if (step === 'plate') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <Header title="Immatriculation" backStep="photo" />
      <div className="flex-1 px-4 py-6 flex flex-col gap-5">

        {form.photoPreview && (
          <div className="rounded-2xl overflow-hidden border border-[#2a2a2a]">
            <img src={form.photoPreview} alt="Facture" className="w-full max-h-40 object-cover" />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            Immatriculation du véhicule *
          </label>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            placeholder="1ABC234 ou 1-ABC-234"
            value={form.plate}
            onChange={e => setForm(f => ({ ...f, plate: e.target.value.toUpperCase() }))}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-4
                       text-white text-2xl font-mono tracking-widest placeholder-zinc-700
                       focus:outline-none focus:border-brand"
          />
          <p className="text-zinc-600 text-xs mt-1.5">
            Les tirets et points sont ignorés automatiquement
          </p>
        </div>

        {error && <ErrorBox message={error} />}

        <button
          onClick={handlePlateLookup}
          disabled={searching || !form.plate.trim()}
          className="w-full py-4 bg-brand hover:bg-brand/90 disabled:bg-zinc-800 disabled:text-zinc-600
                     text-white rounded-2xl font-bold text-lg transition-colors mt-auto"
        >
          {searching
            ? <span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Recherche…</span>
            : 'Rechercher →'
          }
        </button>
      </div>
    </div>
  )

  // ────────────────────────────────────────────────────────────
  // STEP : VÉHICULE TROUVÉ — CONFIRMATION
  // ────────────────────────────────────────────────────────────
  if (step === 'vehicle_confirm') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <Header title="Véhicule trouvé" backStep="plate" />
      <div className="flex-1 px-4 py-6 flex flex-col gap-4">

        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
          <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-3">
            Véhicule identifié
          </p>
          <div className="flex items-center gap-4">
            <div className="text-4xl">🚗</div>
            <div>
              <p className="text-white text-xl font-mono font-bold">
                {form.vehicleMatch?.plate}
              </p>
              {form.vehicleMatch?.model && (
                <p className="text-zinc-400 text-sm mt-0.5">{form.vehicleMatch.model}</p>
              )}
            </div>
          </div>
        </div>

        <p className="text-zinc-300 text-sm text-center mt-2">
          S'agit-il bien de ce véhicule ?
        </p>

        <div className="flex flex-col gap-3 mt-2">
          <button
            onClick={() => setStep('details')}
            className="w-full py-4 bg-green-700 hover:bg-green-600 text-white rounded-2xl font-bold text-lg"
          >
            ✅ Oui, c'est ce véhicule
          </button>
          <button
            onClick={() => {
              setForm(f => ({ ...f, vehicleMatch: null }))
              setStep('vehicle_create')
            }}
            className="w-full py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-300 rounded-2xl font-medium"
          >
            Non, saisir manuellement
          </button>
        </div>
      </div>
    </div>
  )

  // ────────────────────────────────────────────────────────────
  // STEP : VÉHICULE INCONNU — CHOISIR MARQUE
  // ────────────────────────────────────────────────────────────
  if (step === 'vehicle_create' && !form.brandName) {
    if (brands.length === 0 && !loadingBrands) loadBrands()
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
        <Header title="Quelle est la marque ?" backStep="plate" />
        <div className="flex-1 px-4 py-6 flex flex-col gap-3 overflow-y-auto pb-10">
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3 mb-2">
            <p className="text-zinc-400 text-xs mb-1">Immatriculation</p>
            <p className="text-white font-mono text-xl font-bold">{normalizePlate(form.plate)}</p>
          </div>

          {loadingBrands ? (
            <p className="text-zinc-500 text-sm text-center py-8">Chargement…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {brands.map(b => (
                <button key={b.id}
                  onClick={() => {
                    setForm(f => ({ ...f, brandName: b.name, modelName: '' }))
                    loadModels(b.id)
                  }}
                  className="w-full text-left px-5 py-4 rounded-2xl border border-[#2a2a2a] bg-[#1A1A1A] text-white font-medium hover:border-brand transition-all active:scale-95"
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
          {error && <ErrorBox message={error} />}
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────
  // STEP : VÉHICULE INCONNU — CHOISIR MODÈLE
  // ────────────────────────────────────────────────────────────
  if (step === 'vehicle_create' && form.brandName) return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <Header title="Quel est le modèle ?"
        backStep={undefined} />
      <div className="flex-1 px-4 py-6 flex flex-col gap-3 overflow-y-auto pb-10">
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3 mb-2 flex items-center justify-between">
          <div>
            <p className="text-zinc-400 text-xs mb-0.5">Marque sélectionnée</p>
            <p className="text-white font-bold">{form.brandName}</p>
          </div>
          <button onClick={() => setForm(f => ({ ...f, brandName: '', modelName: '' }))}
            className="text-zinc-500 hover:text-white text-sm">
            Changer
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {models.map(m => (
            <button key={m.id}
              onClick={() => {
                setForm(f => ({ ...f, modelName: m.name }))
                setError(null)
                setStep('details')
              }}
              className="w-full text-left px-5 py-4 rounded-2xl border border-[#2a2a2a] bg-[#1A1A1A] text-white font-medium hover:border-brand transition-all active:scale-95"
            >
              {m.name}
            </button>
          ))}
          {/* Modèle "Autre" avec saisie libre */}
          <div className="mt-2">
            <input
              type="text"
              placeholder="Autre modèle…"
              value={form.modelName.startsWith('_custom:') ? form.modelName.replace('_custom:', '') : ''}
              onChange={e => setForm(f => ({ ...f, modelName: `_custom:${e.target.value}` }))}
              className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl px-5 py-4
                         text-white placeholder-zinc-600 focus:outline-none focus:border-brand text-xl font-bold text-center"
            />
          </div>
        </div>

        {error && <ErrorBox message={error} />}

        <button
          onClick={() => {
            const modelVal = form.modelName.startsWith('_custom:')
              ? form.modelName.replace('_custom:', '').trim()
              : form.modelName.trim()
            if (!modelVal) { setError('Veuillez choisir ou saisir un modèle'); return }
            setForm(f => ({ ...f, modelName: modelVal }))
            setError(null)
            setStep('details')
          }}
          className="w-full py-4 bg-brand hover:bg-brand/90 text-white rounded-2xl font-bold text-lg mt-2"
        >
          Continuer →
        </button>
      </div>
    </div>
  )

  // ────────────────────────────────────────────────────────────
  // STEP : DETAILS
  // ────────────────────────────────────────────────────────────
  if (step === 'details') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <Header title="Détails de la facture"
        backStep={form.vehicleMatch ? 'vehicle_confirm' : 'vehicle_create'} />
      <div className="flex-1 px-4 py-6 flex flex-col gap-5 overflow-y-auto pb-10">

        {/* Recap véhicule */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-xl">🚗</span>
          <div>
            <p className="text-white font-mono font-bold">{normalizePlate(form.plate)}</p>
            {(form.vehicleMatch?.model || form.modelName) && (
              <p className="text-zinc-500 text-xs">
                {form.vehicleMatch?.model ?? `${form.brandName} ${form.modelName}`}
              </p>
            )}
          </div>
        </div>

        {/* Montant HTVA */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Montant HTVA *</label>
          <div className="relative">
            <input
              type="number" inputMode="decimal" step="0.01" min="0"
              placeholder="0.00" value={form.amountHtva}
              onChange={e => setForm(f => ({ ...f, amountHtva: e.target.value }))}
              className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3
                         text-white text-2xl font-semibold pr-14 placeholder-zinc-700
                         focus:outline-none focus:border-brand"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-lg font-medium">€</span>
          </div>
        </div>

        {/* Mode de paiement */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">Mode de paiement *</label>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map(pm => (
              <button key={pm.value}
                onClick={() => setForm(f => ({ ...f, paymentMethod: pm.value }))}
                className={`py-3 rounded-xl font-medium transition-all ${
                  form.paymentMethod === pm.value
                    ? 'bg-brand text-white ring-2 ring-brand/50'
                    : 'bg-[#1A1A1A] text-zinc-300 border border-[#2a2a2a] hover:border-zinc-500'
                }`}
              >
                {pm.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">
            Notes <span className="text-zinc-600">(optionnel)</span>
          </label>
          <textarea rows={2} placeholder="Nom du garage, remarques…"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-4 py-3
                       text-white placeholder-zinc-700 focus:outline-none focus:border-brand resize-none"
          />
        </div>

        {error && <ErrorBox message={error} />}

        <button
          onClick={() => {
            const err = validateDetails()
            if (err) { setError(err); return }
            setError(null)
            setStep('confirm')
          }}
          className="w-full py-4 bg-brand hover:bg-brand/90 text-white rounded-2xl font-bold text-lg"
        >
          Vérifier →
        </button>
      </div>
    </div>
  )

  // ────────────────────────────────────────────────────────────
  // STEP : CONFIRM
  // ────────────────────────────────────────────────────────────
  if (step === 'confirm') return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      <Header title="Confirmation" backStep="details" />
      <div className="flex-1 px-4 py-6 flex flex-col gap-4 overflow-y-auto pb-10">

        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
          {form.photoPreview && (
            <img src={form.photoPreview} alt="Facture"
              className="w-full max-h-56 object-cover border-b border-[#2a2a2a]" />
          )}
          <div className="p-4 space-y-3">
            <Row label="Immatriculation" value={normalizePlate(form.plate)} mono />
            {(form.vehicleMatch?.model || form.modelName) && (
              <Row label="Véhicule"
                value={form.vehicleMatch?.model ?? `${form.brandName} ${form.modelName}`} />
            )}
            <Row label="Montant HTVA" value={`${parseFloat(form.amountHtva).toFixed(2)} €`} />
            <Row label="Mode de paiement"
              value={PAYMENT_METHODS.find(p => p.value === form.paymentMethod)?.label ?? form.paymentMethod} />
            {form.notes && <Row label="Notes" value={form.notes} />}
          </div>
        </div>

        <div className="bg-blue-950/40 border border-blue-900 rounded-xl p-4 space-y-1.5">
          <p className="font-semibold text-blue-200 text-sm mb-2">Actions automatiques</p>
          <p className="text-blue-300 text-sm">✉️ Facture transmise au service comptable</p>
          <p className="text-blue-300 text-sm">📋 Ajout au dossier client du véhicule</p>
          <p className="text-blue-300 text-sm">💾 Enregistré dans l'application</p>
        </div>

        {error && <ErrorBox message={error} />}

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-4 bg-green-700 hover:bg-green-600 disabled:bg-zinc-800
                     disabled:text-zinc-600 text-white rounded-2xl font-bold text-lg transition-colors">
          {loading
            ? <span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Envoi…</span>
            : '✅ Confirmer et envoyer'
          }
        </button>
      </div>
    </div>
  )

  // ────────────────────────────────────────────────────────────
  // STEP : SUCCESS
  // ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col items-center justify-center max-w-md mx-auto p-6 text-center gap-7">
      <div className="text-8xl">✅</div>
      <div>
        <h2 className="text-2xl font-bold text-white">Avance enregistrée</h2>
        <p className="text-zinc-500 mt-2 text-sm max-w-xs mx-auto">
          La facture a été transmise au service comptable et le dossier véhicule mis à jour.
        </p>
      </div>

      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 w-full max-w-xs text-left space-y-3">
        <Row label="Plaque"   value={normalizePlate(form.plate)} mono />
        <Row label="Montant"  value={`${parseFloat(form.amountHtva).toFixed(2)} € HTVA`} />
        <Row label="Paiement" value={PAYMENT_METHODS.find(p => p.value === form.paymentMethod)?.label ?? form.paymentMethod} />
      </div>

      <div className="flex flex-col w-full max-w-xs gap-3">
        <button onClick={() => router.push('/dashboard')}
          className="w-full py-3 bg-brand hover:bg-brand/90 text-white rounded-xl font-semibold">
          Tableau de bord
        </button>
        <button onClick={() => { setForm(EMPTY_FORM); setError(null); setStep('photo') }}
          className="w-full py-3 bg-[#1A1A1A] border border-[#2a2a2a] text-zinc-300 rounded-xl font-medium">
          Nouvelle avance
        </button>
      </div>
    </div>
  )
}

// ── Utilitaires ───────────────────────────────────────────────
function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-zinc-500 text-sm flex-shrink-0">{label}</span>
      <span className={`text-white text-sm text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
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
