'use client'
// src/components/talkie/TalkieProvider.tsx
//
// Moteur du talkie pour TOUTE l'app (Olivier 30/09/2026) : dès que l'app est ouverte,
// sur n'importe quelle page, l'utilisateur écoute ses canaux (Garde de nuit, direct
// Mobi / IT) et entend la voix en direct ; le bandeau TalkieOverlay permet de
// répondre sans ouvrir l'écran du talkie. Monté dans Providers (racine) : la
// connexion ne coupe pas en changeant de page. L'écran /talkie utilise ce même
// moteur (pas de double connexion).
//  - Voix : Supabase Realtime (diffusion), 16 kHz loi µ, morceaux ≈ 170 ms, réserve
//    d'écoute ≈ 350 ms (moins de coupures en 4G) ; rien n'est envoyé pendant une
//    reconnexion (sinon chaque morceau part en requête web, en retard et en désordre).
//  - Voix PRIORITAIREMENT par LiveKit (serveur vocal sur le VPS, Opus/WebRTC : qualité
//    d'un appel) — Olivier 01/10/2026. Les morceaux Supabase continuent en parallèle
//    comme filet : un auditeur connecté à LiveKit les ignore quand l'orateur parle sur
//    LiveKit ; sans LiveKit (jeton refusé, réseau…), tout passe par Supabase comme avant.
//  - Micro ouvert seulement pendant l'appui (sur iPhone, un micro ouvert en continu
//    envoie le son dans l'écouteur au lieu du haut-parleur).
//  - Le son ne peut démarrer qu'après un geste : le premier toucher dans l'app active
//    l'audio (sinon le bandeau propose « Toucher pour entendre »).
//  - Présence : « connecté » = app ouverte À L'ÉCRAN → pas de notif pour lui, il entend
//    en direct. App en arrière-plan : on se retire tout de suite de la présence (sinon
//    l'iPhone garde la connexion et personne ne reçoit de notif — constaté le 30/09).
//  - Haut-parleur : l'API « audio session » de WebKit — « playback » (haut-parleur)
//    en écoute, « play-and-record » seulement pendant l'appui ; sans elle, après une
//    prise de parole l'iPhone restait sur l'écouteur. Changer de mode peut mettre le
//    son de l'app en pause (« interrompu ») : on le relance aussitôt, à chaque
//    réception, et au moindre toucher ; l'état réel est suivi (bandeau « Touche
//    pour entendre »).
//  - Téléphone verrouillé / app fermée (Olivier 01/10/2026) : sur l'app iPhone qui a le
//    module natif « TalkiePTT » (cadre Push to Talk d'Apple), la page lui confie les
//    accès au serveur vocal de chaque canal ; le serveur réveille le téléphone quand
//    quelqu'un parle et iOS fait entendre la voix. App en arrière-plan avec ce module :
//    la page se déconnecte du serveur vocal (sinon double son, c'est le natif qui joue).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { RATE, MAX_TALK_MS, muEncode, muDecode, downsample, toB64, fromB64, wav } from '@/lib/talkie/codec'
import { talkiePttAvailable, talkiePtt } from '@/lib/native/talkiePtt'

export interface TalkieMember { id: string; name: string }
export interface TalkieChannel { key: string; kind: 'garde' | 'direct'; label: string; channel: string; members: TalkieMember[] }
export interface TalkieActivity { key: string; id: string; name: string; at: number }

interface TalkieCtx {
  /** Canal par défaut (la garde la nuit, sinon un canal direct) — choisi par le serveur. */
  primaryKey: string | null
  me: TalkieMember | null
  channels: TalkieChannel[]
  audioOn: boolean
  enableAudio: () => Promise<void>
  online: Record<string, TalkieMember[]>
  floor: Record<string, { id: string; name: string } | null>
  talkingKey: string | null
  startTalking: (key: string) => Promise<void>
  stopTalking: (save?: boolean) => void
  lastActivity: TalkieActivity | null
  msgsVersion: number
  error: string | null
  clearError: () => void
}

