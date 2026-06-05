'use client'

/**
 * src/components/cobrowse/CobrowseUserBridge.tsx
 * -----------------------------------------------------------------------------
 * Cote USER. Insere dans le header de AppShell.
 *
 * - Bouton "Demander de l aide" (icone LifeBuoy).
 * - Au clic : POST /api/cobrowse/start (cree session pending + push admin).
 * - Polling /api/cobrowse/my-status toutes les 5 sec (Realtime channel ferait
 *   double-emploi avec celui des events rrweb -- polling suffit).
 * - Quand session.status === 'active' : monte le recorder rrweb qui broadcast
 *   tous les events DOM sur le channel 'cobrowse:{id}'.
 * - Affiche banniere "Tu es en session avec {admin.name}" + bouton Quitter.
 *
 * Audit / RGPD :
 * - La demande vient EXPLICITEMENT du user (consentement clair).
 * - Banniere TOUJOURS visible tant que la session est active.
 * - Le user peut quitter a tout moment via le bouton dans la banniere.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { LifeBuoy, X }    from 'lucide-react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

function browserSb() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

type MyStatus = {
  id:              string
  status:          'pending' | 'active'
  started_at:      string
  admin_joined_at: string | null
  admin:           { id: string; name: string | null } | null
} | null

export default function CobrowseUserBridge() {
  const [status,  setStatus]  = useState<MyStatus>(null)
  const [busy,    setBusy]    = useState(false)
  const [showAsk, setShowAsk] = useState(false)
  const [message, setMessage] = useState('')

  // -----------------------------------------------------------------
  // Polling my-status toutes les 5 sec.
  // -----------------------------------------------------------------
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/cobrowse/my-status', { cache: 'no-store' })
      const j = await r.json()
      setStatus(j.session || null)
    } catch {}
  }, [])

  useEffect(() => {
    fetchStatus()
    const iv = setInterval(fetchStatus, 5000)
    return () => clearInterval(iv)
  }, [fetchStatus])

  // -----------------------------------------------------------------
  // Recorder rrweb (uniquement quand status active).
  // -----------------------------------------------------------------
  const stopperRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (status?.status !== 'active') {
      // Coupe le recorder si la session n est plus active
      if (stopperRef.current) {
        stopperRef.current()
        stopperRef.current = null
      }
      return
    }
    if (stopperRef.current) return // deja en cours

    let cancelled = false
    ;(async () => {
      try {
        const rrweb = await import('rrweb')
        if (cancelled) return

        const sb = browserSb()
        const channel = sb.channel(`cobrowse:${status.id}`, {
          config: { broadcast: { self: false, ack: false } },
        })
        await channel.subscribe()

        const stop = rrweb.record({
          emit(event: any) {
            // Broadcast direct, no buffering (latence < 200ms)
            channel.send({
              type:    'broadcast',
              event:   'rrweb',
              payload: { event, sent_at: Date.now() },
            }).catch(() => {})
          },
          // Snapshot complet toutes les 8 sec : permet a l admin de
          // rejoindre en cours et de reconstituer le DOM correctement.
          checkoutEveryNms: 8_000,
          // Capture aussi : canvas (pour signature pad), inputs masques
          // automatiquement pour password/type-mot-de-passe.
          recordCanvas: true,
          inlineStylesheet: true,
          maskInputOptions: { password: true },
          // Reduit le bruit : on n a pas besoin de chaque mousemove
          sampling: { mousemove: 150, scroll: 200, input: 'last' },
        })

        stopperRef.current = () => {
          try { stop?.() } catch {}
          try { sb.removeChannel(channel) } catch {}
        }
      } catch (e) {
        console.warn('[cobrowse user] recorder init KO', e)
      }
    })()

    return () => {
      cancelled = true
      if (stopperRef.current) {
        stopperRef.current()
        stopperRef.current = null
      }
    }
  }, [status?.status, status?.id])

  // -----------------------------------------------------------------
  // Actions.
  // -----------------------------------------------------------------
  const askHelp = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/cobrowse/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message:    message.trim() || null,
          url:        typeof window !== 'undefined' ? window.location.href : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Erreur')
      setShowAsk(false)
      setMessage('')
      await fetchStatus()
    } catch (e: any) {
      alert('Erreur : ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const stopSession = async () => {
    if (!status?.id) return
    if (!confirm('Arrêter la session d aide ?')) return
    setBusy(true)
    try {
      await fetch(`/api/cobrowse/${status.id}/stop`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: 'user_quit' }),
      })
      await fetchStatus()
    } finally {
      setBusy(false)
    }
  }

  // -----------------------------------------------------------------
  // Rendu.
  // -----------------------------------------------------------------
  return (
    <>
      {/* Bouton icone dans le header */}
      <button
        type="button"
        onClick={() => setShowAsk(true)}
        title="Demander de l aide"
        aria-label="Demander de l aide"
        className={`relative w-10 h-10 flex items-center justify-center rounded-md transition-colors ${
          status?.status === 'active'
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            : status?.status === 'pending'
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              : 'bg-surface-hover text-ink hover:bg-surface-active'
        }`}
      >
        <LifeBuoy size={18} />
        {status?.status === 'pending' && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
        )}
        {status?.status === 'active' && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
        )}
      </button>

      {/* Modal "Demander de l aide" */}
      {showAsk && (
        <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowAsk(false)}>
          <div
            className="bg-surface rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
                <LifeBuoy size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-ink">Demander de l aide</h2>
                <p className="text-sm text-ink-secondary">
                  Un administrateur va voir ton écran en direct pour t aider.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAsk(false)}
                className="w-8 h-8 flex items-center justify-center text-ink-secondary hover:text-ink"
              >
                <X size={20} />
              </button>
            </div>

            {status?.status === 'pending' && (
              <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
                Demande en attente. Un admin va te rejoindre dans un instant.
              </div>
            )}
            {status?.status === 'active' && (
              <div className="mb-4 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                Session en cours avec {status.admin?.name || 'un admin'}.
              </div>
            )}

            {!status && (
              <>
                <label className="block text-sm font-medium text-ink mb-1">
                  Décris brièvement ton problème (optionnel)
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Ex : Je n arrive pas à clôturer ma mission"
                  className="w-full px-3 py-2 border rounded-md bg-surface text-ink resize-none focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <button
                  type="button"
                  onClick={askHelp}
                  disabled={busy}
                  className="mt-4 w-full px-4 py-2.5 rounded-md bg-brand text-white font-medium hover:bg-brand-hover disabled:opacity-50"
                >
                  {busy ? 'Envoi...' : 'Envoyer la demande'}
                </button>
                <p className="mt-3 text-xs text-ink-secondary">
                  En cliquant, tu acceptes qu un administrateur voie ton écran le temps de t aider.
                  Tu peux mettre fin à la session à tout moment.
                </p>
              </>
            )}

            {status && (
              <button
                type="button"
                onClick={stopSession}
                disabled={busy}
                className="mt-2 w-full px-4 py-2.5 rounded-md bg-red-50 text-red-700 font-medium hover:bg-red-100 disabled:opacity-50 border border-red-200"
              >
                Arrêter la session
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Banniere fixe en haut tant qu une session est active.
 * Composant separe pour pouvoir l afficher au top du body (au-dessus du header).
 */
export function CobrowseUserBanner() {
  const [status, setStatus] = useState<MyStatus>(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const r = await fetch('/api/cobrowse/my-status', { cache: 'no-store' })
        const j = await r.json()
        setStatus(j.session || null)
      } catch {}
    }
    fetchStatus()
    const iv = setInterval(fetchStatus, 5000)
    return () => clearInterval(iv)
  }, [])

  const stopSession = async () => {
    if (!status?.id) return
    try {
      await fetch(`/api/cobrowse/${status.id}/stop`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: 'user_quit' }),
      })
      setStatus(null)
    } catch {}
  }

  if (status?.status !== 'active') return null

  return (
    <div className="bg-emerald-600 text-white text-sm px-4 py-2 flex items-center gap-3 sticky top-0 z-[60]">
      <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
      <span className="flex-1 font-medium">
        Session d aide en cours avec {status.admin?.name || 'un admin'}
      </span>
      <button
        type="button"
        onClick={stopSession}
        className="px-3 py-1 rounded bg-white/20 hover:bg-white/30 text-xs font-semibold"
      >
        Arrêter
      </button>
    </div>
  )
}
