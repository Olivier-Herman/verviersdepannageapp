'use client'

import { useEffect, useState } from 'react'

// Popup d'annonce (one-shot) pour informer les utilisateurs du module Facturation
// du nouveau bouton « Facturer » (facture directe) à côté de « Créer le devis ».
// S'affiche à chaque ouverture/action de l'app tant que l'utilisateur n'a pas
// cliqué « J'ai compris » (mémorisé en localStorage). Olivier 2026-07-26.
//
// Pour une future annonce : changer ACK_KEY (nouvelle version) → elle réapparaît.
const ACK_KEY = 'ack_facturation_boutons_2026_07'

export default function FacturationButtonAnnounce({
  userRole, userModules,
}: { userRole: string; userModules: string[] }) {
  const isFacturation =
    ['admin', 'superadmin'].includes(userRole) || (userModules || []).includes('facturation')

  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!isFacturation) return
    if (typeof window === 'undefined') return
    if (localStorage.getItem(ACK_KEY) !== '1') setShow(true)
  }, [isFacturation])

  if (!show) return null

  const dismiss = () => {
    try { localStorage.setItem(ACK_KEY, '1') } catch { /* ignore */ }
    setShow(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md bg-surface border rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧾</span>
          <h2 className="text-ink font-bold text-lg">Nouveau dans Facturation</h2>
        </div>

        <div className="text-ink-secondary text-sm space-y-3 leading-relaxed">
          <p>Le bouton <strong>« Facturer »</strong> a été remplacé par <strong>deux boutons</strong> :</p>
          <ul className="space-y-2">
            <li className="flex gap-2">
              <span className="text-info font-semibold whitespace-nowrap">📄 Créer le devis</span>
              <span>— comme avant : crée un <strong>devis</strong> dans Odoo.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-600 font-semibold whitespace-nowrap">🧾 Facturer</span>
              <span>— <strong>nouveau</strong> : crée <strong>directement la facture en brouillon</strong> dans Odoo, sans passer par le devis.</span>
            </li>
          </ul>
          <p className="text-ink-muted text-xs">
            Le reste ne change pas : tu postes la facture dans Odoo et tu cliques
            « Facturation OK » comme d'habitude — le numéro se récupère tout seul.
            Le paiement et les caisses ne changent pas.
          </p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="w-full py-3 bg-brand hover:opacity-90 text-white rounded-xl font-bold text-sm transition"
        >
          J'ai compris
        </button>
      </div>
    </div>
  )
}
