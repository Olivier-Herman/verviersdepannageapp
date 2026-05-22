'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, Truck, AlertTriangle, ArrowRight, Building2, Trash2 } from 'lucide-react'

interface Mission {
  id:             string
  external_id:    string | null
  dossier_number: string | null
  vehicle_plate:  string | null
  vehicle_brand:  string | null
  vehicle_model:  string | null
  client_name:    string | null
}

interface Props {
  mission:   Mission
  onClose:   () => void
  onSuccess: (action: 'rel' | 'abandoned' | 'assistance', result: any) => void
}

type Action = 'rel' | 'abandoned' | 'assistance'

export default function GererSncDepotModal({ mission, onClose, onSuccess }: Props) {
  const [action, setAction]     = useState<Action | null>(null)
  // Champs REL
  const [relAddress, setRelAddress] = useState('')
  // Champs Repris par assistance
  const [assistanceName, setAssistanceName] = useState('')
  const [assistanceDossier, setAssistanceDossier] = useState('')
  // Champs Abandonne
  const [abandonReason, setAbandonReason] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit() {
    if (!action) return
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch(`/api/missions/${mission.id}/snc-gerer-depot`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action,
          rel_address:        relAddress.trim() || null,
          assistance_name:    assistanceName.trim() || null,
          assistance_dossier: assistanceDossier.trim() || null,
          abandon_reason:     abandonReason.trim() || null,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      onSuccess(action, j)
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = (() => {
    if (!action) return false
    if (action === 'rel') return relAddress.trim().length > 3
    if (action === 'abandoned') return abandonReason.trim().length > 0
    if (action === 'assistance') return assistanceName.trim().length > 0
    return false
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h2 className="text-ink font-bold">Gérer la mise en dépôt SNC</h2>
            <p className="text-ink-muted text-xs mt-0.5">
              {mission.vehicle_plate} {mission.vehicle_brand} {mission.vehicle_model}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-hover rounded-lg text-ink-muted hover:text-ink transition">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Step 1 : choix action */}
          <div className="space-y-2">
            <label className="text-ink text-sm font-medium">Quel est le suivi du véhicule ?</label>
            <div className="space-y-2">
              <button
                onClick={() => setAction('rel')}
                className={`w-full p-3 rounded-xl border text-left transition ${
                  action === 'rel'
                    ? 'bg-brand/15 border-brand ring-2 ring-brand/40'
                    : 'bg-surface-2 border-ink/15 hover:border-brand'
                }`}>
                <div className="flex items-center gap-2 text-ink font-medium text-sm">
                  <Truck size={16} className="text-brand" />
                  Créer une relivraison (REL)
                </div>
                <div className="text-ink-muted text-xs mt-1">
                  Le client a payé et demande la livraison du véhicule à une adresse.
                </div>
              </button>
              <button
                onClick={() => setAction('assistance')}
                className={`w-full p-3 rounded-xl border text-left transition ${
                  action === 'assistance'
                    ? 'bg-info/15 border-info ring-2 ring-info/40'
                    : 'bg-surface-2 border-ink/15 hover:border-info'
                }`}>
                <div className="flex items-center gap-2 text-ink font-medium text-sm">
                  <Building2 size={16} className="text-info" />
                  Repris par une assistance
                </div>
                <div className="text-ink-muted text-xs mt-1">
                  Une assurance / assistance prend en charge la suite (Touring, VAB, IMA, etc.).
                </div>
              </button>
              <button
                onClick={() => setAction('abandoned')}
                className={`w-full p-3 rounded-xl border text-left transition ${
                  action === 'abandoned'
                    ? 'bg-critical/15 border-critical ring-2 ring-critical/40'
                    : 'bg-surface-2 border-ink/15 hover:border-critical'
                }`}>
                <div className="flex items-center gap-2 text-ink font-medium text-sm">
                  <Trash2 size={16} className="text-critical" />
                  Véhicule abandonné par le client
                </div>
                <div className="text-ink-muted text-xs mt-1">
                  Le client n&apos;a pas réclamé son véhicule. Sortie du parc, dossier clôturé.
                </div>
              </button>
            </div>
          </div>

          {/* Step 2 : champs selon action */}
          {action === 'rel' && (
            <div className="space-y-2 bg-surface-2 border rounded-xl p-3">
              <label className="text-ink text-sm font-medium">Adresse de livraison</label>
              <input
                value={relAddress}
                onChange={e => setRelAddress(e.target.value)}
                placeholder="Ex: Rue de la Gare 10, 4800 Verviers"
                className="w-full px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-brand"
              />
              <p className="text-xs text-ink-muted">
                Une mission REL sera créée automatiquement avec cette adresse. Le devis SNC restera lié.
              </p>
            </div>
          )}

          {action === 'assistance' && (
            <div className="space-y-2 bg-surface-2 border rounded-xl p-3">
              <label className="text-ink text-sm font-medium">Assistance / assurance reprenant</label>
              <input
                value={assistanceName}
                onChange={e => setAssistanceName(e.target.value)}
                placeholder="Ex: Touring, VAB, IMA, AXA..."
                className="w-full px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-info"
              />
              <label className="text-ink text-sm font-medium mt-2 block">N° dossier assistance (optionnel)</label>
              <input
                value={assistanceDossier}
                onChange={e => setAssistanceDossier(e.target.value)}
                placeholder="Ex: B12345678"
                className="w-full px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-info"
              />
              <p className="text-xs text-ink-muted">
                La mission SNC restera facturable au client. L&apos;assistance ne reprend que le transport ultérieur.
              </p>
            </div>
          )}

          {action === 'abandoned' && (
            <div className="space-y-2 bg-surface-2 border rounded-xl p-3">
              <label className="text-ink text-sm font-medium">Motif d&apos;abandon</label>
              <textarea
                value={abandonReason}
                onChange={e => setAbandonReason(e.target.value)}
                placeholder="Ex: Pas de réponse client après plusieurs relances..."
                rows={3}
                className="w-full px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-critical"
              />
              <p className="text-xs text-ink-muted bg-warning/10 border border-warning/30 rounded p-2 mt-2">
                ⚠ Le véhicule sort du parc. Le devis SNC reste à facturer (ou no-charge selon ta décision).
              </p>
            </div>
          )}

          {err && (
            <div className="bg-critical/10 border border-critical/40 rounded-lg p-3 text-critical text-sm">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose}
            className="px-4 py-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-sm transition">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-medium rounded-lg text-sm transition flex items-center gap-2">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            Valider
          </button>
        </div>

      </div>
    </div>
  )
}
