'use client'

/**
 * ConfirmModal — modal de confirmation pour actions destructives ou critiques.
 *
 * Props :
 *   - `open`         : ouvre/ferme la modal
 *   - `title`        : titre (font-display, gras)
 *   - `description` : ReactNode optionnel sous le titre
 *   - `confirmLabel` : libellé du bouton OK (défaut "Confirmer")
 *   - `cancelLabel`  : libellé du bouton Annuler (défaut "Annuler")
 *   - `variant`      : 'default' (CTA primary) | 'danger' (CTA danger)
 *   - `onConfirm`    : handler appelé au clic OK
 *   - `onCancel`     : handler appelé au clic Annuler / Escape / clic backdrop
 *   - `loading`      : désactive les boutons et le backdrop, met spinner sur OK
 *
 * Comportement :
 *   - Escape (clavier) → onCancel (bloqué pendant loading)
 *   - Clic sur le backdrop → onCancel (bloqué pendant loading)
 *   - Body scroll bloqué tant que la modal est ouverte
 *
 * Exemple :
 *   <ConfirmModal
 *     open={isOpen}
 *     title="Annuler la mission ?"
 *     description="Cette action est irréversible."
 *     variant="danger"
 *     confirmLabel="Annuler la mission"
 *     onConfirm={handleCancelMission}
 *     onCancel={() => setIsOpen(false)}
 *   />
 */

import { useEffect } from 'react'
import { Button } from '../Button'

interface ConfirmModalProps {
  open:          boolean
  title:         string
  description?:  React.ReactNode
  confirmLabel?: string
  cancelLabel?:  string
  variant?:      'default' | 'danger'
  onConfirm:     () => void | Promise<void>
  onCancel:      () => void
  loading?:      boolean
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel  = 'Annuler',
  variant      = 'default',
  onConfirm,
  onCancel,
  loading      = false,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, loading, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — bg-black/40 (fixe, pas thème : un dim sombre marche light + dark) */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={loading ? undefined : onCancel}
        aria-hidden="true"
      />

      {/* Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative w-full max-w-md bg-surface border border-border rounded-card shadow-md"
      >
        <div className="px-5 pt-5 pb-2">
          <h2 id="confirm-modal-title" className="font-display text-lg font-bold text-ink">
            {title}
          </h2>
        </div>

        {description !== undefined && (
          <div className="px-5 pb-4 text-sm text-ink-secondary">
            {description}
          </div>
        )}

        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
