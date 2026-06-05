'use client'

/**
 * CobrowseViewerClient
 * -------------------------------------------------------------------------
 * Cote ADMIN. Subscribe au channel Supabase Realtime `cobrowse:{id}`,
 * recoit les events rrweb broadcasted par le user, et les rejoue dans un
 * iframe avec Replayer en liveMode.
 *
 * Strategie :
 * - On bufferise les events tant qu on n a pas encore vu un FullSnapshot
 *   (type 2). Sans ca, le Replayer ne peut pas demarrer (DOM incomplet).
 * - Au 1er FullSnapshot recu, on initialise le Replayer + on lui pousse
 *   les events du buffer dans l ordre.
 * - Les events suivants sont addEvent() en live.
 * - Si la connexion se reinitialise, le user emet checkout toutes les 8s
 *   donc on attend juste le prochain.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter }                    from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Power, ArrowLeft, Loader2 }    from 'lucide-react'

function browserSb() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

type Status = 'connecting' | 'waiting_snapshot' | 'playing' | 'ended'

export default function CobrowseViewerClient({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const replayerRef  = useRef<any>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [eventCount, setEventCount] = useState(0)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unsub: (() => void) | null = null

    ;(async () => {
      // Charge rrweb (Replayer)
      const rrweb = await import('rrweb')
      if (cancelled) return

      const sb = browserSb()
      const ch = sb.channel(`cobrowse:${sessionId}`, {
        config: { broadcast: { self: false, ack: false } },
      })

      const buffer: any[] = []
      let started = false

      const ensureStarted = () => {
        if (started) return
        // On cherche le FullSnapshot dans le buffer
        const fullIdx = buffer.findIndex(e => e?.type === 2)
        if (fullIdx === -1) return

        // Coupe les events anterieurs au FullSnapshot (ils referencent un
        // DOM qu on n a jamais vu)
        const usable = buffer.slice(fullIdx)
        if (!containerRef.current) return

        replayerRef.current = new rrweb.Replayer(usable, {
          root:       containerRef.current,
          liveMode:   true,
          insertStyleRules: [],
          showWarning: false,
          mouseTail:  false,
          // skipInactive: false,  // ne saute pas les periodes inactives
        })
        replayerRef.current.startLive(usable[0]?.timestamp || Date.now())
        started = true
        setStatus('playing')
      }

      const onEvent = (rrwebEvent: any) => {
        setEventCount(c => c + 1)
        if (!started) {
          buffer.push(rrwebEvent)
          ensureStarted()
        } else {
          try { replayerRef.current?.addEvent(rrwebEvent) } catch {}
        }
      }

      ch.on('broadcast', { event: 'rrweb' }, (payload: any) => {
        const evt = payload?.payload?.event
        if (evt) onEvent(evt)
      })

      await ch.subscribe(status => {
        if (status === 'SUBSCRIBED') setStatus(s => s === 'connecting' ? 'waiting_snapshot' : s)
      })

      unsub = () => {
        try { ch.unsubscribe() } catch {}
        try { sb.removeChannel(ch) } catch {}
        try { replayerRef.current?.destroy?.() } catch {}
      }
    })()

    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [sessionId])

  // Polling status BDD pour detecter end de session par le user
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/cobrowse/pending`, { cache: 'no-store' })
        const j = await r.json()
        const found = (j.sessions || []).find((s: any) => s.id === sessionId)
        if (!found) setStatus('ended')
      } catch {}
    }, 5000)
    return () => clearInterval(iv)
  }, [sessionId])

  const stopSession = async () => {
    if (!confirm('Terminer cette session ?')) return
    setStopping(true)
    try {
      await fetch(`/api/cobrowse/${sessionId}/stop`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: 'admin_quit' }),
      })
      router.push('/admin/cobrowse')
    } catch {
      setStopping(false)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => router.push('/admin/cobrowse')}
          className="px-3 py-1.5 rounded-md bg-surface-2 text-ink hover:bg-surface-hover inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft size={14} /> Liste
        </button>

        <div className="flex-1" />

        <span className="text-xs text-ink-secondary tabular-nums">
          {eventCount} events
        </span>

        <span className={`px-2 py-1 rounded text-xs font-medium ${
          status === 'playing' ? 'bg-emerald-100 text-emerald-700' :
          status === 'waiting_snapshot' ? 'bg-amber-100 text-amber-700' :
          status === 'ended' ? 'bg-gray-200 text-gray-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {status === 'connecting' && (<><Loader2 size={11} className="inline animate-spin" /> Connexion...</>)}
          {status === 'waiting_snapshot' && (<><Loader2 size={11} className="inline animate-spin" /> En attente du 1er snapshot...</>)}
          {status === 'playing' && 'En direct'}
          {status === 'ended' && 'Terminée'}
        </span>

        <button
          type="button"
          onClick={stopSession}
          disabled={stopping || status === 'ended'}
          className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <Power size={14} /> Terminer
        </button>
      </div>

      {status === 'waiting_snapshot' && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800 mb-3">
          Le 1er snapshot DOM arrive toutes les 8 secondes. Si rien ne s affiche
          au-delà de 15 sec, demande au user de bouger sur l app (clic, scroll).
        </div>
      )}

      <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
        <div
          ref={containerRef}
          className="w-full"
          style={{ minHeight: 600, position: 'relative' }}
        />
      </div>

      <p className="mt-3 text-xs text-ink-secondary">
        Tu vois en direct ce que voit le user. Pour guider : appelle-le ou utilise
        un autre canal — il sait que tu regardes (bannière affichée en haut de son écran).
      </p>
    </div>
  )
}
