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

  const submit = async () => {
    const r = reason.trim()
    if (!r) { setErr('Motif obligatoire.'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/missions/${missionId}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: r }),
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
        onClick={() => { setOpen(true); setErr(''); setReason('') }}
        className={className || 'w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-sm transition'}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-surface w-full max-w-md rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-ink font-bold text-lg">Annuler la fiche</h3>
              <p className="text-ink-muted text-sm mt-1">
                La fiche sera masquée de l&apos;app mais conservée en base. Indiquez le motif.
              </p>
            </div>

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
                {busy ? 'Annulation…' : 'Confirmer l\'annulation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
