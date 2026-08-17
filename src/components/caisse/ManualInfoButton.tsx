'use client'

// Bouton « Info manuelle » pour la fiche opérateur (bloc Client facturé).
//   1. Commande l'écran comptoir en mode « saisie coordonnées » (POST action:'manual').
//   2. Le client remplit nom/adresse (autocomplete Google)/email/tél, choisit sa langue.
//   3. Dès validation → renvoie les données via onImport(). Mirroir de EidImportButton.
// Olivier 2026-08-17.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

export interface ManualClientData {
  name?: string | null
  street?: string | null; zip?: string | null; city?: string | null
  country?: string | null; countryCode?: string | null
  email?: string | null; phone?: string | null
  vat?: string | null; isCompany?: boolean
  request_id?: string
}

type Status = 'idle' | 'waiting' | 'error'

const newRequestId = () => {
  try { return (crypto as any)?.randomUUID?.() as string } catch { /* noop */ }
  return `man-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export default function ManualInfoButton({
  screenKey = 'facturation',
  onImport,
  className,
}: {
  screenKey?: string
  onImport: (d: ManualClientData) => void
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
    cleanup(); setStatus('idle')
    onImport(resp as ManualClientData)
  }

  const listen = () => {
    if (chanRef.current) sb.removeChannel(chanRef.current)
    chanRef.current = sb.channel('manual-import-' + screenKey)
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
        body: JSON.stringify({ action: 'manual', key: screenKey, request_id: reqId, force }),
      })
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}))
        const who = j?.occupant?.client ? ` (${j.occupant.client})` : ''
        if (window.confirm(`L'écran comptoir affiche déjà quelque chose${who}. Le remplacer par la saisie manuelle ?`)) {
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
        <div className="flex items-center gap-2 px-3 py-2 bg-info-soft border border-info rounded-xl text-xs">
          <span className="inline-block w-3 h-3 border-2 border-info border-t-transparent rounded-full animate-spin" />
          <span className="text-info font-medium">Saisie en cours au comptoir…</span>
          <button type="button" onClick={cancel} className="ml-auto text-ink-muted hover:text-critical">Annuler</button>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <button type="button" onClick={() => start(false)}
        className="text-xs text-brand hover:underline flex items-center gap-1"
        title="Afficher un formulaire de coordonnées sur l'écran comptoir">
        📝 Info manuelle
      </button>
      {status === 'error' && error && <p className="text-critical text-xs mt-1">⚠ {error}</p>}
    </div>
  )
}