const Ctx = createContext<TalkieCtx | null>(null)
export const useTalkie = () => useContext(Ctx)

/** Sortie audio iPhone : 'playback' = haut-parleur, 'play-and-record' = micro ouvert. */
function audioSession(type: 'playback' | 'play-and-record') {
  try { const a = (navigator as any).audioSession; if (a && a.type !== type) a.type = type } catch { /* navigateur sans cette API */ }
}

const PUBLIC = [/^\/site/, /^\/login/, /^\/garage/, /^\/caisse\/ecran/, /^\/expert/]

export default function TalkieProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const pathname = usePathname() || ''
  const enabled = status === 'authenticated' && !PUBLIC.some(r => r.test(pathname))

  const [me, setMe]             = useState<TalkieMember | null>(null)
  const [channels, setChannels] = useState<TalkieChannel[]>([])
  const [audioOn, setAudioOn]   = useState(false)
  const [online, setOnline]     = useState<Record<string, TalkieMember[]>>({})
  const [floor, setFloor]       = useState<Record<string, { id: string; name: string } | null>>({})
  const [talkingKey, setTalkingKey] = useState<string | null>(null)
  const [lastActivity, setLastActivity] = useState<TalkieActivity | null>(null)
  const [msgsVersion, setMsgsVersion]   = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [chLoaded, setChLoaded] = useState(false)   // canaux chargés au moins une fois
  const [lkPaused, setLkPaused] = useState(false)   // app en arrière-plan, le natif prend le relais

  const sb = useMemo(() => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!), [])
  const ctxRef    = useRef<AudioContext | null>(null)
  const chansRef  = useRef<Map<string, any>>(new Map())
  const nextRef   = useRef<Map<string, number>>(new Map())
  const floorRef  = useRef<Map<string, { id: string; ts: number; last: number; lk?: boolean }>>(new Map())   // lk : parole depuis l'écran verrouillé (iPhone)
  const onlineRef = useRef<Record<string, TalkieMember[]>>({})
  const meRef     = useRef<TalkieMember | null>(null)
  const talkRef   = useRef<{ key: string; ts: number; stream: MediaStream | null; proc: ScriptProcessorNode | null; src: MediaStreamAudioSourceNode | null; rec: Float32Array[]; seq: number; timer: any; lk: any | null } | null>(null)
  const lkRef     = useRef<Map<string, any>>(new Map())      // salles LiveKit par canal
  const lkModRef  = useRef<any>(null)                        // module livekit-client (chargé à la demande)
  const speakerLkRef = useRef<Map<string, boolean>>(new Map()) // l'orateur du canal parle-t-il sur LiveKit ?
  const lkConnected = (key: string) => lkRef.current.get(key)?.state === 'connected'
  const pttReadyRef = useRef(false)                          // module talkie natif présent et canal système rejoint
  const pttKeysRef  = useRef<string[]>([])
  const [primaryKey, setPrimaryKey] = useState<string | null>(null)   // canal du bouton de l'écran verrouillé (serveur)

  // ── Canaux accessibles (rechargés toutes les 2 min : le talkie des chauffeurs
  //    s'ouvre à 18 h et se ferme à 8 h) ──
  useEffect(() => {
    if (!enabled) return
    let stop = false
    const load = () => fetch('/api/talkie/session', { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (stop) return
      meRef.current = j?.me || null; setMe(j?.me || null)
      const list: TalkieChannel[] = Array.isArray(j?.channels) ? j.channels : []
      setChannels(prev => JSON.stringify(prev.map(c => c.channel)) === JSON.stringify(list.map(c => c.channel)) ? prev : list)
      setPrimaryKey(j?.primaryKey || null)
      setChLoaded(true)
    }).catch(() => {})
    load()
    const t = setInterval(load, 2 * 60_000)
    return () => { stop = true; clearInterval(t) }
  }, [enabled])

  // ── Audio : le premier toucher dans l'app l'active ──
  const enableAudio = useCallback(async () => {
    try {
      if (!talkRef.current) audioSession('playback')
      if (!ctxRef.current) {
        const C = (window as any).AudioContext || (window as any).webkitAudioContext
        const ctx: AudioContext = new C()
        ctx.onstatechange = () => setAudioOn(ctx.state === 'running')   // pause iPhone (« interrupted ») visible
        ctxRef.current = ctx
      }
      if (ctxRef.current!.state !== 'running') await ctxRef.current!.resume()
      setAudioOn(ctxRef.current!.state === 'running')
    } catch { /* pas d'audio sur cet appareil */ }
  }, [])
  /** Relance le son s'il a été mis en pause (changement de mode audio, appel, Siri…). */
  const ensureRunning = useCallback(() => {
    const ctx = ctxRef.current
    if (ctx && ctx.state !== 'running') ctx.resume().then(() => setAudioOn(ctx.state === 'running')).catch(() => {})
  }, [])
  useEffect(() => {
    if (!channels.length) return
    // À l'ouverture : on tente d'activer le son sans attendre de toucher (l'app iPhone
    // l'autorise souvent) ; sinon le premier toucher l'active (bouton 🔇 en attendant).
    enableAudio()
  }, [channels.length, enableAudio])
  useEffect(() => {
    if (!channels.length) return
    // Chaque toucher relance le son s'il est en pause (le premier toucher l'active).
    const h = () => {
      if (!ctxRef.current || ctxRef.current.state !== 'running') enableAudio()
      for (const r of lkRef.current.values()) if (r && !r.canPlaybackAudio) r.startAudio().catch(() => {})   // lecture LiveKit (autorisée après un geste)
    }
    document.addEventListener('pointerdown', h, { capture: true })
    return () => document.removeEventListener('pointerdown', h, { capture: true } as any)
  }, [channels.length, enableAudio])

  const beep = useCallback((freq: number, ms = 90) => {
    const ctx = ctxRef.current; if (!ctx || ctx.state !== 'running') return
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = freq; g.gain.value = 0.08
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms / 1000)
  }, [])

  const setFloorFor = (key: string, v: { id: string; name: string } | null) => setFloor(f => ({ ...f, [key]: v }))

  // ── Fin de prise de parole (et enregistrement) ──
  const stopTalking = useCallback((save = true) => {
    const t = talkRef.current
    setTalkingKey(null)
    if (!t) return
    talkRef.current = null
    clearTimeout(t.timer)
    try { t.proc?.disconnect(); t.src?.disconnect() } catch { /* déjà débranché */ }
    if (t.lk) {
      // Micro LiveKit dépublié ET arrêté : l'iPhone repasse sur le haut-parleur.
      const pub = t.lk.localParticipant?.getTrackPublication?.(lkModRef.current?.Track?.Source?.Microphone)
      if (pub?.track) t.lk.localParticipant.unpublishTrack(pub.track, true).catch(() => {})
    } else t.stream?.getTracks().forEach(tr => tr.stop())
    setTimeout(() => { if (!talkRef.current) { audioSession('playback'); setTimeout(ensureRunning, 120) } }, 150)   // retour au haut-parleur, son relancé
    const ch = chansRef.current.get(t.key)
    const myId = meRef.current?.id
    ch?.send({ type: 'broadcast', event: 'end', payload: { id: myId } })
    if (floorRef.current.get(t.key)?.id === myId) { floorRef.current.delete(t.key); setFloorFor(t.key, null) }
    if (!save) return
    const ms = Math.round(t.rec.reduce((a, c) => a + c.length, 0) / RATE * 1000)
    if (ms < 400) return   // appui trop court : rien à garder
    const fd = new FormData()
    fd.append('key', t.key); fd.append('audio', wav(t.rec), 'talkie.wav'); fd.append('durationMs', String(ms))
    fd.append('online', (onlineRef.current[t.key] || []).map(p => p.id).join(','))
    fetch('/api/talkie/messages', { method: 'POST', body: fd }).then(() => setMsgsVersion(v => v + 1)).catch(() => setError('Message non enregistré (réseau).'))
  }, [ensureRunning])

  // ── Connexion aux canaux ──
  useEffect(() => {
    if (!enabled || !channels.length || !meRef.current) return
    const myId = meRef.current.id, myName = meRef.current.name
    const subs: any[] = []
    for (const c of channels) {
      const ch = sb.channel(c.channel, { config: { broadcast: { self: false, ack: false }, presence: { key: myId } } })
      chansRef.current.set(c.key, ch)
      ch.on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState() as Record<string, any[]>
        const list = Object.values(st).flat().map((p: any) => ({ id: p.id, name: p.name })).filter((p, i, a) => p.id && a.findIndex(x => x.id === p.id) === i)
        onlineRef.current = { ...onlineRef.current, [c.key]: list }
        setOnline(o => ({ ...o, [c.key]: list }))
      })
      ch.on('broadcast', { event: 'start' }, ({ payload }: any) => {
        const mine = talkRef.current
        // Deux appuis en même temps : le premier arrivé garde la parole.
        if (mine && mine.key === c.key && (payload.ts < mine.ts || (payload.ts === mine.ts && payload.id < myId))) stopTalking(false)
        floorRef.current.set(c.key, { id: payload.id, ts: payload.ts, last: Date.now() })
        setFloorFor(c.key, { id: payload.id, name: payload.name })
        speakerLkRef.current.set(c.key, !!payload.lk)
        nextRef.current.set(c.key, 0)
        setLastActivity({ key: c.key, id: payload.id, name: payload.name, at: Date.now() })
        if (!talkRef.current) { audioSession('playback'); ensureRunning() }
        beep(880)
      })
      ch.on('broadcast', { event: 'a' }, ({ payload }: any) => {
        const f = floorRef.current.get(c.key); if (f) f.last = Date.now()
        if (speakerLkRef.current.get(c.key) && lkConnected(c.key)) return   // déjà entendu par LiveKit
        if (pttReadyRef.current && document.visibilityState !== 'visible') return   // arrière-plan : le module iPhone joue la voix
        const ctx = ctxRef.current; if (!ctx) return
        if (ctx.state !== 'running') { ensureRunning(); return }
        const f32 = muDecode(fromB64(payload.d))
        const buf = ctx.createBuffer(1, f32.length, RATE); buf.getChannelData(0).set(f32)
        const node = ctx.createBufferSource(); node.buffer = buf; node.connect(ctx.destination)
        // Réserve d'écoute : on démarre 350 ms en avance ; si le réseau a pris du retard
        // (plus de son en réserve), on reprend proprement avec la même avance.
        const queued = nextRef.current.get(c.key) || 0
        const t = queued > ctx.currentTime + 0.03 ? queued : ctx.currentTime + 0.35
        node.start(t); nextRef.current.set(c.key, t + buf.duration)
      })
      ch.on('broadcast', { event: 'end' }, ({ payload }: any) => {
        if (floorRef.current.get(c.key)?.id === payload.id) { floorRef.current.delete(c.key); setFloorFor(c.key, null) }
        setLastActivity(a => a && a.key === c.key ? { ...a, at: Date.now() } : a)
        beep(660, 70)
        setTimeout(() => setMsgsVersion(v => v + 1), 2500)
      })
      ch.subscribe(async (s: string) => { if (s === 'SUBSCRIBED' && document.visibilityState === 'visible') await ch.track({ id: myId, name: myName }) })
      subs.push(ch)
    }
    // App en arrière-plan → plus « connecté » (les autres m'envoient une notif) ;
    // retour à l'écran → de nouveau connecté, et le son est relancé.
    const onVis = () => {
      const visible = document.visibilityState === 'visible'
      for (const ch of subs) { try { visible ? ch.track({ id: myId, name: myName }) : ch.untrack() } catch { /* canal en reconnexion */ } }
      if (visible && ctxRef.current) ctxRef.current.resume().then(() => setAudioOn(ctxRef.current?.state === 'running')).catch(() => {})
      if (!visible && talkRef.current) stopTalking(true)
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onVis)
    // Présence côté serveur (c'est elle qui décide des notifs) : signal toutes les 10 s
    // tant que l'app est à l'écran ; « je pars » en quittant l'écran (sendBeacon part
    // même pendant la mise en arrière-plan). SEUL un téléphone compte : un ordinateur
    // resté ouvert sur VD Soft (même compte) ne doit pas empêcher la notif sur le
    // téléphone (Olivier 30/09/2026 : « j'ai des PC connectés en même temps »).
    const isPhone = /VDNav\//.test(navigator.userAgent) || /iPhone|iPad|Android/i.test(navigator.userAgent)
    const beat = () => { if (isPhone && document.visibilityState === 'visible') fetch('/api/talkie/presence', { method: 'POST', body: JSON.stringify({ visible: true }), keepalive: true }).catch(() => {}) }
    const away = () => { if (!isPhone) return; if (document.visibilityState !== 'visible') { try { navigator.sendBeacon?.('/api/talkie/presence', JSON.stringify({ visible: false })) } catch { /* rien */ } } else beat() }
    beat()
    const beatTimer = setInterval(beat, 10_000)
    document.addEventListener('visibilitychange', away)
    window.addEventListener('pagehide', away)
    // Parole « coincée » (fin perdue) : libérée au bout de 4 s sans son.
    const guard = setInterval(() => {
      // Parole depuis l'écran verrouillé (pas de morceaux Supabase) : libérée à la fin
      // de la piste du serveur vocal, ou au plus tard après la durée maximale.
      for (const [k, f] of floorRef.current) if (f.id !== myId && Date.now() - f.last > (f.lk ? MAX_TALK_MS + 5000 : 4000)) { floorRef.current.delete(k); setFloorFor(k, null) }
    }, 1000)
    return () => {
      clearInterval(guard)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onVis)
      clearInterval(beatTimer)
      document.removeEventListener('visibilitychange', away)
      window.removeEventListener('pagehide', away)
      if (talkRef.current) stopTalking(true)
      for (const ch of subs) sb.removeChannel(ch)
      chansRef.current.clear(); floorRef.current.clear(); onlineRef.current = {}
      setOnline({}); setFloor({})
    }
  }, [enabled, channels, sb, beep, stopTalking, ensureRunning])

  // ── Serveur vocal LiveKit : une salle par canal (repli Supabase si indisponible) ──
  useEffect(() => {
    if (!enabled || !channels.length || !meRef.current || lkPaused) return
    let stop = false
    const rooms: any[] = []
    ;(async () => {
      try {
        const LK = lkModRef.current || (lkModRef.current = await import('livekit-client'))
        for (const c of channels) {
          if (stop) break
          try {
            const r = await fetch(`/api/talkie/token?key=${encodeURIComponent(c.key)}`, { cache: 'no-store' })
            if (!r.ok) continue   // serveur vocal non configuré : Supabase seul
            const { url, token } = await r.json()
            const room = new LK.Room({ adaptiveStream: false, dynacast: false, stopLocalTrackOnUnpublish: true })
            // Orateur sur l'écran verrouillé de son iPhone (identité « …#ptt ») : il
            // n'envoie pas « je parle » par Supabase → la parole se déduit de sa piste.
            const nativeSpeaker = (p: any) => String(p?.identity || '').endsWith('#ptt') ? { id: String(p.identity).split('#')[0], name: String(p.name || '') } : null
            const nativeEnd = (p: any) => {
              const sp = nativeSpeaker(p); const f = floorRef.current.get(c.key)
              if (!sp || !f?.lk || f.id !== sp.id) return
              floorRef.current.delete(c.key); setFloorFor(c.key, null)
              setLastActivity(a => a && a.key === c.key ? { ...a, at: Date.now() } : a)
              beep(660, 70)
            }
            room.on(LK.RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => {
              if (track.kind !== 'audio') return
              const el = track.attach() as HTMLMediaElement
              el.setAttribute('playsinline', 'true'); el.style.display = 'none'
              document.body.appendChild(el)
              if (!talkRef.current) audioSession('playback')
              const sp = nativeSpeaker(participant)
              if (sp && !floorRef.current.get(c.key)) {
                floorRef.current.set(c.key, { id: sp.id, ts: Date.now(), last: Date.now(), lk: true })
                setFloorFor(c.key, sp)
                setLastActivity({ key: c.key, id: sp.id, name: sp.name, at: Date.now() })
                beep(880)
              }
            })
            room.on(LK.RoomEvent.TrackUnsubscribed, (track: any, _pub: any, participant: any) => { track.detach().forEach((el: HTMLElement) => el.remove()); nativeEnd(participant) })
            room.on(LK.RoomEvent.ParticipantDisconnected, (participant: any) => nativeEnd(participant))
            await room.connect(url, token, { autoSubscribe: true })
            if (stop) { room.disconnect(); break }
            rooms.push(room); lkRef.current.set(c.key, room)
            room.startAudio().catch(() => {})
          } catch (e: any) {
            console.warn('[talkie] LiveKit indisponible pour', c.key, '→ voix par Supabase', e?.message)
          }
        }
      } catch (e: any) { console.warn('[talkie] module LiveKit non chargé', e?.message) }
    })()
    return () => {
      stop = true
      for (const r of rooms) { try { r.disconnect() } catch { /* déjà fermée */ } }
      lkRef.current.clear(); speakerLkRef.current.clear()
    }
  }, [enabled, channels, lkPaused, beep])

  // ── Talkie téléphone verrouillé : module iPhone natif « TalkiePTT » ──
  // La page lui confie les accès au serveur vocal de chaque canal (identité « …#ptt »,
  // renouvelés toutes les heures ; jetons valables 6 h) et remet au serveur le jeton
  // de réveil du téléphone. Fin de la nuit (plus de canal) → canal système quitté.
  useEffect(() => {
    if (!enabled || !chLoaded) return
    let stop = false, refresh: any = null
    const subs: { remove: () => void }[] = []
    const sendToken = (token?: string | null) => {
      if (!token || stop) return
      fetch('/api/talkie/ptt-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, keys: pttKeysRef.current }) }).catch(() => {})
    }
    ;(async () => {
      if (!(await talkiePttAvailable()) || stop) return
      const p = talkiePtt(); if (!p) return
      p.addListener('pttToken', ({ token }) => sendToken(token)).then(s => { if (stop) s.remove(); else subs.push(s) }).catch(() => {})
      const sync = async () => {
        const want = channels.map(c => c.key)
        const primary = primaryKey && want.includes(primaryKey) ? primaryKey : want.includes('garde') ? 'garde' : want[0]   // la garde la nuit, sinon un canal direct
        const st = await p.getState().catch(() => null)
        for (const k of st?.keys || []) if (!want.includes(k)) await p.leave({ key: k }).catch(() => {})
        for (const c of channels) {
          if (stop) return
          const r = await fetch(`/api/talkie/token?key=${encodeURIComponent(c.key)}&native=1`, { cache: 'no-store' }).catch(() => null)
          if (!r?.ok) continue
          const { url, token } = await r.json()
          await p.join({ key: c.key, name: c.label, url, token, primary: c.key === primary }).catch(() => {})
        }
        if (stop) return
        if (primary) p.setActive({ key: primary }).catch(() => {})
        pttKeysRef.current = want
        const now = await p.getState().catch(() => null)
        pttReadyRef.current = !!now?.joined
        sendToken(now?.pttToken)
      }
      await sync()
      refresh = setInterval(sync, 60 * 60_000)
    })()
    return () => { stop = true; clearInterval(refresh); subs.forEach(s => { try { s.remove() } catch { /* déjà retiré */ } }) }
  }, [enabled, chLoaded, channels, primaryKey])

  // App en arrière-plan avec le module natif : la page se retire du serveur vocal.
  useEffect(() => {
    const h = () => setLkPaused(pttReadyRef.current && document.visibilityState !== 'visible')
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [])

  // ── Prise de parole ──
  const startTalking = useCallback(async (key: string) => {
    const ch = chansRef.current.get(key)
    const myId = meRef.current?.id, myName = meRef.current?.name
    if (!ch || !myId || talkRef.current) return
    const f = floorRef.current.get(key)
    if (f && f.id !== myId) { navigator.vibrate?.(120); return }
    await enableAudio()
    const ctx = ctxRef.current
    if (!ctx) { setError('Le son n’a pas pu démarrer sur ce téléphone.'); return }
    const ts = Date.now()
    const room = lkConnected(key) ? lkRef.current.get(key) : null
    const state = { key, ts, stream: null as MediaStream | null, proc: null as ScriptProcessorNode | null, src: null as MediaStreamAudioSourceNode | null, rec: [] as Float32Array[], seq: 0, timer: setTimeout(() => stopTalking(true), MAX_TALK_MS), lk: room as any }
    talkRef.current = state
    setTalkingKey(key); setError(null)
    floorRef.current.set(key, { id: myId, ts, last: Date.now() })
    setFloorFor(key, { id: myId, name: myName || '' })
    ch.send({ type: 'broadcast', event: 'start', payload: { id: myId, name: myName, ts, lk: !!room } })
    beep(1200, 70)
    audioSession('play-and-record')
    // Prévenir tout de suite ceux qui n'ont pas l'app à l'écran (« X parle en ce moment »).
    fetch('/api/talkie/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, online: (onlineRef.current[key] || []).map(p => p.id) }) }).catch(() => {})
    try {
      let stream: MediaStream
      if (room) {
        // LiveKit : publication du micro (Opus) ; on enregistre depuis la même piste.
        await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true })
        const pub = room.localParticipant.getTrackPublication(lkModRef.current.Track.Source.Microphone)
        const mst: MediaStreamTrack | undefined = pub?.track?.mediaStreamTrack
        if (!mst) throw new Error('micro LiveKit indisponible')
        stream = new MediaStream([mst])
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      }
      if (talkRef.current !== state) {   // relâché avant l'ouverture du micro
        if (room) { const pub = room.localParticipant.getTrackPublication(lkModRef.current.Track.Source.Microphone); if (pub?.track) room.localParticipant.unpublishTrack(pub.track, true).catch(() => {}) }
        else stream.getTracks().forEach(tr => tr.stop())
        audioSession('playback'); return
      }
      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(8192, 1, 1)   // ≈ 170 ms : moitié moins d'envois
      proc.onaudioprocess = (e) => {
        if (talkRef.current !== state) return
        const down = downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate)
        state.rec.push(down)
        if ((ch as any).state !== 'joined') return   // en reconnexion : pas d'envoi (pas de repli en requêtes web)
        ch.send({ type: 'broadcast', event: 'a', payload: { s: state.seq++, d: toB64(muEncode(down)) } })
      }
      src.connect(proc); proc.connect(ctx.destination)
      state.stream = stream; state.src = src; state.proc = proc
      ensureRunning()
    } catch {
      stopTalking(false)
      setError('Micro indisponible : autorise le micro pour l’app dans les réglages du téléphone.')
    }
  }, [beep, enableAudio, stopTalking, ensureRunning])

  const value: TalkieCtx = {
    me, channels, primaryKey, audioOn, enableAudio, online, floor, talkingKey, startTalking, stopTalking,
    lastActivity, msgsVersion, error, clearError: () => setError(null),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
