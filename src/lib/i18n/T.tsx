'use client'

// Composant <T /> : rend une traduction avec le francais en plus petit/opaque
// quand la langue active est l albanais. Utiliser pour les labels visibles
// (boutons, titres, etiquettes). Pour les attributs html (placeholder, title,
// aria-label) qui exigent une string, utiliser useT() + t() directement.
//
// Usage :
//   <T k="missions.title" />
//   <T k="greeting" params={{ name: 'Olivier' }} />

import { useI18n } from './I18nProvider'

interface TProps {
  k:       string
  params?: Record<string, string | number>
  /** Classe CSS appliquee au francais en plus petit (par defaut : opacite 50, taille 85%) */
  secondaryClassName?: string
}

export function T({ k, params, secondaryClassName }: TProps) {
  const { parts } = useI18n()
  const { primary, secondary } = parts(k, params)

  if (!secondary) return <>{primary}</>

  return (
    <>
      {primary}
      <span className={secondaryClassName || 'opacity-50 text-[0.78em] ml-1 font-normal'}>
        ({secondary})
      </span>
    </>
  )
}
