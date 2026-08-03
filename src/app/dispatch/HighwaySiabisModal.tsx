'use client'

// Modal proposé au dispatcher à la VALIDATION d'une mission dont l'adresse
// d'intervention est sur autoroute : « Passer en Siabis Couvert / Non Couvert /
// laisser en intervention normale ? ». Bascule uniquement la SOURCE (le
// dispatcher ajuste le type/scénario ensuite). Olivier 2026-07-09.

import { useState } from 'react'
import { isHighwayAddress, parseHighwayAddress } from '@/lib/highways/parse'

// Sources déjà police/Siabis → inutile de reproposer le basculement.
const SIABIS_OR_POLICE = new Set([
  'sia_couvert', 'police_snc', 'police_saisie', 'police_mal_garee', 'appel_police_accident',
])

/** Décide s'il faut proposer le basculement Siabis pour cette mission. */
export function shouldOfferSiabis(
  source: string | null | undefined,
  address: string | null | undefined,
): { offer: boolean; highwayRef: string | null } {
  const src = (source || '').toLowerCase()
  if (SIABIS_OR_POLICE.has(src) || src.startsWith('police')) return { offer: false, highwayRef: null }
  if (!isHighwayAddress(address)) return { offer: false, highwayRef: null }
  return { offer: true, highwayRef: parseHighwayAddress(address).highwayRef }
}

export function HighwaySiabisModal({
  missionId, highwayRef, onClose, blocking,
}: {
  missionId: string
  highwayRef: string | null
  onClose: (decided?: boolean) => void
  blocking?: boolean          // true → pas de fermeture au clic-fond, décision obligatoire
}) {
  const [loading, setLoading] = useState<string | null>(null)

  // source=null → « tarif normal » : on ne change PAS la source mais on marque la
  // mission comme tranchée (siabis_reviewed) + lève le drapeau. Les 2 autres
  // changent aussi la source (le chauffeur reçoit alors la bonne consigne d'encaissement).
  const apply = async (source: 'sia_couvert' | 'police_snc' | null) => {
    if (loading) return
    setLoading(source || 'normal')
    try {
      const base = { needs_siabis_decision: false, siabis_reviewed: true }
      const res = await fetch(`/api/missions/${missionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(source ? { source, ...base } : base),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(`Échec du basculement : ${d?.error || `HTTP ${res.status}`}`)
        setLoading(null)
        return
      }
      onClose(true)
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message || 'connexion impossible'}`)
      setLoading(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
      onClick={() => { if (!loading && !blocking) onClose(false) }}
    >
      <div
        className="bg-surface border rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">🛣️</span>
          <div>
            <h3 className="font-bold text-ink text-base">Intervention sur autoroute ?</h3>
            <p className="text-ink-secondary text-sm mt-1">
              Il me semble que cette intervention se situe sur l'autoroute
              {highwayRef ? ` (${highwayRef})` : ''}. Quelle tarification appliquer ?
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => apply('sia_couvert')} disabled={!!loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition">
            {loading === 'sia_couvert' ? '⏳…' : 'Siabis Couvert'}
          </button>
          <button
            onClick={() => apply('police_snc')} disabled={!!loading}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition">
            {loading === 'police_snc' ? '⏳…' : 'Siabis Non Couvert'}
          </button>
          <button
            onClick={() => apply(null)} disabled={!!loading}
            className="w-full py-3 bg-surface border hover:border-zinc-500 text-ink-secondary hover:text-ink font-medium rounded-xl text-sm transition disabled:opacity-50">
            {loading === 'normal' ? '⏳…' : 'Ce n\'est pas sur l\'autoroute — tarification normale'}
          </button>
        </div>

        <p className="text-ink-faint text-xs text-center">
          Bascule uniquement la source — ajuste le type / scénario ensuite sur la fiche.
        </p>
      </div>
    </div>
  )
}
