'use client'

import { useState, useRef } from 'react'
import { useRouter }         from 'next/navigation'
import Link                  from 'next/link'
import AppShell              from '@/components/layout/AppShell'
import { formatEur }         from '@/lib/format'
import { normalizePlate }    from '@/lib/plate'

type Step = 'photo' | 'details' | 'driver' | 'confirm' | 'success'

interface DriverCandidate {
  driver_id:    string
  driver_name:  string
  mission_id:   string
  mission_ref:  string
  match_score:  number
  match_reason: string
  on_way_at:    string | null
  completed_at: string | null
}

interface SuggestResult {
  driver_id:   string | null
  driver_name: string | null
  mission_id:  string | null
  confidence:  'high' | 'medium' | 'low' | 'none'
  candidates:  DriverCandidate[]
}

interface FormState {
  photoFile:        File | null
  photoPreview:     string | null
  photoUrl:         string | null   // URL signed apres upload
  infractionDate:   string          // YYYY-MM-DDTHH:mm (datetime-local)
  plate:            string
  amount:           string
  infractionPlace:  string
  infractionType:   string
  infractionRef:    string
  notes:            string
  // Match chauffeur
  suggestion:       SuggestResult | null
  selectedDriverId: string | null
  selectedMissionId: string | null
  manualPick:       boolean          // chauffeur choisi manuellement dans la liste complète
}

const EMPTY_FORM: FormState = {
  photoFile: null, photoPreview: null, photoUrl: null,
  infractionDate: '', plate: '', amount: '',
  infractionPlace: '', infractionType: '', infractionRef: '', notes: '',
  suggestion: null, selectedDriverId: null, selectedMissionId: null, manualPick: false,
}

