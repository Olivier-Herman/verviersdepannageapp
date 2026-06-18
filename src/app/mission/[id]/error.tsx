'use client'

// Error boundary de la fiche mission chauffeur (Olivier 2026-06-18).
// Remplace le générique anglais "Application error: a client-side exception"
// par un message clair en français + bouton recharger. Si l'erreur est due à
// une donnée manquante (ex: plaque non saisie), on l'indique.

import { useEffect } from 'react'

export default function MissionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[mission/error]', error?.message, error?.stack)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-surface">
      <div className="max-w-sm w-full bg-white border border-amber-300 rounded-2xl p-6 text-center shadow-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-ink font-bold text-lg mb-2">Impossible d'afficher cette mission</h1>
        <p className="text-ink-muted text-sm mb-1">
          Une information est peut-être manquante ou incorrecte sur la fiche
          (par exemple la plaque du véhicule non saisie par le bureau).
        </p>
        <p className="text-ink-faint text-xs mb-4">
          Préviens le dispatch pour qu'il complète la mission, puis recharge.
        </p>
        {error?.message && (
          <p className="text-left text-[11px] font-mono text-ink-faint bg-surface-2 border rounded-lg px-2 py-1.5 mb-4 break-words">
            {error.message}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button onClick={() => reset()}
            className="w-full py-3 bg-brand text-white font-semibold rounded-xl text-sm">
            ↻ Réessayer
          </button>
          <a href="/mission"
            className="w-full py-3 bg-surface-2 border text-ink-secondary font-semibold rounded-xl text-sm">
            ← Retour à mes missions
          </a>
        </div>
      </div>
    </div>
  )
}
