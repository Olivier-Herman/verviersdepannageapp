// src/components/AmbientBackground.tsx
//
// Wrapper visuel reutilisable qui pose 3 blobs gradient blur en ambient
// background (purement decoratif, non-interactif). A utiliser autour du
// contenu principal d'une page pour le "mood" partage avec /recherche,
// /dispatch/new, /dispatch/[id], etc.
//
// Les keyframes (`ambient-fade-up`, `ambient-pulse`, `ambient-sparkle`)
// sont definies en globales dans src/app/globals.css.
//
// Usage minimal :
//   <AmbientBackground>
//     <div className="ambient-fade-up">contenu</div>
//   </AmbientBackground>
//
// Variantes :
//   <AmbientBackground variant="dense">  // 4-5 blobs au lieu de 3
//   <AmbientBackground variant="light">  // 2 blobs, opacite plus basse
//   <AmbientBackground className="min-h-screen">  // override wrapper

import type { ReactNode } from 'react'

interface Props {
  children:  ReactNode
  /** "default" (3 blobs, opacite 50%), "dense" (4 blobs, opacite 60%), "light" (2 blobs, opacite 35%) */
  variant?:  'default' | 'dense' | 'light'
  /** Classes additionnelles sur le wrapper externe (ex: 'min-h-screen'). */
  className?: string
}

export default function AmbientBackground({ children, variant = 'default', className = '' }: Props) {
  const opacity = variant === 'light' ? 'opacity-35'
                : variant === 'dense' ? 'opacity-60'
                : 'opacity-50'

  return (
    <div className={`relative ${className}`}>
      <div className={`pointer-events-none absolute inset-0 overflow-hidden ${opacity}`}>
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-brand/15 to-purple-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-[480px] h-[480px] rounded-full bg-gradient-to-br from-info/15 to-success/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[380px] h-[380px] rounded-full bg-gradient-to-br from-warning/10 to-brand/5 blur-3xl" />
        {variant === 'dense' && (
          <div className="absolute top-2/3 -left-32 w-[360px] h-[360px] rounded-full bg-gradient-to-br from-purple-500/12 to-info/8 blur-3xl" />
        )}
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  )
}
