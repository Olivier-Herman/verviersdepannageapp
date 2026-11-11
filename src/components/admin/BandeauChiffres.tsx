'use client'

// Chiffres d'un écran de Réglages, affichés dans le bandeau de couleur de l'en-tête
// (AdminNav). L'écran les déclare où il veut ; ils sont rendus dans l'emplacement du bandeau.
// Olivier 11/11/2026 : « des infos pertinentes affichées ».

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export const ID_BANDEAU_CHIFFRES = 'reglages-bandeau-chiffres'

export interface Chiffre { label: string; valeur: string | number }

export default function BandeauChiffres({ chiffres }: { chiffres: Chiffre[] }) {
  const [cible, setCible] = useState<HTMLElement | null>(null)
  useEffect(() => { setCible(document.getElementById(ID_BANDEAU_CHIFFRES)) }, [])
  if (!cible || !chiffres.length) return null
  return createPortal(
    <>
      {chiffres.map(c => (
        <div key={c.label} className="min-w-[96px] rounded-2xl bg-white/15 ring-1 ring-white/25 px-3.5 py-2">
          <span className="block text-white/80 text-xs">{c.label}</span>
          <span className="block font-display font-bold text-xl leading-tight tabular-nums">{c.valeur}</span>
        </div>
      ))}
    </>,
    cible,
  )
}
