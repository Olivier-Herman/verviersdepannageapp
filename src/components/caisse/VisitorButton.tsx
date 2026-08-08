'use client'

// Bouton « Visiteur » pour la fiche d'un véhicule EN PARC.
//   1. Commande l'écran comptoir en mode visite (POST /api/caisse/ecran action:'visitor').
//   2. Écoute customer_display.response en temps réel (filtré sur la key écran).
//   3. Quand le visiteur a validé au comptoir (carte + motifs), le serveur a déjà
//      inséré la visite → on appelle onDone() pour rafraîchir le tableau.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

type Status = 'idle' | 'waiting' | 'error'

const newRequestId = () => {
  try { return (crypto as any)?.randomUUID?.() as string } catch { /* noop */ }
  return `vis-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export default function VisitorButton({
  missionId, plate, screenKey = 'facturation', onDone, className,
}: {
  missionId: string
  plate?: string | null
  screenKey?: string
  onDone?: () => void
  className?: string
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError]   = useState<string | null>(null)
  const reqIdRef = useRef<string | null>(null)
  const chanRef  = useRef<any>(null)
  const sb = useMemo(
    () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!),
    [],
  )

  const cleanup = () => {
    if (chanRef.current) { sb.removeChannel(chanRef.current); chanRef.current = null }
    reqIdRef.current = null
  }
  useEffect(() => cleanup, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleResponse = (row: any) => {
    const resp = row?.response
    if (!resp || !reqIdRef.current || resp.request_id !== reqIdRef.current) return
    cleanup()
    setStatus('idle')
    onDone?.()
  }

  const listen = () => {
    if (chanRef.current) sb.removeChannel(chanRef.current)
    chanRef.current = sb.channel('visitor-' + screenKey)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'customer_display', filter: `key=eq.${screenKey}` },
        (p: any) => handleResponse(p.new || {}))
      .subscribe()
  }

  const start = async (force = false) => {
    setError(null)
    const reqId = force ? reqIdRef.current! : newRequestId()
    try {
      const r = await fetch('/api/caisse/ecran', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'visitor', key: screenKey, mission_id: missionId, plate, request_id: reqId, force }),
      })
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}))
        const who = j?.occupant?.client ? ` (${j.occupant.client})` : ''
        if (window.confirm(`L'écran comptoir affiche déjà quelque chose${who}. Le remplacer par l'enregistrement de visite ?`)) {
          reqIdRef.current = reqId
          return start(true)
        }
        return
      }
      if (!r.ok) { setStatus('error'); setError('Impossible de commander l’écran comptoir.'); return }
      reqIdRef.current = reqId
      setStatus('waiting')
      listen()
    } catch {
      setStatus('error'); setError('Réseau indisponible.')
    }
  }

  const cancel = async () => {
    cleanup(); setStatus('idle'); setError(null)
    try {
      await fetch('/api/caisse/ecran', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', key: screenKey }),
      })
    } catch { /* ignore */ }
  }

  if (status === 'waiting') {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 px-3 py-2 bg-info-soft border border-info rounded-2xl text-sm">
          <span className="inline-block w-3 h-3 border-2 border-info border-t-transparent rounded-full animate-spin" />
          <span className="text-info font-medium">En attente de la carte au comptoir…</span>
          <button type="button" onClick={cancel} className="ml-auto text-ink-muted hover:text-critical">Annuler</button>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <button type="button" onClick={() => start(false)}
        className="w-full py-2.5 bg-surface-2 hover:bg-surface-3 border border-app rounded-2xl text-ink text-sm font-medium"
        title="Enregistrer une visite via l'écran comptoir (lecture carte + motif)">
        🪪 Visiteur
      </button>
      {status === 'error' && error && <p className="text-critical text-xs mt-1">⚠ {error}</p>}
    </div>
  )
}
