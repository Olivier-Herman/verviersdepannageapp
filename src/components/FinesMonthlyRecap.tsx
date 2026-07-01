'use client'

// Message de conscientisation : au 1er du mois, à la 1re ouverture de l'app, on
// affiche au chauffeur le total de ses amendes (une ligne par mois). Une seule
// fois par mois (flag localStorage), et UNIQUEMENT s'il a des amendes.
// Olivier 2026-07-01.

import { useEffect, useState } from 'react'

interface Recap {
  driver_name?: string
  months: { ym: string; label: string; total: number; count: number }[]
  grand_total: number
}

export default function FinesMonthlyRecap() {
  const [recap, setRecap] = useState<Recap | null>(null)
  const [show, setShow] = useState(false)

  // Prévisualisation déclenchée par un bouton (app native = pas d'URL) :
  // window.dispatchEvent(new CustomEvent('fines-recap-preview')).
  useEffect(() => {
    const handler = () => {
      fetch('/api/driver/fines-recap?preview=1')
        .then(r => r.json())
        .then((d: Recap) => { if (d?.months?.length) { setRecap(d); setShow(true) } })
        .catch(() => {})
    }
    window.addEventListener('fines-recap-preview', handler)
    return () => window.removeEventListener('fines-recap-preview', handler)
  }, [])

  useEffect(() => {
    // Prévisualisation (admin) : ?fines_recap=preview → force l'affichage avec
    // des données factices, sans tenir compte du jour / du flag mensuel.
    const preview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fines_recap') === 'preview'
    if (preview) {
      fetch('/api/driver/fines-recap?preview=1')
        .then(r => r.json())
        .then((d: Recap) => { if (d?.months?.length) { setRecap(d); setShow(true) } })
        .catch(() => {})
      return
    }

    const now = new Date()
    if (now.getDate() !== 2) return   // le 2 du mois (les amendes sont clôturées le 1er)
    const key = `fines_recap_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    try { if (localStorage.getItem(key)) return } catch { return }
    // Le profil Driver + la présence d'amendes sont vérifiés côté API
    // (renvoie months:[] sinon → pas d'affichage).
    fetch('/api/driver/fines-recap')
      .then(r => r.json())
      .then((d: Recap) => {
        try { localStorage.setItem(key, '1') } catch {}
        if (d?.months?.length) { setRecap(d); setShow(true) }
      })
      .catch(() => {})
  }, [])

  if (!show || !recap) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setShow(false)}>
      <div className="bg-surface rounded-2xl border max-w-sm w-full p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink mb-1">🚦 Un petit visuel de tes amendes actuelles</h2>
        <p className="text-ink-secondary text-sm mb-3">Le total de tes amendes, mois par mois :</p>
        <div className="space-y-1 mb-3 max-h-64 overflow-auto">
          {recap.months.map(m => (
            <div key={m.ym} className="flex items-center justify-between text-sm">
              <span className="text-ink-secondary capitalize">{m.label} <span className="text-ink-faint text-xs">({m.count})</span></span>
              <span className="text-ink font-semibold tabular-nums">{m.total.toFixed(2)} €</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t pt-2 mb-4">
          <span className="text-ink font-semibold text-sm">Total</span>
          <span className="text-ink font-bold tabular-nums">{recap.grand_total.toFixed(2)} €</span>
        </div>
        <button onClick={() => setShow(false)} className="w-full py-2.5 bg-brand text-white rounded-xl font-semibold text-sm">
          J'ai compris
        </button>
      </div>
    </div>
  )
}
