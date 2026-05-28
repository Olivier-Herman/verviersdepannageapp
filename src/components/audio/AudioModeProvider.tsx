'use client'

// Provider global qui active le long-press universel sur tout texte de l app.
// Olivier 2026-05-28 : pour chauffeurs avec audio_mode = true. Les autres
// users ne sont pas affectes (rien ne se monte).
//
// Comportement :
// - Touch sur un element pendant 500ms -> lecture du textContent
// - Release / move / scroll -> annule
// - Vibration courte pour confirmer le declenchement
//
// Important :
// - Ne lit que des elements "feuille" (sans enfants, ou avec uniquement du texte)
//   pour eviter de lire toute la page si on touche un conteneur.
// - Ignore les boutons / inputs / liens (le click natif doit primer).
// - Texte minimum 3 caracteres pour eviter les "OK", "+", etc.

import { useEffect } from 'react'

const IGNORED_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SVG', 'IMG'])
const LONG_PRESS_MS = 500
const MIN_TEXT_LENGTH = 3

interface AudioModeProviderProps {
  enabled: boolean
}

export function AudioModeProvider({ enabled }: AudioModeProviderProps) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    let timer: number | null = null
    let cancelled = false

    function findReadableText(target: EventTarget | null): string | null {
      if (!target || !(target instanceof Element)) return null
      let el: Element | null = target
      while (el && el !== document.body) {
        if (IGNORED_TAGS.has(el.tagName)) return null
        const text = (el.textContent || '').trim()
        // Lit le bloc texte le plus proche, qui doit etre "simple" :
        // soit un element feuille (pas de DOM children), soit un bloc dont
        // les enfants sont juste des spans inlines.
        const hasBlockChildren = Array.from(el.children).some(c => {
          const display = window.getComputedStyle(c).display
          return display.startsWith('block') || display.startsWith('flex') || display.startsWith('grid')
        })
        if (!hasBlockChildren && text.length >= MIN_TEXT_LENGTH) {
          return text
        }
        el = el.parentElement
      }
      return null
    }

    function onTouchStart(e: TouchEvent) {
      cancelled = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      const target = e.target
      timer = window.setTimeout(() => {
        if (cancelled) return
        const text = findReadableText(target)
        if (!text) return
        try {
          window.speechSynthesis.cancel()
          const u = new SpeechSynthesisUtterance(text)
          u.lang = 'fr-FR'
          u.rate = 1.0
          window.speechSynthesis.speak(u)
          if (navigator.vibrate) navigator.vibrate(40)
        } catch {
          // ignore
        }
      }, LONG_PRESS_MS)
    }

    function cancel() {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    document.addEventListener('touchstart',  onTouchStart, { passive: true })
    document.addEventListener('touchend',    cancel,       { passive: true })
    document.addEventListener('touchcancel', cancel,       { passive: true })
    document.addEventListener('touchmove',   cancel,       { passive: true })
    document.addEventListener('scroll',      cancel,       { passive: true, capture: true })

    return () => {
      cancel()
      document.removeEventListener('touchstart',  onTouchStart)
      document.removeEventListener('touchend',    cancel)
      document.removeEventListener('touchcancel', cancel)
      document.removeEventListener('touchmove',   cancel)
      document.removeEventListener('scroll',      cancel, { capture: true } as any)
      if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel()
    }
  }, [enabled])

  return null
}
