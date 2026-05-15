'use client'
// src/components/mission/NewInterventionButton.tsx
//
// Bouton "+ Nouvelle intervention" qui ouvre un modal de choix entre :
//  - Appel Police (Accident, Saisie, Mal garée, SNC, AVP) → /mission/new
//  - Intervention avec encaissement chauffeur → /encaissement
//
// 2 variantes via prop `variant` :
//  - 'fab' : bouton flottant rond (FAB) en bas a droite
//  - 'cta' : bouton inline classique (pour empty state)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Wallet, X } from 'lucide-react'

export default function NewInterventionButton({ variant }: { variant: 'fab' | 'cta' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      {variant === 'fab' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Nouvelle intervention"
          className="fixed bottom-6 right-5 w-16 h-16 bg-brand rounded-full shadow-2xl flex items-center justify-center text-ink text-3xl font-bold z-20 active:scale-95 transition-transform"
        >
          +
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-semibold text-sm"
        >
          + Nouvelle intervention
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-ink font-bold text-lg">Quel type d&apos;intervention ?</h3>
              <button type="button" onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink p-1">
                <X size={20} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => { setOpen(false); router.push('/mission/police') }}
              className="w-full flex items-start gap-3 p-4 bg-surface-2 hover:bg-surface-hover border rounded-2xl text-left transition active:scale-[0.98]">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                <Shield size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold">Appel Police</p>
                <p className="text-ink-muted text-xs mt-0.5">Accident · Saisie · Mal garée · SNC · AVP</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => { setOpen(false); router.push('/encaissement') }}
              className="w-full flex items-start gap-3 p-4 bg-surface-2 hover:bg-surface-hover border rounded-2xl text-left transition active:scale-[0.98]">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-success/10 text-success flex items-center justify-center">
                <Wallet size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold">Intervention avec encaissement</p>
                <p className="text-ink-muted text-xs mt-0.5">Mission privée à encaisser directement par le chauffeur</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
