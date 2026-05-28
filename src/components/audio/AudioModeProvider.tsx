'use client'

// Provider global qui active les comportements d assistance audio quand
// l user a `audio_mode = true` dans son profil. Sinon, ne monte rien.
//
// Olivier 2026-05-28 : pour chauffeurs non-lecteurs. Trois comportements :
//
//   1. LONG-PRESS UNIVERSEL : appui >500ms sur tout texte -> lecture vocale
//      du bloc texte le plus proche. Vibration courte pour confirmer.
//
//   2. LECTURE DU LABEL AU FOCUS D INPUT : quand un champ recoit le focus,
//      on lit son label associe (via <label htmlFor> ou parent <label>, OR
//      aria-label / placeholder en fallback). Aide pour les formulaires.
//
//   3. AUTO-LECTURE DES MESSAGES D ERREUR : MutationObserver detecte les
//      nouveaux nodes texte avec des classes/roles d erreur (text-red-*,
//      text-critical, role=alert, etc.) -> lecture immediate. Cache 5s
//      anti-doublons.
//
// Tout est gere par delegation d evenements (zero ajout dans les composants
// existants). Les autres users ne voient/entendent rien.

import { useEffect } from 'react'

const LONG_PRESS_MS = 500
const MIN_TEXT_LENGTH = 3
const IGNORED_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SVG', 'IMG'])
const ERROR_SELECTOR = [
  '[role="alert"]',
  '[role="status"]',
  '.text-critical',
  '.text-red-300',
  '.text-red-400',
  '.text-red-500',
  '.text-red-600',
  '.text-red-700',
  '.text-red-800',
  '.text-amber-700',
  '.text-amber-800',
].join(',')
const ANTI_DUP_MS = 5000

interface AudioModeProviderProps {
  enabled: boolean
}

