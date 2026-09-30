'use client'
// Bandeau du talkie sur toutes les pages (sauf l'écran /talkie) — Olivier 30/09/2026 :
//  - quelqu'un parle : « 🔊 Franck parle · Garde de nuit » en haut (toucher pour
//    entendre si le son n'est pas encore activé) ;
//  - juste après : bouton « Maintiens pour répondre » pendant 45 s, sans ouvrir le talkie ;
//  - le reste du temps : bouton rond 📻 permanent — maintenu ≥ 0,25 s = parler (Garde de
//    nuit, ou le dernier canal actif depuis 10 min) ; toucher bref = ouvrir le talkie.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTalkie } from './TalkieProvider'

const REPLY_WINDOW_MS = 45_000
const HOLD_MS = 250           // maintien avant de parler (un toucher bref ouvre le talkie)
const RECENT_MS = 10 * 60_000 // « dernier canal actif » pour le bouton permanent

export default function TalkieOverlay() {
  const t = useTalkie()
  const router = useRouter()
  const pathname = usePathname() || ''
  const holdRef = useRef<{ timer: any; talking: boolean } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [fabTalking, setFabTalking] = useState(false)   // parole prise avec le bouton rond
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  if (!t || !t.me || !t.channels.length || pathname.startsWith('/talkie')) return null

  const label = (key: string) => { const c = t.channels.find(x => x.key === key); return !c ? '' : c.kind === 'garde' ? 'Garde de nuit' : c.label }
  const speaking = Object.entries(t.floor).find(([, f]) => f && f.id !== t.me!.id) as [string, { id: string; name: string }] | undefined
  const act = t.lastActivity && t.lastActivity.id !== t.me.id ? t.lastActivity : null
  const showReply = !fabTalking && (!!t.talkingKey || (!!act && !speaking && now - act.at < REPLY_WINDOW_MS && dismissed !== act.at))
  const replyKey = t.talkingKey || act?.key || null
  // Bouton permanent : Garde de nuit par défaut, sinon le dernier canal actif récent.
  const fabKey = t.talkingKey
    || (t.lastActivity && now - t.lastActivity.at < RECENT_MS ? t.lastActivity.key : null)
    || t.channels.find(c => c.kind === 'garde')?.key || t.channels[0].key
  const fabDown = () => {
    holdRef.current = { talking: false, timer: setTimeout(() => { if (holdRef.current) { holdRef.current.talking = true; setFabTalking(true); t.startTalking(fabKey) } }, HOLD_MS) }
  }
  const fabUp = () => {
    const h = holdRef.current; holdRef.current = null
    if (!h) return
    clearTimeout(h.timer)
    if (h.talking) { t.stopTalking(true); setFabTalking(false) }
    else router.push(`/talkie?c=${encodeURIComponent(fabKey)}`)
  }

  return (
    <>
      {speaking && (
        <button type="button" onClick={() => { if (!t.audioOn) t.enableAudio() }}
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          className="fixed left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] min-h-[44px] px-4 rounded-full bg-green-600 text-white text-sm font-semibold shadow-lg flex items-center gap-2">
          <span aria-hidden>🔊</span>
          <span className="truncate">{speaking[1].name} parle · {label(speaking[0])}</span>
          {!t.audioOn && <span className="underline flex-shrink-0">Touche pour entendre</span>}
        </button>
      )}
      {showReply && replyKey && (
        <div style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }} className="fixed right-3 z-[60] flex items-center gap-2">
          {!t.talkingKey && act && (
            <button type="button" onClick={() => setDismissed(act.at)} aria-label="Fermer"
              className="w-11 h-11 rounded-full bg-surface border border-slate-300 dark:border-slate-600 text-ink shadow">✕</button>
          )}
          <button type="button"
            onPointerDown={e => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignoré */ } t.startTalking(replyKey) }}
            onPointerUp={() => t.stopTalking(true)} onPointerCancel={() => t.stopTalking(true)}
            onContextMenu={e => e.preventDefault()}
            style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as any}
            className={`min-h-[56px] px-5 rounded-full text-white font-bold text-sm shadow-lg select-none ${t.talkingKey ? 'bg-red-600' : 'bg-brand'}`}>
            {t.talkingKey ? '🔴 Relâche pour finir' : `🎙️ Maintiens pour répondre${act ? ` à ${act.name}` : ''}`}
          </button>
          {!t.talkingKey && (
            <Link href={`/talkie?c=${encodeURIComponent(replyKey)}`} className="w-11 h-11 rounded-full bg-surface border border-slate-300 dark:border-slate-600 shadow flex items-center justify-center" aria-label="Ouvrir le talkie">📻</Link>
          )}
        </div>
      )}
      {(fabTalking || (!showReply && !speaking)) && (
        <div style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }} className="fixed right-3 z-[60] flex items-center gap-2">
          <span className={`${fabTalking ? 'inline' : 'hidden sm:inline'} text-[11px] text-ink-muted bg-surface/90 border border-slate-200 dark:border-slate-700 rounded-full px-2 py-0.5`}>{fabTalking ? '🔴' : '📻'} {label(fabKey)}</span>
          <button type="button" aria-label={`Talkie : maintenir pour parler sur ${label(fabKey)}, toucher pour ouvrir`}
            onPointerDown={e => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignoré */ } fabDown() }} onPointerUp={fabUp} onPointerCancel={fabUp}
            onContextMenu={e => e.preventDefault()}
            style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as any}
            className={`w-14 h-14 rounded-full text-white text-2xl shadow-lg flex items-center justify-center select-none ${fabTalking ? 'bg-red-600 scale-110' : 'bg-brand'}`}>{fabTalking ? '🎙️' : '📻'}</button>
        </div>
      )}
      {t.error && (
        <button type="button" onClick={t.clearError} style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 150px)' }}
          className="fixed right-3 z-[60] max-w-[80vw] px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/15 border border-red-200 text-red-800 dark:text-red-200 text-xs text-left shadow">
          ⚠️ {t.error} (✕)
        </button>
      )}
    </>
  )
}
