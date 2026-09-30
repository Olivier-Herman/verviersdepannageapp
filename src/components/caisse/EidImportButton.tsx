'use client'

// Bouton « Lire une carte d'identité » pour la fiche opérateur.
//   1. Commande l'écran comptoir en mode eID (POST /api/caisse/ecran action:'eid').
//   2. Écoute en temps réel customer_display.response (filtré sur la key de l'écran).
//   3. Dès que le client a validé au comptoir → renvoie les données via onImport().
// Réutilisable : passer screenKey pour cibler un autre comptoir (défaut 'facturation').

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

export interface EidData {
  lastName?: string | null; firstName?: string | null
  street?: string | null; zip?: string | null; city?: string | null; country?: string | null
  nationalNumber?: string | null; birthDate?: string | null
  email?: string | null; phone?: string | null
  /** Photo du titulaire lue sur la puce, rangée en stockage privé (29/09/2026). */
  photoPath?: string | null
  request_id?: string
}

type Status = 'idle' | 'waiting' | 'error'

const newRequestId = () => {
  try { return (crypto as any)?.randomUUID?.() as string } catch { /* noop */ }
  return `eid-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export default function EidImportButton({
  screenKey = 'facturation',
  onImport,
  className,
  mode = 'eid',
  label,
  missionId = null,
  showPhoto = true,
}: {
  screenKey?: string
  onImport: (d: EidData) => void
  className?: string
  /** 'manual' : le client tape ses coordonnées sur l'écran comptoir (restitution, 28/09/2026). */
  mode?: 'eid' | 'manual'
  label?: string
  /** Fiche concernée : la photo du titulaire lue sur la puce y est rangée. */
  missionId?: string | null
  /** false : l'écran affiche la photo lui-même (restitution). */
  showPhoto?: boolean
}) {
  // Photo du titulaire (puce eID) : affichée dès réception pour comparer avec la
  // personne présente, et rangée dans la fiche si l'écran en a une (29/09/2026).
  const [photo, setPhoto] = useState<{ url: string; saved: boolean } | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError]   = useState<string | null>(null)
  const reqIdRef  = useRef<string | null>(null)
  const chanRef   = useRef<any>(null)
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
    onImport(resp as EidData)
    if (resp.photoPath && showPhoto) {
      fetch('/api/eid/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: resp.photoPath, mission_id: missionId || undefined }) })
        .then(r => r.ok ? r.json() : null).then(j => { if (j?.url) setPhoto({ url: j.url, saved: !!j.saved }) }).catch(() => {})
    }
  }

  // Filet de sécurité (Olivier 30/09/2026 : réponse arrivée 43 s après l'envoi) :
  // le temps réel peut tarder ou se perdre ; pendant l'attente, on relit aussi
  // l'état de l'écran toutes les 2 s. La première des deux voies qui voit la
  // réponse l'emporte (handleResponse vide reqIdRef, la seconde est ignorée).
  useEffect(() => {
    if (status !== 'waiting') return
    const started = Date.now()
    const t = setInterval(async () => {
      if (!reqIdRef.current || Date.now() - started > 10 * 60_000) { clearInterval(t); return }
      try {
        const j = await (await fetch(`/api/caisse/ecran?key=${encodeURIComponent(screenKey)}`, { cache: 'no-store' })).json()
        if (j?.response?.request_id && j.response.request_id === reqIdRef.current) handleResponse({ response: j.response })
      } catch { /* réseau : on réessaie au tour suivant */ }
    }, 2000)
    return () => clearInterval(t)
  }, [status, screenKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const listen = () => {
    if (chanRef.current) sb.removeChannel(chanRef.current)
    chanRef.current = sb.channel('eid-import-' + screenKey)
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
        body: JSON.stringify({ action: mode, key: screenKey, request_id: reqId, force }),
      })
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}))
        const who = j?.occupant?.client ? ` (${j.occupant.client})` : ''
        if (window.confirm(`L'écran comptoir affiche déjà quelque chose${who}. Le remplacer ?`)) {
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
    // Remet l'écran comptoir au repos (best-effort).
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
          <span className="text-info font-medium">{mode === 'manual' ? 'En attente des coordonnées au comptoir…' : 'En attente de la carte au comptoir…'}</span>
          <button type="button" onClick={cancel} className="ml-auto text-ink-muted hover:text-critical">Annuler</button>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <button type="button" onClick={() => start(false)}
        className="text-xs text-brand hover:underline flex items-center gap-1"
        title="Afficher la demande de carte d'identité sur l'écran comptoir">
        {label || "🪪 Lire une carte d'identité"}
      </button>
      {status === 'error' && error && <p className="text-critical text-xs mt-1">⚠ {error}</p>}
      {photo && <div className="mt-2 flex items-center gap-3 rounded-xl border border-info bg-info-soft p-2.5">
        <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt="Photo du titulaire de la carte" className="w-20 h-28 object-cover rounded-lg border border-strong bg-surface" /></a>
        <div className="text-xs"><div className="font-semibold text-ink text-sm">Photo du titulaire</div><div className="text-ink-secondary">Comparez avec la personne présente.{photo.saved ? ' Rangée dans la fiche.' : ''}</div></div>
      </div>}
    </div>
  )
}
