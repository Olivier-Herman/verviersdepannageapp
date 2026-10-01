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
//    Étape 2 : LiveKit sur le VPS (Opus, UDP) pour la qualité d'un appel.
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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { RATE, MAX_TALK_MS, muEncode, muDecode, downsample, toB64, fromB64, wav } from '@/lib/talkie/codec'

export interface TalkieMember { id: string; name: string }
export interface TalkieChannel { key: string; kind: 'garde' | 'direct'; label: string; channel: string; members: TalkieMember[] }
export interface TalkieActivity { key: string; id: string; name: string; at: number }

interface TalkieCtx {
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

  const sb = useMemo(() => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!), [])
  const ctxRef    = useRef<AudioContext | null>(null)
  const chansRef  = useRef<Map<string, any>>(new Map())
  const nextRef   = useRef<Map<string, number>>(new Map())
  const floorRef  = useRef<Map<string, { id: string; ts: number; last: number }>>(new Map())
  const onlineRef = useRef<Record<string, TalkieMember[]>>({})
  const meRef     = useRef<TalkieMember | null>(null)
  const talkRef   = useRef<{ key: string; ts: number; stream: MediaStream | null; proc: ScriptProcessorNode | null; src: MediaStreamAudioSourceNode | null; rec: Float32Array[]; seq: number; timer: any } | null>(null)

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
    const h = () => { if (!ctxRef.current || ctxRef.current.state !== 'running') enableAudio() }
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
    t.stream?.getTracks().forEach(tr => tr.stop())
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
        nextRef.current.set(c.key, 0)
        setLastActivity({ key: c.key, id: payload.id, name: payload.name, at: Date.now() })
        if (!talkRef.current) { audioSession('playback'); ensureRunning() }
        beep(880)
      })
      ch.on('broadcast', { event: 'a' }, ({ payload }: any) => {
        const f = floorRef.current.get(c.key); if (f) f.last = Date.now()
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
      for (const [k, f] of floorRef.current) if (f.id !== myId && Date.now() - f.last > 4000) { floorRef.current.delete(k); setFloorFor(k, null) }
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
    const state = { key, ts, stream: null as MediaStream | null, proc: null as ScriptProcessorNode | null, src: null as MediaStreamAudioSourceNode | null, rec: [] as Float32Array[], seq: 0, timer: setTimeout(() => stopTalking(true), MAX_TALK_MS) }
    talkRef.current = state
    setTalkingKey(key); setError(null)
    floorRef.current.set(key, { id: myId, ts, last: Date.now() })
    setFloorFor(key, { id: myId, name: myName || '' })
    ch.send({ type: 'broadcast', event: 'start', payload: { id: myId, name: myName, ts } })
    beep(1200, 70)
    audioSession('play-and-record')
    // Prévenir tout de suite ceux qui n'ont pas l'app à l'écran (« X parle en ce moment »).
    fetch('/api/talkie/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, online: (onlineRef.current[key] || []).map(p => p.id) }) }).catch(() => {})
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (talkRef.current !== state) { stream.getTracks().forEach(tr => tr.stop()); audioSession('playback'); return }   // relâché avant l'ouverture du micro
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
    me, channels, audioOn, enableAudio, online, floor, talkingKey, startTalking, stopTalking,
    lastActivity, msgsVersion, error, clearError: () => setError(null),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
