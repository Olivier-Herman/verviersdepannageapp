'use client'
// Écran du talkie (Olivier 30/09/2026) : onglets de canaux (Garde de nuit, direct
// Mobi / IT), qui est connecté, gros bouton « Maintiens pour parler », messages
// enregistrés. La connexion et le son sont gérés par le moteur commun à toute l'app
// (components/talkie/TalkieProvider) : on entend aussi le talkie sur les autres pages.

import { useEffect, useState } from 'react'
import { useTalkie, type TalkieChannel, type TalkieMember } from '@/components/talkie/TalkieProvider'

interface Msg { id: string; senderName: string; durationMs: number; at: string; url: string | null }

export default function TalkieClient({ me, channels: initialChannels, initialKey }: { me: TalkieMember; channels: TalkieChannel[]; initialKey: string }) {
  const t = useTalkie()
  const channels = t?.channels.length ? t.channels : initialChannels
  const [key, setKey] = useState(channels.some(c => c.key === initialKey) ? initialKey : channels[0].key)
  const current = channels.find(c => c.key === key) || channels[0]
  const [msgs, setMsgs] = useState<Msg[]>([])

  const online = t?.online[current.key] || []
  const floor  = t?.floor[current.key] || null
  const talking = t?.talkingKey === current.key
  const busy = !!floor && floor.id !== me.id

  useEffect(() => {
    let stop = false
    fetch(`/api/talkie/messages?key=${encodeURIComponent(current.key)}`, { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (!stop) setMsgs(j.messages || []) }).catch(() => {})
    return () => { stop = true }
  }, [current.key, t?.msgsVersion])

  // Écran allumé tant que l'écran du talkie est ouvert (si le téléphone l'autorise).
  useEffect(() => {
    let lock: any = null
    ;(navigator as any).wakeLock?.request?.('screen').then((l: any) => { lock = l }).catch(() => {})
    return () => { lock?.release?.().catch?.(() => {}) }
  }, [])

  const people = [...current.members, ...online.filter(o => !current.members.some(m => m.id === o.id))]

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <div>
        <h1 className="text-ink font-bold text-xl">📻 Talkie</h1>
        <p className="text-ink-muted text-sm mt-1">
          {current.kind === 'garde' ? `Garde de nuit : ${current.members.map(m => m.name).join(' et ')}.` : `Canal direct ${current.members[0]?.id === me.id ? `vers ${current.label}` : `avec ${current.label}`}.`}
          {' '}Tu entends aussi le talkie sur les autres pages de l’app.
        </p>
      </div>

      {channels.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {channels.map(c => {
            const live = t?.floor[c.key] && t.floor[c.key]!.id !== me.id
            return (
              <button key={c.key} type="button" onClick={() => { if (!t?.talkingKey) { setKey(c.key); setMsgs([]) } }}
                className={`flex-shrink-0 min-h-[40px] px-3 rounded-full text-sm font-semibold border ${c.key === current.key ? 'bg-brand text-white border-brand' : live ? 'bg-green-100 text-green-800 border-green-400 dark:bg-green-500/15 dark:text-green-300' : 'bg-surface text-ink border-slate-300 dark:border-slate-600'}`}>
                {live ? '🔊 ' : ''}{c.kind === 'garde' ? '🌙 Garde de nuit' : `👤 ${c.label}`}
              </button>
            )
          })}
        </div>
      )}

      {!t ? null : !t.audioOn ? (
        <button type="button" onClick={() => t.enableAudio()} className="w-full min-h-[64px] rounded-2xl bg-brand hover:bg-brand-hover text-white font-bold text-base">
          📻 Activer le talkie
        </button>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {people.map(m => {
              const on = online.some(o => o.id === m.id)
              return <span key={m.id} className={`px-2.5 py-1 rounded-full font-semibold ${on ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300'}`}>{on ? '🟢' : '⚪'} {m.name}{m.id === me.id ? ' (toi)' : ''}</span>
            })}
          </div>

          <div className="text-center text-sm font-semibold min-h-[20px]">
            {talking ? <span className="text-red-700 dark:text-red-300">🔴 Tu parles…</span>
              : floor ? <span className="text-green-700 dark:text-green-300">🔊 {floor.name} parle…</span>
              : <span className="text-ink-muted">Canal libre</span>}
          </div>

          <div className="flex justify-center">
            <button type="button"
              onPointerDown={e => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignoré */ } t.startTalking(current.key) }}
              onPointerUp={() => t.stopTalking(true)} onPointerCancel={() => t.stopTalking(true)}
              onContextMenu={e => e.preventDefault()}
              disabled={busy || (!!t.talkingKey && !talking)}
              style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as any}
              className={`w-52 h-52 rounded-full font-bold text-lg text-white shadow-lg transition-transform select-none ${talking ? 'bg-red-600 scale-95' : busy ? 'bg-slate-400' : 'bg-brand hover:bg-brand-hover'}`}>
              {talking ? 'Relâche pour finir' : busy ? 'Occupé' : 'Maintiens pour parler'}
            </button>
          </div>
        </>
      )}
      {t?.error && <p className="text-red-700 dark:text-red-300 text-sm bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2">⚠️ {t.error}</p>}

      <div className="bg-surface border rounded-2xl p-3 space-y-2">
        <p className="text-ink font-semibold text-sm">{current.kind === 'garde' ? 'Messages de la nuit' : 'Derniers messages'}</p>
        {!msgs.length ? <p className="text-ink-muted text-xs">Aucun message pour l’instant.</p> : msgs.map(m => (
          <div key={m.id} className="space-y-1">
            <p className="text-xs text-ink-secondary">{new Date(m.at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} · {m.senderName} · {Math.max(1, Math.round(m.durationMs / 1000))} s</p>
            {m.url && <audio controls preload="none" src={m.url} className="w-full h-9" />}
          </div>
        ))}
      </div>

      <p className="text-ink-faint text-[11px] text-center">Canal professionnel : les messages sont enregistrés.</p>
    </div>
  )
}
