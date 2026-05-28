'use client'

// Bouton 🔊 cible : click court -> lecture du texte fourni via Web Speech API.
// Olivier 2026-05-28 : pour chauffeurs non-lecteurs. Visible pour tous (pas
// gating role), c est juste un raccourci.
//
// Usage:
//   <TtsButton text="123 rue de Verviers, 4800 Verviers" />
//
// Click pendant qu une lecture est en cours -> stop (toggle).

import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'

interface TtsButtonProps {
  text:        string | null | undefined
  size?:       'sm' | 'md' | 'lg'
  className?:  string
  title?:      string
}

export function TtsButton({ text, size = 'md', className = '', title }: TtsButtonProps) {
  const [speaking, setSpeaking] = useState(false)

  // Cleanup : si le composant est demonte pendant la lecture, on coupe.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  if (!text || !text.trim()) return null

  const dimensions = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-10 h-10' : 'w-8 h-8'
  const iconSize   = size === 'sm' ? 14       : size === 'lg' ? 20            : 16

  function handleClick(e: React.MouseEvent | React.TouchEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const u = new SpeechSynthesisUtterance(text!.trim())
    u.lang = 'fr-FR'
    u.rate = 1.0
    u.onend   = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(u)
    setSpeaking(true)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title || 'Écouter à voix haute'}
      aria-label={title || 'Écouter à voix haute'}
      className={`${dimensions} inline-flex items-center justify-center rounded-full shrink-0
        ${speaking
          ? 'bg-blue-600 text-white animate-pulse'
          : 'bg-blue-100 text-blue-700 hover:bg-blue-200 active:bg-blue-300'}
        transition ${className}`}
    >
      {speaking ? <VolumeX size={iconSize} /> : <Volume2 size={iconSize} />}
    </button>
  )
}
