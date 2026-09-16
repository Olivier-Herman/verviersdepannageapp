'use client'

import { useState } from 'react'

/**
 * Bouton "Annuler la fiche" + modal de motif.
 * Passe la fiche en status='cancelled' (invisible dans l'app, conservée en base).
 * Disponible Dispatch / Facturation / Fourrière (gating côté API).
 */
export default function CancelMissionButton({
  missionId,
  onCancelled,
  className = '',
  label = '🚫 Annuler la fiche',
}: {
  missionId:    string
  onCancelled?: () => void
  className?:   string
  label?:       string
}) {
  const [open,    setOpen]    = useState(false)
  const [reason,  setReason]  = useState('')
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  // Groupes encore vivants dans le dossier (hors celui-ci) : s'il y en a, on
  // demande si on annule tout le dossier ou seulement cette action.
  // Olivier 16/09/2026.
  const [others,  setOthers]  = useState<number | null>(null)
  const [scope,   setScope]   = useState<'leg' | 'dossier'>('leg')

  const loadOthers = async () => {
    setOthers(null)
    try {
      const r = await fetch(`/api/dossier/${missionId}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      const legs: any[] = j?.dossier?.legs || []
      const alive = legs.filter(l => l.mission_id !== missionId && l.status !== 'cancelled' && !l.nothing_to_bill && !(l.billed_refs || []).length)
      setOthers(alive.length)
    } catch { setOthers(0) }
  }

  const submit = async () => {
    const r = reason.trim()
    if (!r) { setErr('Motif obligatoire.'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/missions/${missionId}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: r, scope }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(data.error || 'Échec de l\'annulation.'); setBusy(false); return }
      setOpen(false)
      onCancelled?.()
    } catch {
      setErr('Erreur réseau.'); setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setErr(''); setReason(''); setScope('leg'); loadOthers() }}
        className={className || 'w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-sm transition'}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-surface w-full max-w-md rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-ink font-bold text-lg">Annuler la fiche</h3>
              <p className="text-ink-muted text-sm mt-1">
                La fiche sera masquée de l&apos;app mais conservée en base. Indiquez le motif.
              </p>
            </div>

            {others != null && others > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setScope('leg')}
                  className={`py-3 rounded-xl text-sm font-semibold border transition ${scope === 'leg' ? 'bg-red-600 text-white border-red-600' : 'bg-surface-2 text-ink border'}`}>
                  Uniquement cette action
                </button>
                <button type="button" onClick={() => setScope('dossier')}
                  className={`py-3 rounded-xl text-sm font-semibold border transition ${scope === 'dossier' ? 'bg-red-600 text-white border-red-600' : 'bg-surface-2 text-ink border'}`}>
                  Tout le dossier ({others + 1} groupes)
                </button>
              </div>
            )}
            {others === null && <p className="text-ink-faint text-xs">Lecture du dossier…</p>}

            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              autoFocus
              rows={3}
              placeholder="Motif de l'annulation…"
              className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-red-500"
            />

            {err && <p className="text-red-400 text-sm">{err}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 py-2.5 bg-surface-hover text-ink-secondary rounded-xl text-sm font-medium disabled:opacity-50"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !reason.trim()}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Annulation…' : scope === 'dossier' ? 'Annuler tout le dossier' : 'Confirmer l\'annulation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