const INFRACTION_TYPES = [
  { value: '',           label: '— Type d infraction (optionnel) —' },
  { value: 'speeding',   label: '🚓 Excès de vitesse' },
  { value: 'parking',    label: '🅿️ Stationnement' },
  { value: 'red_light',  label: '🚦 Feu rouge' },
  { value: 'priority',   label: '⚠️ Priorité' },
  { value: 'phone',      label: '📱 Téléphone au volant' },
  { value: 'belt',       label: '🔓 Ceinture' },
  { value: 'other',      label: '📝 Autre' },
]

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-ink-muted text-sm flex-shrink-0">{label}</span>
      <span className={`text-ink text-sm text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export default function AmendesClient({ user, drivers = [] }: { user: any; drivers?: { id: string; name: string }[] }) {
  const router    = useRouter()
  const fileRef   = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const userRole    = user?.role ?? 'admin'
  const userName    = user?.name ?? ''
  const userModules = (user?.modules ?? []) as string[]

  const [step,    setStep]    = useState<Step>('photo')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [form,    setForm]    = useState<FormState>(EMPTY_FORM)
  const [createdId, setCreatedId] = useState<string | null>(null)

  function goBack(s: Step) { setError(null); setStep(s) }

  // ── Photo ────────────────────────────────────────────────
  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setForm(f => ({ ...f, photoFile: file, photoPreview: URL.createObjectURL(file) }))
    // Pre-rempli la date avec maintenant pour gagner du temps
    if (!form.infractionDate) {
      const now = new Date()
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 16)
      setForm(f => ({ ...f, infractionDate: local }))
    }
    setStep('details')
  }

  async function uploadPhoto(file: File): Promise<string> {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve((reader.result as string).split(',')[1] || '')
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const res = await fetch('/api/fines/upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        base64,
        mimeType: file.type || 'image/jpeg',
        filename: file.name || 'pv.jpg',
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload echec')
    return data.url
  }

  // ── Validation des details ───────────────────────────────
  function validateDetails(): string | null {
    if (!form.infractionDate)        return 'Date + heure de l infraction requise'
    if (!form.plate.trim())          return 'Plaque requise'
    if (!form.amount)                return 'Montant requis'
    if (parseFloat(form.amount.replace(',', '.')) <= 0) return 'Montant doit être > 0'
    return null
  }

  // ── Charge la suggestion chauffeur ───────────────────────
  async function loadSuggestion() {
    if (!form.plate || !form.infractionDate) return
    setLoading(true); setError(null)
    try {
      const dateIso = new Date(form.infractionDate).toISOString()
      const res = await fetch(`/api/fines/suggest-driver?plate=${encodeURIComponent(form.plate)}&date=${encodeURIComponent(dateIso)}`)
      const data: SuggestResult = await res.json()
      if (!res.ok) throw new Error((data as any).error || 'Erreur suggestion')
      setForm(f => ({
        ...f,
        suggestion:        data,
        selectedDriverId:  data.driver_id,
        selectedMissionId: data.mission_id,
      }))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Submit final ─────────────────────────────────────────
  async function submitFine() {
    if (!form.photoFile && !form.photoUrl) { setError('Photo requise'); return }
    setLoading(true); setError(null)
    try {
      let photoUrl = form.photoUrl
      if (!photoUrl && form.photoFile) {
        photoUrl = await uploadPhoto(form.photoFile)
      }
      const res = await fetch('/api/fines', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          photo_url:         photoUrl,
          infraction_date:   new Date(form.infractionDate).toISOString(),
          plate:             normalizePlate(form.plate),
          amount:            parseFloat(form.amount.replace(',', '.')),
          infraction_place:  form.infractionPlace || undefined,
          infraction_type:   form.infractionType || undefined,
          infraction_ref:    form.infractionRef || undefined,
          driver_id:         form.selectedDriverId,
          mission_id:        form.selectedMissionId,
          override_match:    !!form.selectedDriverId && (form.manualPick || form.selectedDriverId !== form.suggestion?.driver_id),
          notes:             form.notes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setCreatedId(data.fine?.id || null)
      setStep('success')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── STEP : PHOTO ─────────────────────────────────────────
  if (step === 'photo') return (
    <AppShell title="Amendes" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 gap-8 max-w-md mx-auto">
        <div className="text-center">
          <div className="text-6xl mb-3">📄</div>
          <p className="text-ink font-semibold text-lg">Photographiez le PV</p>
          <p className="text-ink-muted text-sm mt-1">Photo du procès-verbal reçu</p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <button onClick={() => cameraRef.current?.click()}
            className="w-full py-5 bg-brand hover:bg-brand/90 text-ink rounded-2xl font-semibold text-lg flex items-center justify-center gap-3">
            <span className="text-2xl">📷</span> Prendre une photo
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="w-full py-4 bg-surface border border text-ink-secondary rounded-2xl text-sm">
            📁 Choisir depuis la galerie
          </button>
          <Link href="/admin/amendes"
            className="w-full py-3 text-center text-ink-muted text-sm hover:text-ink">
            → Voir toutes les amendes
          </Link>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
        <input ref={fileRef}   type="file" accept="image/*,application/pdf"        onChange={handlePhoto} className="hidden" />
      </div>
    </AppShell>
  )

  // ── STEP : DETAILS ───────────────────────────────────────
  if (step === 'details') return (
    <AppShell title="Détails du PV" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-md mx-auto p-4 space-y-4">
        <button onClick={() => goBack('photo')} className="text-ink-secondary text-sm">← Retour photo</button>

        {form.photoPreview && (
          <div className="bg-surface border rounded-2xl p-2">
            <img src={form.photoPreview} alt="PV" className="w-full max-h-48 object-contain rounded-xl" />
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Date + heure de l infraction *</label>
            <input type="datetime-local"
              value={form.infractionDate}
              onChange={e => setForm(f => ({ ...f, infractionDate: e.target.value }))}
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-sm" />
          </div>

          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Plaque de la dépanneuse VD *</label>
            <input type="text" inputMode="text"
              value={form.plate}
              onChange={e => setForm(f => ({ ...f, plate: e.target.value.toUpperCase() }))}
              placeholder="Ex: 1ABC234"
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-sm font-mono uppercase" />
            <p className="text-ink-faint text-[11px] mt-1">Plaque du camion VD au moment du PV (pas du véhicule client remorqué).</p>
          </div>

          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Montant (€) *</label>
            <input type="number" inputMode="decimal" step="0.01" min="0"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="Ex: 174"
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-sm" />
          </div>

          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Type d infraction</label>
            <select
              value={form.infractionType}
              onChange={e => setForm(f => ({ ...f, infractionType: e.target.value }))}
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-sm">
              {INFRACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Lieu (optionnel)</label>
            <input type="text"
              value={form.infractionPlace}
              onChange={e => setForm(f => ({ ...f, infractionPlace: e.target.value }))}
              placeholder="Ex: Rue de Verviers à Liège"
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-sm" />
          </div>

          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">N° PV (optionnel)</label>
            <input type="text"
              value={form.infractionRef}
              onChange={e => setForm(f => ({ ...f, infractionRef: e.target.value }))}
              placeholder="Référence du PV"
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-sm font-mono" />
          </div>

          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Notes (optionnel)</label>
            <textarea rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Infos complémentaires..."
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-sm resize-none" />
          </div>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        <button onClick={async () => {
          const v = validateDetails()
          if (v) { setError(v); return }
          setError(null)
          setStep('driver')
          await loadSuggestion()
        }} className="w-full py-4 bg-brand text-ink rounded-2xl font-semibold">
          Identifier le chauffeur →
        </button>
      </div>
    </AppShell>
  )

  // ── STEP : DRIVER (suggestion + correction) ──────────────
  if (step === 'driver') return (
    <AppShell title="Chauffeur au volant" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-md mx-auto p-4 space-y-4">
        <button onClick={() => goBack('details')} className="text-ink-secondary text-sm">← Retour détails</button>

        <div className="bg-surface border rounded-2xl p-4 space-y-2">
          <p className="text-ink-muted text-xs uppercase tracking-wider font-medium">Infraction</p>
          <Row label="Plaque" value={normalizePlate(form.plate)} mono />
          <Row label="Date" value={new Date(form.infractionDate).toLocaleString('fr-BE')} />
          <Row label="Montant" value={formatEur(parseFloat(form.amount.replace(',', '.')))} />
        </div>

        {loading && <p className="text-ink-faint text-sm text-center py-4">Recherche du chauffeur...</p>}

        {!loading && form.suggestion && (
          <>
            {form.suggestion.candidates.length === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 text-center">
                <p className="text-amber-900 font-semibold">⚠️ Aucun chauffeur trouvé automatiquement</p>
                <p className="text-amber-700 text-xs mt-1">
                  Aucune mission VD avec cette dépanneuse autour de cette date. Vérifie la plaque saisie (doit être celle de la <strong>dépanneuse VD</strong>, pas du véhicule remorqué) ou choisis <strong>Indéterminé</strong> ci-dessous.
                </p>
                <button onClick={() => setForm(f => ({ ...f, selectedDriverId: null, selectedMissionId: null, manualPick: false }))}
                  className={`mt-3 w-full p-3 rounded-xl border-2 transition ${
                    form.selectedDriverId === null ? 'border-amber-600 bg-amber-100' : 'border-amber-300 bg-white hover:bg-amber-100'
                  }`}>
                  <span className="text-amber-900 font-bold text-sm">❓ Indéterminé</span>
                  <p className="text-amber-700 text-[11px] mt-0.5">À attribuer plus tard manuellement depuis /admin/amendes</p>
                </button>
              </div>
            ) : (
              <>
                <p className="text-ink-secondary text-xs uppercase tracking-wider font-medium">Candidats trouvés (clique pour sélectionner)</p>
                <div className="space-y-2">
                  {form.suggestion.candidates.map((c, idx) => {
                    const isSelected = c.driver_id === form.selectedDriverId && c.mission_id === form.selectedMissionId
                    const confLabel = c.match_score >= 80 ? '🟢 Très probable' : c.match_score >= 50 ? '🟡 Probable' : '🟠 Possible'
                    return (
                      <button key={`${c.driver_id}-${c.mission_id}-${idx}`}
                        onClick={() => setForm(f => ({ ...f, selectedDriverId: c.driver_id, selectedMissionId: c.mission_id, manualPick: false }))}
                        className={`w-full text-left p-3 rounded-2xl border-2 transition ${
                          isSelected ? 'border-brand bg-brand/10' : 'border bg-surface hover:border-zinc-600'
                        }`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-ink font-semibold text-sm">{c.driver_name}</span>
                          <span className="text-xs">{confLabel}</span>
                        </div>
                        <p className="text-ink-muted text-xs">Mission {c.mission_ref}</p>
                        <p className="text-ink-faint text-[11px] italic mt-0.5">{c.match_reason}</p>
                      </button>
                    )
                  })}

                  <button onClick={() => setForm(f => ({ ...f, selectedDriverId: null, selectedMissionId: null, manualPick: false }))}
                    className={`w-full text-left p-3 rounded-2xl border-2 transition ${
                      form.selectedDriverId === null ? 'border-amber-500 bg-amber-50' : 'border bg-surface hover:border-amber-400'
                    }`}>
                    <span className={`text-sm font-semibold ${form.selectedDriverId === null ? 'text-amber-900' : 'text-amber-700'}`}>❓ Indéterminé</span>
                    <p className="text-amber-700 text-[11px] mt-0.5">Aucun chauffeur sélectionné. L amende sera enregistrée sans attribution, à compléter plus tard manuellement.</p>
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {!loading && drivers.length > 0 && (
          <div className="bg-surface border rounded-2xl p-4 space-y-2">
            <p className="text-ink-secondary text-xs uppercase tracking-wider font-medium">Ou attribue manuellement un chauffeur</p>
            <select
              value={form.manualPick ? (form.selectedDriverId || '') : ''}
              onChange={e => {
                const id = e.target.value || null
                setForm(f => ({ ...f, selectedDriverId: id, selectedMissionId: null, manualPick: !!id }))
              }}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-ink">
              <option value="">— Choisir un chauffeur —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {form.manualPick && <p className="text-brand text-xs">✓ Chauffeur attribué manuellement (hors correspondance auto).</p>}
          </div>
        )}

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        <button onClick={() => setStep('confirm')}
          disabled={loading}
          className="w-full py-4 bg-brand text-ink rounded-2xl font-semibold disabled:opacity-50">
          Continuer →
        </button>
      </div>
    </AppShell>
  )

  // ── STEP : CONFIRM ───────────────────────────────────────
  if (step === 'confirm') {
    const selectedCand = form.suggestion?.candidates.find(c => c.driver_id === form.selectedDriverId && c.mission_id === form.selectedMissionId)
    return (
      <AppShell title="Confirmation" userRole={userRole} userName={userName} userModules={userModules}>
        <div className="max-w-md mx-auto p-4 space-y-4">
          <button onClick={() => goBack('driver')} className="text-ink-secondary text-sm">← Retour chauffeur</button>

          <div className="bg-surface border rounded-2xl p-4 space-y-2">
            <p className="text-ink-muted text-xs uppercase tracking-wider font-medium mb-2">Récapitulatif</p>
            <Row label="Plaque" value={normalizePlate(form.plate)} mono />
            <Row label="Date infraction" value={new Date(form.infractionDate).toLocaleString('fr-BE')} />
            <Row label="Montant" value={formatEur(parseFloat(form.amount.replace(',', '.')))} />
            {form.infractionType && <Row label="Type" value={INFRACTION_TYPES.find(t => t.value === form.infractionType)?.label || form.infractionType} />}
            {form.infractionPlace && <Row label="Lieu" value={form.infractionPlace} />}
            {form.infractionRef && <Row label="N° PV" value={form.infractionRef} mono />}
            <div className="border-t border pt-2 mt-2">
              <Row label="Chauffeur" value={selectedCand?.driver_name || (form.selectedDriverId ? (drivers.find(d => d.id === form.selectedDriverId)?.name || 'sélectionné') : '— non identifié —')} />
              {selectedCand && <Row label="Mission" value={selectedCand.mission_ref} />}
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-800 text-xs">
            📧 À la confirmation, le PV sera envoyé par email à la boîte achats (encodage compta) et enregistré dans VD Soft pour les stats par chauffeur.
          </div>

          {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

          <button onClick={submitFine}
            disabled={loading}
            className="w-full py-4 bg-brand text-ink rounded-2xl font-semibold disabled:opacity-50">
            {loading ? '⏳ Envoi...' : '✓ Confirmer et envoyer'}
          </button>
        </div>
      </AppShell>
    )
  }

  // ── STEP : SUCCESS ───────────────────────────────────────
  return (
    <AppShell title="PV enregistré" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 gap-6 max-w-md mx-auto">
        <div className="text-center">
          <div className="text-6xl mb-3">✅</div>
          <h2 className="text-2xl font-bold text-ink">PV enregistré</h2>
          <p className="text-ink-muted mt-2 text-sm max-w-xs mx-auto">
            Envoyé par email à la comptabilité et stocké pour les statistiques chauffeur.
          </p>
        </div>
        <div className="flex flex-col w-full max-w-xs gap-3">
          <button onClick={() => router.push('/admin/amendes')}
            className="w-full py-3 bg-brand text-ink rounded-xl font-semibold">
            Voir toutes les amendes
          </button>
          <button onClick={() => { setForm(EMPTY_FORM); setError(null); setCreatedId(null); setStep('photo') }}
            className="w-full py-3 bg-surface border text-ink-secondary rounded-xl font-medium">
            Nouveau PV
          </button>
        </div>
      </div>
    </AppShell>
  )
}
