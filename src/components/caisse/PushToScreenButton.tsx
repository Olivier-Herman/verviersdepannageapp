'use client'

// Bouton « 📺 Afficher au client » — pousse un montant (+ véhicule/client + 2 QR)
// sur l'écran client du bureau (tablette kiosque /caisse/ecran/facturation).
// Réutilisable : fiches Facturation, fiche mission détail, etc. Olivier 2026-07-28.

import { useState } from 'react'

export interface PushToScreenParams {
  amount: number
  client?: string | null
  plate?: string | null
  brand?: string | null
  model?: string | null
  reference?: string | null
  lines?: { label: string; amount: number }[]
}

export default function PushToScreenButton({
  screenKey = 'facturation',
  className = '',
  compact = false,
  ...params
}: PushToScreenParams & { screenKey?: string; className?: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [err, setErr] = useState('')

  const amt = Number(params.amount)
  const disabled = state === 'busy' || !amt || amt <= 0

  const push = async (force = false) => {
    if (!amt || amt <= 0) { setErr('Montant à payer indisponible sur cette fiche.'); return }
    setState('busy'); setErr('')
    try {
      const res = await fetch('/api/caisse/ecran', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push', key: screenKey, force, ...params, amount: amt }),
      })
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}))
        const occ = j.occupant || {}
        setState('idle')
        if (confirm(`L'écran affiche déjà ${occ.client || ''}${occ.plate ? ' (' + occ.plate + ')' : ''}. Le remplacer ?`)) await push(true)
        return
      }
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || 'Écran client indisponible'); setState('idle'); return }
      setState('done'); setTimeout(() => setState('idle'), 3000)
    } catch { setErr('Erreur réseau (écran client)'); setState('idle') }
  }

  const base = compact
    ? 'px-3 py-1.5 rounded-lg text-xs font-bold'
    : 'w-full py-3 rounded-2xl text-sm font-bold'

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => push(false)}
        disabled={disabled}
        title="Afficher le montant + les QR de paiement sur l'écran client du comptoir"
        className={`${base} transition disabled:opacity-40 ${
          state === 'done' ? 'bg-success text-white' : 'bg-surface-2 hover:bg-surface-hover border text-ink'
        }`}>
        {state === 'busy' ? '📺 Envoi…' : state === 'done' ? '✅ Affiché' : '📺 Afficher au client'}
      </button>
      {err && <div className="text-danger text-xs mt-1">{err}</div>}
    </div>
  )
}
