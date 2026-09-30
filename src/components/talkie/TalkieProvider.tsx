'use client'
// src/components/talkie/TalkieProvider.tsx
//
// Moteur du talkie pour TOUTE l'app (Olivier 30/09/2026) : dès que l'app est ouverte,
// sur n'importe quelle page, l'utilisateur écoute ses canaux (Garde de nuit, direct
// Mobi / IT) et entend la voix en direct ; le bandeau TalkieOverlay permet de
// répondre sans ouvrir l'écran du talkie. Monté dans Providers (racine) : la
// connexion ne coupe pas en changeant de page. L'écran /talkie utilise ce même
// moteur (pas de double connexion).
//  - Voix : Supabase Realtime (diffusion), 16 kHz loi µ, morceaux ≈ 85 ms.
//  - Micro ouvert seulement pendant l'appui (sur iPhone, un micro ouvert en continu
//    envoie le son dans l'écouteur au lieu du haut-parleur).
//  - Le son ne peut démarrer qu'après un geste : le premier toucher dans l'app active
//    l'audio (sinon le bandeau propose « Toucher pour entendre »).
//  - Présence : « connecté » = app ouverte → pas de notif pour lui, il entend en direct.

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

  // ── Canaux accessibles (rechargés toutes les 10 min : la garde change à 18 h) ──
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
    const t = setInterval(load, 10 * 60_000)
    return () => { stop = true; clearInterval(t) }
  }, [enabled])

  // ── Audio : le premier toucher dans l'app l'active ──
  const enableAudio = useCallback(async () => {
    try {
      if (!ctxRef.current) {
        const C = (window as any).AudioContext || (window as any).webkitAudioContext
        ctxRef.current = new C()
      }
      await ctxRef.current!.resume()
      setAudioOn(ctxRef.current!.state === 'running')
    } catch { /* pas d'audio sur cet appareil */ }
  }, [])
  useEffect(() => {
    if (!channels.length) return
    const h = () => { enableAudio() }
    document.addEventListener('pointerdown', h, { once: true, capture: true })
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
  }, [])

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
        beep(880)
      })
      ch.on('broadcast', { event: 'a' }, ({ payload }: any) => {
        const f = floorRef.current.get(c.key); if (f) f.last = Date.now()
        const ctx = ctxRef.current; if (!ctx || ctx.state !== 'running') return
        const f32 = muDecode(fromB64(payload.d))
        const buf = ctx.createBuffer(1, f32.length, RATE); buf.getChannelData(0).set(f32)
        const node = ctx.createBufferSource(); node.buffer = buf; node.connect(ctx.destination)
        const t = Math.max(ctx.currentTime + 0.15, nextRef.current.get(c.key) || 0)
        node.start(t); nextRef.current.set(c.key, t + buf.duration)
      })
      ch.on('broadcast', { event: 'end' }, ({ payload }: any) => {
        if (floorRef.current.get(c.key)?.id === payload.id) { floorRef.current.delete(c.key); setFloorFor(c.key, null) }
        setLastActivity(a => a && a.key === c.key ? { ...a, at: Date.now() } : a)
        beep(660, 70)
        setTimeout(() => setMsgsVersion(v => v + 1), 2500)
      })
      ch.subscribe(async (s: string) => { if (s === 'SUBSCRIBED') await ch.track({ id: myId, name: myName }) })
      subs.push(ch)
    }
    // Parole « coincée » (fin perdue) : libérée au bout de 4 s sans son.
    const guard = setInterval(() => {
      for (const [k, f] of floorRef.current) if (f.id !== myId && Date.now() - f.last > 4000) { floorRef.current.delete(k); setFloorFor(k, null) }
    }, 1000)
    return () => {
      clearInterval(guard)
      if (talkRef.current) stopTalking(true)
      for (const ch of subs) sb.removeChannel(ch)
      chansRef.current.clear(); floorRef.current.clear(); onlineRef.current = {}
      setOnline({}); setFloor({})
    }
  }, [enabled, channels, sb, beep, stopTalking])

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (talkRef.current !== state) { stream.getTracks().forEach(tr => tr.stop()); return }   // relâché avant l'ouverture du micro
      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      proc.onaudioprocess = (e) => {
        if (talkRef.current !== state) return
        const down = downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate)
        state.rec.push(down)
        ch.send({ type: 'broadcast', event: 'a', payload: { s: state.seq++, d: toB64(muEncode(down)) } })
      }
      src.connect(proc); proc.connect(ctx.destination)
      state.stream = stream; state.src = src; state.proc = proc
    } catch {
      stopTalking(false)
      setError('Micro indisponible : autorise le micro pour l’app dans les réglages du téléphone.')
    }
  }, [beep, enableAudio, stopTalking])

  const value: TalkieCtx = {
    me, channels, audioOn, enableAudio, online, floor, talkingKey, startTalking, stopTalking,
    lastActivity, msgsVersion, error, clearError: () => setError(null),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
