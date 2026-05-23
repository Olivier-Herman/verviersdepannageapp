'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, Truck, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Mission {
  id:                 string
  external_id:        string | null
  dossier_number:     string | null
  source:             string | null
  mission_type:       string | null
  status:             string
  vehicle_plate:      string | null
  vehicle_brand:      string | null
  vehicle_model:      string | null
  client_name:        string | null
  billed_to_name:     string | null
  destination_address: string | null
  destination_city:    string | null
}

interface ExistingRel {
  id:           string
  external_id:  string | null
  status:       string
  assigned_to:  string | null
  assigneeName: string | null
}

interface CurrentUser {
  id:        string
  name:      string
  isDriver:  boolean
}

export default function QrMissionClient({
  mission, existingRel, currentUser, consultUrl, isElligibleForRel,
}: {
  mission:            Mission
  existingRel:        ExistingRel | null
  currentUser:        CurrentUser
  consultUrl:         string
  isElligibleForRel:  boolean
}) {
  const router = useRouter()
  const [working,      setWorking]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [confirmingReassign, setConfirmingReassign] = useState(false)

  const brandModel = [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')
  const address    = [mission.destination_address, mission.destination_city].filter(Boolean).join(', ')

  // Bouton "Relivrer" disponible si :
  // - Mission eligible (parked + REM+REL ou Siabis rem_depot)
  // - L utilisateur est driver
  const canRelivrer = isElligibleForRel && currentUser.isDriver

  // Existing REL deja prise par quelqu un d autre que le scanneur
  const existingTakenByOther = existingRel?.assigned_to
                            && existingRel.assigned_to !== currentUser.id

  async function doRelivrer(confirmReassign: boolean = false) {
    setWorking(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${mission.id}/qr-rel-action`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ confirm_reassign: confirmReassign }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        if (j.needs_confirm) {
          // REL deja assignee a quelqu un d autre, on demande confirmation
          setConfirmingReassign(true)
          setWorking(false)
          return
        }
        throw new Error(j.error || 'Erreur')
      }
      // Redirect vers la fiche de la REL fille
      router.push(j.redirect_url || `/mission/${j.mission_id}`)
    } catch (e: any) {
      setError(e.message)
      setWorking(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-page py-6 px-4 safe-top safe-bottom">
      <div className="max-w-md mx-auto space-y-4">

        {/* Header */}
        <header className="text-center pb-2">
          <p className="text-ink-muted text-xs uppercase tracking-widest font-semibold">Scan étiquette</p>
          <h1 className="text-ink text-2xl font-bold mt-1">Véhicule en parc</h1>
        </header>

        {/* Carte véhicule */}
        <div className="bg-surface border rounded-2xl p-5 space-y-3">
          <div>
            <p className="text-ink-muted text-xs uppercase tracking-wider">Plaque</p>
            <p className="text-ink text-3xl font-bold font-mono tracking-wide mt-0.5">
              {mission.vehicle_plate || '—'}
            </p>
            {brandModel && (
              <p className="text-ink-secondary text-sm mt-0.5">{brandModel}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t">
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-wider">Assistance</p>
              <p className="text-ink font-medium mt-0.5 truncate">{mission.billed_to_name || '—'}</p>
            </div>
            <div>
              <p className="text-ink-muted text-xs uppercase tracking-wider">Mission</p>
              <p className="text-ink font-medium mt-0.5">
                {mission.external_id || mission.dossier_number || mission.id.slice(0, 8)}
              </p>
            </div>
          </div>

          {address && (
            <div className="pt-2 border-t">
              <p className="text-ink-muted text-xs uppercase tracking-wider">Relivraison</p>
              <p className="text-ink mt-0.5 leading-tight">{address}</p>
            </div>
          )}
        </div>

        {/* Si une REL existe déjà */}
        {existingRel && (
          <div className={`rounded-2xl p-4 flex gap-3 ${
            existingTakenByOther
              ? 'bg-amber-500/10 border border-amber-500/30'
              : 'bg-success-soft border border-success/30'
          }`}>
            {existingTakenByOther
              ? <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
              : <CheckCircle2  className="text-success    flex-shrink-0 mt-0.5" size={18} />}
            <div className="flex-1">
              {existingTakenByOther ? (
                <>
                  <p className="font-semibold text-ink text-sm">REL déjà assignée</p>
                  <p className="text-ink-muted text-xs mt-1">
                    {existingRel.assigneeName || 'Un autre chauffeur'} a déjà pris cette relivraison ({existingRel.external_id}). Tu peux la lui prendre si tu prends le relais.
                  </p>
                </>
              ) : existingRel.assigned_to === currentUser.id ? (
                <>
                  <p className="font-semibold text-ink text-sm">Tu es assigné à cette REL</p>
                  <p className="text-ink-muted text-xs mt-1">
                    Continue vers la fiche pour démarrer.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-ink text-sm">REL créée, en attente d'assignation</p>
                  <p className="text-ink-muted text-xs mt-1">
                    Tu peux la prendre maintenant.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-critical-soft border border-critical rounded-2xl p-3 text-critical text-sm">
            ⚠ {error}
          </div>
        )}

        {/* Confirmation réassignation */}
        {confirmingReassign && (
          <div className="bg-amber-500/10 border-2 border-amber-500/50 rounded-2xl p-4">
            <p className="font-semibold text-ink text-sm mb-2">⚠️ Reprendre la REL ?</p>
            <p className="text-ink-muted text-xs mb-3">
              {existingRel?.assigneeName || 'Un autre chauffeur'} est actuellement assigné(e). Confirme pour t'assigner à la place.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingReassign(false)} disabled={working}
                className="flex-1 py-2 bg-surface border text-ink-secondary rounded-xl text-sm font-medium hover:bg-surface-hover transition">
                Annuler
              </button>
              <button onClick={() => doRelivrer(true)} disabled={working}
                className="flex-1 py-2 bg-amber-500 hover:opacity-90 text-white rounded-xl text-sm font-bold transition">
                {working ? '...' : 'Oui, prendre'}
              </button>
            </div>
          </div>
        )}

        {/* Actions principales */}
        {!confirmingReassign && (
          <div className="space-y-3 pt-2">
            {canRelivrer && (
              <button onClick={() => doRelivrer(false)} disabled={working}
                className="w-full py-4 bg-brand hover:opacity-90 text-white rounded-2xl text-base font-bold transition disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-brand/20">
                {working
                  ? <><Loader2 size={20} className="animate-spin" /> Création...</>
                  : <><Truck size={20} /> Relivrer ce véhicule</>}
              </button>
            )}

            <Link href={consultUrl}
              className="w-full py-3 bg-surface border-2 text-ink hover:bg-surface-hover rounded-2xl text-base font-medium transition flex items-center justify-center gap-2">
              <Eye size={18} />
              Consulter le dossier
            </Link>

            {!isElligibleForRel && (
              <p className="text-ink-muted text-xs text-center mt-2 italic">
                Cette mission n'est pas en attente de relivraison (statut : {mission.status})
              </p>
            )}
            {isElligibleForRel && !currentUser.isDriver && (
              <p className="text-ink-muted text-xs text-center mt-2 italic">
                Seul un chauffeur peut prendre une relivraison via scan QR.
              </p>
            )}
          </div>
        )}

        <div className="text-center pt-4">
          <p className="text-ink-faint text-xs">
            Connecté en tant que <span className="font-medium">{currentUser.name}</span>
          </p>
        </div>

      </div>
    </div>
  )
}