export function AudioModeProvider({ enabled }: AudioModeProviderProps) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    // ── Anti-doublons ────────────────────────────────────────────────
    const lastSpoken = new Map<string, number>()
    function shouldSpeak(text: string): boolean {
      const now = Date.now()
      const last = lastSpoken.get(text)
      if (last && now - last < ANTI_DUP_MS) return false
      lastSpoken.set(text, now)
      // GC : si la map devient grosse, on nettoie les vieilles entrees
      if (lastSpoken.size > 50) {
        for (const [k, t] of lastSpoken) {
          if (now - t > ANTI_DUP_MS) lastSpoken.delete(k)
        }
      }
      return true
    }

    function speak(text: string, opts: { rate?: number; interrupt?: boolean } = {}) {
      if (!text || text.trim().length < MIN_TEXT_LENGTH) return
      const trimmed = text.trim().replace(/\s+/g, ' ')
      if (!shouldSpeak(trimmed)) return
      try {
        if (opts.interrupt && window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel()
        }
        const u = new SpeechSynthesisUtterance(trimmed)
        u.lang = 'fr-FR'
        u.rate = opts.rate ?? 1.0
        window.speechSynthesis.speak(u)
      } catch {
        // ignore
      }
    }

    // ── 1. LONG-PRESS UNIVERSEL ──────────────────────────────────────
    let longPressTimer: number | null = null
    let longPressCancelled = false

    function findReadableText(target: EventTarget | null): string | null {
      if (!target || !(target instanceof Element)) return null
      let el: Element | null = target
      while (el && el !== document.body) {
        if (IGNORED_TAGS.has(el.tagName)) return null
        const text = (el.textContent || '').trim()
        const hasBlockChildren = Array.from(el.children).some(c => {
          const display = window.getComputedStyle(c).display
          return display.startsWith('block') || display.startsWith('flex') || display.startsWith('grid')
        })
        if (!hasBlockChildren && text.length >= MIN_TEXT_LENGTH) return text
        el = el.parentElement
      }
      return null
    }

    function onTouchStart(e: TouchEvent) {
      longPressCancelled = false
      if (longPressTimer) clearTimeout(longPressTimer)
      const target = e.target
      longPressTimer = window.setTimeout(() => {
        if (longPressCancelled) return
        const text = findReadableText(target)
        if (!text) return
        window.speechSynthesis.cancel()
        speak(text, { interrupt: true })
        if (navigator.vibrate) navigator.vibrate(40)
      }, LONG_PRESS_MS)
    }
    function cancelLongPress() {
      longPressCancelled = true
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    // ── 2. LECTURE DU LABEL AU FOCUS D INPUT ─────────────────────────
    function getInputLabel(input: HTMLElement): string | null {
      // a) <label for="id">
      if (input.id) {
        const lbl = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`)
        if (lbl?.textContent) return lbl.textContent.trim()
      }
      // b) <label><input ...></label>
      const parentLbl = input.closest('label')
      if (parentLbl?.textContent) {
        const txt = parentLbl.textContent.trim()
        if (txt) return txt
      }
      // c) aria-label / aria-labelledby
      const aria = input.getAttribute('aria-label')
      if (aria) return aria.trim()
      const labelledBy = input.getAttribute('aria-labelledby')
      if (labelledBy) {
        const ref = document.getElementById(labelledBy)
        if (ref?.textContent) return ref.textContent.trim()
      }
      // d) placeholder (pis-aller)
      const placeholder = (input as HTMLInputElement).placeholder
      if (placeholder) return placeholder.trim()
      // e) heuristique : prendre le texte juste au-dessus du champ
      //    (souvent un <p> ou <span> servant de label visuel sans htmlFor)
      const parent = input.parentElement
      if (parent) {
        const prev = parent.previousElementSibling
        if (prev?.textContent) {
          const t = prev.textContent.trim()
          if (t.length > 2 && t.length < 80) return t
        }
        // ou un sibling au-dessus dans le meme parent
        const siblings = Array.from(parent.children)
        const idx = siblings.indexOf(input)
        for (let i = idx - 1; i >= 0; i--) {
          const sib = siblings[i] as HTMLElement
          if (sib.tagName === 'INPUT' || sib.tagName === 'TEXTAREA' || sib.tagName === 'SELECT') break
          const t = sib.textContent?.trim() || ''
          if (t.length > 2 && t.length < 80) return t
        }
      }
      return null
    }

    function onFocusIn(e: FocusEvent) {
      const target = e.target as HTMLElement
      if (!target) return
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const label = getInputLabel(target)
      if (label) speak(label)
    }

    // ── 3. AUTO-LECTURE DES MESSAGES D ERREUR ────────────────────────
    // Ignore les boutons / liens (souvent stylises en rouge mais pas erreurs)
    // et les blocs trop longs (> 300 chars = probablement pas une erreur).
    function extractError(el: Element): { text: string; isAlert: boolean } | null {
      if (el.closest('button, a')) return null
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ')
      if (text.length < MIN_TEXT_LENGTH || text.length > 300) return null
      const isAlert = el.getAttribute('role') === 'alert'
      return { text, isAlert }
    }

    function checkNodeForError(node: Node) {
      if (!(node instanceof Element)) return
      // Le node lui-meme matche-t-il ?
      if (node.matches(ERROR_SELECTOR)) {
        const found = extractError(node)
        if (found) {
          speak(found.isAlert ? `Erreur : ${found.text}` : found.text, { interrupt: true })
          return
        }
      }
      // Ou bien contient-il des matches ?
      const matches = node.querySelectorAll(ERROR_SELECTOR)
      for (let i = 0; i < matches.length; i++) {
        const found = extractError(matches[i])
        if (found) {
          speak(found.isAlert ? `Erreur : ${found.text}` : found.text, { interrupt: true })
          return  // ne lit qu un seul match par mutation pour eviter spam
        }
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) checkNodeForError(node)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // ── Bind ─────────────────────────────────────────────────────────
    document.addEventListener('touchstart',  onTouchStart,    { passive: true })
    document.addEventListener('touchend',    cancelLongPress, { passive: true })
    document.addEventListener('touchcancel', cancelLongPress, { passive: true })
    document.addEventListener('touchmove',   cancelLongPress, { passive: true })
    document.addEventListener('scroll',      cancelLongPress, { passive: true, capture: true })
    document.addEventListener('focusin',     onFocusIn,       { passive: true })

    return () => {
      cancelLongPress()
      observer.disconnect()
      document.removeEventListener('touchstart',  onTouchStart)
      document.removeEventListener('touchend',    cancelLongPress)
      document.removeEventListener('touchcancel', cancelLongPress)
      document.removeEventListener('touchmove',   cancelLongPress)
      document.removeEventListener('scroll',      cancelLongPress, { capture: true } as any)
      document.removeEventListener('focusin',     onFocusIn)
      if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel()
    }
  }, [enabled])

  return null
}
