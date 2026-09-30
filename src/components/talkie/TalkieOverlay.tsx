'use client'
// Bandeau du talkie sur toutes les pages (sauf l'écran /talkie) — Olivier 30/09/2026 :
//  - quelqu'un parle : « 🔊 Franck parle · Garde de nuit » en haut (toucher pour
//    entendre si le son n'est pas encore activé) ;
//  - juste après : bouton « Maintiens pour répondre » pendant 45 s, sans ouvrir le talkie.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTalkie } from './TalkieProvider'

const REPLY_WINDOW_MS = 45_000

export default function TalkieOverlay() {
  const t = useTalkie()
  const pathname = usePathname() || ''
  const [now, setNow] = useState(Date.now())
  const [dismissed, setDismissed] = useState<number | null>(null)
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  if (!t || !t.me || !t.channels.length || pathname.startsWith('/talkie')) return null

  const label = (key: string) => { const c = t.channels.find(x => x.key === key); return !c ? '' : c.kind === 'garde' ? 'Garde de nuit' : c.label }
  const speaking = Object.entries(t.floor).find(([, f]) => f && f.id !== t.me!.id) as [string, { id: string; name: string }] | undefined
  const act = t.lastActivity && t.lastActivity.id !== t.me.id ? t.lastActivity : null
  const showReply = !!t.talkingKey || (!!act && !speaking && now - act.at < REPLY_WINDOW_MS && dismissed !== act.at)
  const replyKey = t.talkingKey || act?.key || null

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
            onPointerDown={e => { e.preventDefault(); t.startTalking(replyKey) }}
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
      {t.error && (
        <button type="button" onClick={t.clearError} style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 150px)' }}
          className="fixed right-3 z-[60] max-w-[80vw] px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/15 border border-red-200 text-red-800 dark:text-red-200 text-xs text-left shadow">
          ⚠️ {t.error} (✕)
        </button>
      )}
    </>
  )
}
