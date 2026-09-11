'use client'
// Audit dispatch B3 (lot P2, 11/09/2026) : depuis la Vue dossier et la ligne
// mobile, aucune modification en ligne ne prévenait le chauffeur ni ne
// poussait le dossier Odoo — seul « Sauvegarder et notifier » de la fiche le
// faisait. Ce bouton rejoue exactement ce chemin (PATCH _notify_driver) sans
// rien changer d'autre : push « Mission modifiée » au chauffeur actif + sync Odoo.
import { useState } from 'react'

const ACTIVE = ['assigned', 'accepted', 'in_progress', 'delivering']

export default function NotifyDriverButton({ missionId, status, compact, className = '' }: {
  missionId: string; status?: string | null; compact?: boolean; className?: string
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'none' | 'err'>('idle')
  if (status && !ACTIVE.includes(status)) return null
  const go = async () => {
    setState('busy')
    try {
      const r = await fetch(`/api/missions/${missionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _notify_driver: true }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setState('err'); return }
      const m = j.mission || {}
      setState(m.assigned_to && ACTIVE.includes(m.status) ? 'sent' : 'none')
    } catch { setState('err') }
    setTimeout(() => setState('idle'), 4000)
  }
  const label = state === 'busy' ? '…' : state === 'sent' ? '✓ Chauffeur prévenu' : state === 'none' ? 'Aucun chauffeur actif' : state === 'err' ? 'Échec' : '🔔 Notifier le chauffeur'
  return (
    <button type="button" onClick={go} disabled={state === 'busy'} title="Envoie « Mission modifiée » au chauffeur et pousse les modifications vers le dossier Odoo"
      className={`${compact ? 'px-2.5 py-1 rounded-lg text-xs' : 'px-3 py-2.5 rounded-xl text-sm'} font-semibold border ${state === 'sent' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : state === 'none' || state === 'err' ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-surface text-ink-secondary hover:text-ink'} disabled:opacity-50 ${className}`}>
      {label}
    </button>
  )
}
