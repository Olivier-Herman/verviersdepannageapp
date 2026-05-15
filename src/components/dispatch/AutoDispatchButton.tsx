'use client'
// src/components/dispatch/AutoDispatchButton.tsx
//
// Bouton ⚡ Auto-dispatch affiche sur les cards "Nouvelle" (status new ou dispatching)
// quand mission_type est remorquage ou depannage.
//
// Visible si user a la permission (module auto_dispatch OU role admin/dispatcher).
// Au clic : POST /api/auto-dispatch/trigger → declenche le flow sequentiel.

import { useState } from 'react'
import { Zap } from 'lucide-react'

interface Props {
  missionId:    string
  missionType:  string | null
  userRole:     string
  userModules:  string[]
  /** Auto-dispatch en cours → bouton devient "Stop" qui annule la procedure */
  isActive?:    boolean
  onTriggered?: () => void
}

const AUTO_DISPATCH_TYPES = ['remorquage', 'depannage']

export default function AutoDispatchButton({
  missionId, missionType, userRole, userModules, isActive, onTriggered,
}: Props) {
  const [loading, setLoading]   = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Filtre type mission
  if (!missionType || !AUTO_DISPATCH_TYPES.includes(missionType)) return null

  // Filtre permission
  const allowed = ['admin', 'superadmin', 'dispatcher'].includes(userRole)
                || userModules.includes('auto_dispatch')
  if (!allowed) return null

  async function cancel() {
    if (!confirm('Stopper la procedure auto-dispatch en cours ?')) return
    setLoading(true); setFeedback(null)
    try {
      const r = await fetch('/api/auto-dispatch/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: missionId }),
      })
      const j = await r.json()
      if (!r.ok) {
        setFeedback(`❌ ${j.error || 'Erreur'}`)
      } else {
        setFeedback('🛑 Stoppe')
        setTimeout(() => onTriggered?.(), 300)
      }
    } catch (e: any) {
      setFeedback(`❌ ${e.message || 'Erreur reseau'}`)
    } finally {
      setLoading(false)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  async function trigger() {
    if (!confirm('Lancer l\'auto-dispatch sur cette mission ?')) return
    setLoading(true); setFeedback(null)
    try {
      const r = await fetch('/api/auto-dispatch/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: missionId }),
      })
      const j = await r.json()
      if (!r.ok) {
        setFeedback(`❌ ${j.error || 'Erreur'}`)
        // Refresh quand meme en cas d'erreur (la mission a peut-etre change)
        setTimeout(() => onTriggered?.(), 4000)
      } else {
        // Affiche aussi un alert visible globalement (le feedback inline
        // peut etre cache si la card change de tab apres refresh)
        const msg = `⚡ Auto-dispatch lancé\n→ ${j.target_driver?.name || 'chauffeur'}`
        setFeedback(`⚡ → ${j.target_driver?.name || 'chauffeur'}`)
        // Delai 4s avant refresh pour que le user voit le feedback
        setTimeout(() => {
          onTriggered?.()
          alert(msg)
        }, 100)
      }
    } catch (e: any) {
      setFeedback(`❌ ${e.message || 'Erreur réseau'}`)
    } finally {
      setLoading(false)
      // Clear feedback apres 5s
      setTimeout(() => setFeedback(null), 5000)
    }
  }

  if (feedback) {
    return (
      <span className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
        feedback.startsWith('❌')
          ? 'bg-critical-soft border border-critical/40 text-critical'
          : 'bg-success-soft border border-success/40 text-success'
      }`}>
        {feedback}
      </span>
    )
  }

  if (isActive) {
    return (
      <button
        type="button"
        onClick={cancel}
        disabled={loading}
        title="Stopper la procedure auto-dispatch en cours (sans assigner de chauffeur)"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-critical hover:bg-critical-hover text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
      >
        🛑 {loading ? '…' : 'Stop'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={loading}
      title="Auto-dispatch : envoie une notif au chauffeur le plus adapté (ETA + kms)"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
    >
      <Zap size={12} />
      {loading ? '…' : 'Auto'}
    </button>
  )
}
