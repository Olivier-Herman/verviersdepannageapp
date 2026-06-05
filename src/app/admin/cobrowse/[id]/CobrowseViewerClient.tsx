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
  const roRef        = useRef<ResizeObserver | null>(null)
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

        // Coupe les events anterieurs au FullSnapshot
        const usable = buffer.slice(fullIdx)
        if (!containerRef.current) return

        replayerRef.current = new rrweb.Replayer(usable, {
          root:       containerRef.current,
          liveMode:   true,
          insertStyleRules: [],
          showWarning: false,
          mouseTail:  false,
        })
        replayerRef.current.startLive(usable[0]?.timestamp || Date.now())
        started = true
        setStatus('playing')

        // Auto-scale + force la hauteur de l iframe a scrollHeight du DOM
        // (sinon l admin ne voit que la viewport iPhone du user, pas le
        // contenu scrollable en-dessous). Olivier 2026-06-05.
        const applyScale = () => {
          const root = containerRef.current
          if (!root) return
          const wrapper = root.querySelector('.replayer-wrapper') as HTMLElement | null
          if (!wrapper) return
          const iframe = wrapper.querySelector('iframe') as HTMLIFrameElement | null

          // Si l iframe est dispo et same-origin, force sa hauteur au
          // scrollHeight du body (= hauteur reelle du document du user)
          if (iframe) {
            try {
              const doc = iframe.contentDocument
              if (doc?.documentElement) {
                const realH = Math.max(
                  doc.documentElement.scrollHeight,
                  doc.body?.scrollHeight || 0,
                )
                if (realH > 0) {
                  iframe.style.height = `${realH}px`
                  wrapper.style.height = `${realH}px`
                }
              }
            } catch { /* cross-origin : on garde la hauteur viewport */ }
          }

          const ww = wrapper.offsetWidth || parseInt(wrapper.style.width) || 0
          const wh = wrapper.offsetHeight || parseInt(wrapper.style.height) || 0
          const cw = root.clientWidth
          if (!ww || !cw) return
          const scale = Math.min(1, cw / ww)
          wrapper.style.transform = `scale(${scale})`
          // Reserve la hauteur reelle apres scale pour eviter l overflow
          if (wh) root.style.minHeight = `${Math.ceil(wh * scale) + 8}px`
        }
        // Apply now + on resize + recheck plusieurs fois apres le snapshot
        // (le DOM se construit progressivement, plusieurs ticks de retry
        // pour capter les images/styles qui changent la hauteur reelle)
        applyScale()
        setTimeout(applyScale, 200)
        setTimeout(applyScale, 800)
        setTimeout(applyScale, 2000)
        setTimeout(applyScale, 4000)
        roRef.current?.disconnect()
        const ro = new ResizeObserver(applyScale)
        ro.observe(containerRef.current)
        roRef.current = ro

        // Re-apply apres chaque nouveau full snapshot (la DOM change)
        const reApplyOnSnapshot = setInterval(applyScale, 1500)
        // Cleanup
        const prevDisconnect = () => clearInterval(reApplyOnSnapshot)
        ;(roRef.current as any).__intervalCleanup = prevDisconnect
      }

      const onEvent = (rrwebEvent: any) => {
        if (!started) {
          buffer.push(rrwebEvent)
          ensureStarted()
        } else {
          try { replayerRef.current?.addEvent(rrwebEvent) } catch {}
        }
      }

      // Legacy : event unique (au cas ou un user runs old code)
      ch.on('broadcast', { event: 'rrweb' }, (payload: any) => {
        const evt = payload?.payload?.event
        if (evt) {
          setEventCount(c => c + 1)
          onEvent(evt)
        }
      })

      // Nouveau : batch d events
      ch.on('broadcast', { event: 'rrweb_batch' }, (payload: any) => {
        const events: any[] = payload?.payload?.events || []
        if (events.length === 0) return
        setEventCount(c => c + events.length)
        for (const e of events) onEvent(e)
      })

      await ch.subscribe(s => {
        if (s === 'SUBSCRIBED') {
          setStatus(prev => prev === 'connecting' ? 'waiting_snapshot' : prev)
          // Demande au user un FullSnapshot immediat
          ch.send({
            type:    'broadcast',
            event:   'request_snapshot',
            payload: {},
          }).catch(() => {})
          // Re-demande au cas ou (race avec le user)
          setTimeout(() => {
            ch.send({ type: 'broadcast', event: 'request_snapshot', payload: {} }).catch(() => {})
          }, 1500)
        }
      })

      unsub = () => {
        try { (roRef.current as any)?.__intervalCleanup?.() } catch {}
        try { roRef.current?.disconnect() } catch {}
        roRef.current = null
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
          1er snapshot demandé au user. Devrait apparaître sous 3 sec.
        </div>
      )}

      {/* Wrapper : on scale automatiquement le rendu rrweb pour qu il rentre
          dans la largeur dispo cote admin. Le user a souvent un iPhone
          (375px) qu on veut voir grand, ou un desktop (1920px) qu on veut
          shrinker. CSS rrweb expose .replayer-wrapper avec width/height
          inline -> on les detecte via mutation observer + scale. */}
      <div
        className="bg-white border rounded-xl shadow-sm overflow-auto"
        style={{ minHeight: 600, maxHeight: '80vh' }}
      >
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            // Le replayer pose un wrapper en absolute -> on lui donne un
            // referentiel et un padding pour eviter les clip
            width:    '100%',
            minHeight: 600,
          }}
        />
      </div>

      <style jsx global>{`
        /* Replayer rrweb : le wrapper est en absolute avec width/height
           du viewport user. On le rend visible et on cap la largeur. */
        .replayer-wrapper {
          position: relative !important;
          margin: 0 auto;
          transform-origin: 0 0;
          max-width: 100%;
        }
        .replayer-wrapper iframe {
          border: 0;
          background: white;
        }
      `}</style>

      <p className="mt-3 text-xs text-ink-secondary">
        Tu vois en direct ce que voit le user. Pour guider : appelle-le ou utilise
        un autre canal — il sait que tu regardes (bannière affichée en haut de son écran).
      </p>
    </div>
  )
}
