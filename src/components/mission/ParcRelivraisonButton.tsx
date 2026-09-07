'use client'
// src/components/mission/ParcRelivraisonButton.tsx
//
// PARC DE RELIVRAISON, côté chauffeur (Olivier 2026-09-07, après une nuit avec
// Franck).
//
// « Il n'a pas la possibilité de sortir la voiture du parc pour la mettre en
// relivraison, sauf en scannant le QR — qui à ce moment-là n'est pas encore
// collé sur le véhicule. » Franck, de nuit et sans mission, veut écouler le parc
// qu'il a lui-même rempli pendant le rush. Le QR est un raccourci quand on est
// devant la voiture ; il ne peut pas être le SEUL chemin.
//
// La liste vient de l'API du module Relivraison : déjà filtrée (parents ayant
// une REL en cours exclus) et déjà triée par tournée depuis le dépôt. De nuit,
// ça donne l'ordre le plus logique sans que le chauffeur ait à y penser.
//
// La prise passe par `qr-rel-action`, exactement comme le scan : on n'écrit pas
// une seconde fois la règle métier, on lui ouvre une seconde porte.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Vehicule {
  id: string; mission_number: number | null
  vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null
  redelivery_address: string | null
}

export default function ParcRelivraisonButton() {
  const router = useRouter()
  const [ouvert, setOuvert] = useState(false)
  const [parc, setParc]     = useState<Vehicule[] | null>(null)
  const [busy, setBusy]     = useState<string | null>(null)
  const [err, setErr]       = useState('')

  useEffect(() => {
    if (!ouvert || parc) return
    fetch('/api/relivraison/list?zone=K', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setParc(d.missions || []))
      .catch(() => setParc([]))
  }, [ouvert, parc])

  const prendre = async (m: Vehicule, confirmer = false) => {
    setBusy(m.id); setErr('')
    try {
      const r = await fetch(`/api/missions/${m.id}/qr-rel-action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_reassign: confirmer }),
      })
      const j = await r.json()
      if (r.status === 409 && j.needs_confirm) {
        const qui = j.current_assignee_name || 'un autre chauffeur'
        if (confirm(`Cette relivraison est déjà attribuée à ${qui}. La reprendre ?`)) return prendre(m, true)
        setBusy(null); return
      }
      if (!r.ok || !j.ok) { setErr(j.error || 'Impossible de lancer la relivraison'); setBusy(null); return }
      router.push(j.redirect_url || `/mission/${j.mission_id}`)
    } catch (e: any) { setErr(e?.message || 'Erreur'); setBusy(null) }
  }

  return (
    <>
      <button type="button" onClick={() => setOuvert(true)}
        className="fixed bottom-6 left-5 h-14 px-4 bg-surface border-2 border-brand rounded-2xl shadow-2xl flex items-center gap-2 text-ink font-semibold transition active:scale-95 z-20">
        <span className="text-xl">🅿️</span>
        <span className="text-xs leading-tight text-left">Parc de<br />relivraison</span>
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col">
            <div className="px-5 pt-4 pb-3 border-b border flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-ink font-bold">🅿️ Parc de relivraison</p>
                <p className="text-ink-muted text-xs">
                  {parc == null ? 'chargement…' : `${parc.length} véhicule(s) en attente`}
                </p>
              </div>
              <button onClick={() => setOuvert(false)} className="text-ink-muted text-2xl px-2">×</button>
            </div>
            {err && <p className="px-5 pt-3 text-red-500 text-sm">⚠ {err}</p>}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {parc != null && parc.length === 0 && (
                <p className="text-ink-muted text-sm text-center py-10">Aucun véhicule à relivrer pour l’instant.</p>
              )}
              {(parc || []).map(m => (
                <div key={m.id} className="border rounded-2xl p-3 bg-surface-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-bold text-ink">{m.vehicle_plate || '—'}</span>
                    <span className="text-ink-secondary text-sm truncate">
                      {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}
                    </span>
                  </div>
                  <p className="text-ink-muted text-xs mt-1">
                    {m.redelivery_address ? `→ ${m.redelivery_address}` : '→ adresse de relivraison pas encore connue'}
                  </p>
                  <button type="button" disabled={busy === m.id || !m.redelivery_address}
                    onClick={() => prendre(m)}
                    className="mt-2 w-full py-2.5 bg-brand disabled:opacity-40 text-white rounded-xl text-sm font-bold">
                    {busy === m.id ? 'Création…' : m.redelivery_address ? '🚚 Relivrer ce véhicule' : 'Adresse manquante'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
