'use client'

// Lightbox galerie réutilisable pour les photos des fiches.
// Ouvre une photo en plein écran et permet de VOYAGER d'une photo à l'autre
// (flèches ‹ ›, swipe tactile, flèches clavier) SANS fermer/rouvrir.
// Fermeture : croix, clic sur le fond, ou Échap. Olivier 2026-07-13.
//
// Volontairement sans texte (hors compteur numérique) → réutilisable tel quel
// dans l'app dispatch ET dans l'app chauffeur bilingue, sans souci i18n.

import { useCallback, useEffect, useState } from 'react'

/**
 * Grille de vignettes auto-contenue : au clic, ouvre le lightbox galerie sur la
 * bonne photo (navigation ‹ › / swipe entre toutes). Remplace les anciennes
 * grilles où chaque photo était un lien ouvrant un onglet séparé.
 */
export function PhotoGrid({
  photos,
  cols = 3,
  thumbClassName = '',
}: {
  photos: string[]
  cols?: 2 | 3 | 4
  thumbClassName?: string
}) {
  const [open, setOpen] = useState<number | null>(null)
  if (!photos?.length) return null
  const colClass = cols === 4 ? 'grid-cols-4' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3'
  return (
    <>
      <div className={`grid ${colClass} gap-2`}>
        {photos.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(i)}
            className={`aspect-square rounded-xl overflow-hidden block ${thumbClassName}`}
          >
            <img src={url} alt={`Photo ${i + 1}`} draggable={false}
              className="w-full h-full object-cover hover:opacity-80 transition" />
          </button>
        ))}
      </div>
      {open !== null && (
        <PhotoLightbox photos={photos} startIndex={open} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

export default function PhotoLightbox({
  photos,
  startIndex = 0,
  onClose,
}: {
  photos: string[]
  startIndex?: number
  onClose: () => void
}) {
  const [cur, setCur] = useState(startIndex)
  const n = photos.length
  const has = n > 1

  const go = useCallback((delta: number) => {
    setCur(c => (c + delta + n) % n)   // wrap-around
  }, [n])

  // Clavier : ← → pour naviguer, Échap pour fermer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Swipe tactile.
  const [touchX, setTouchX] = useState<number | null>(null)
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX === null) return
    const dx = e.changedTouches[0].clientX - touchX
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
    setTouchX(null)
  }

  if (n === 0) return null
  const url = photos[cur]

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 select-none"
      onClick={onClose}
      onTouchStart={e => setTouchX(e.touches[0].clientX)}
      onTouchEnd={onTouchEnd}
    >
      {/* Fermer */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute top-3 right-3 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl leading-none"
      >
        ×
      </button>

      {/* Compteur + ouvrir l'original */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
        {has && (
          <span className="px-2.5 py-1 rounded-full bg-white/10 text-white text-sm font-semibold tabular-nums">
            {cur + 1} / {n}
          </span>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          aria-label="Ouvrir l'original"
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-lg"
        >
          ↗
        </a>
      </div>

      {/* Précédent */}
      {has && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); go(-1) }}
          aria-label="Précédent"
          className="absolute left-2 sm:left-4 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-3xl leading-none"
        >
          ‹
        </button>
      )}

      {/* Image */}
      <img
        src={url}
        alt={`${cur + 1} / ${n}`}
        onClick={e => e.stopPropagation()}
        draggable={false}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg shadow-2xl"
      />

      {/* Suivant */}
      {has && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); go(1) }}
          aria-label="Suivant"
          className="absolute right-2 sm:right-4 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-3xl leading-none"
        >
          ›
        </button>
      )}
    </div>
  )
}
