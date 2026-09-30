'use client'
// Talkie « Garde de nuit » (Olivier 30/09/2026) : talkie-walkie en direct entre le
// 1er départ et la réserve de la nuit ; les superadmins écoutent sans apparaître.
//  - Maintenir le bouton pour parler, une seule personne à la fois (comme une radio).
//  - La voix part en direct par Supabase Realtime (diffusion) : 16 kHz, loi µ
//    (≈ 16 Ko/s), morceaux d'≈ 85 ms, rejoués avec un petit tampon.
//  - Micro ouvert seulement pendant l'appui : sur iPhone, un micro ouvert en continu
//    envoie le son dans l'écouteur au lieu du haut-parleur.
//  - Chaque prise de parole est aussi enregistrée (réécoute, notif si l'autre n'a
//    pas le talkie ouvert). Étape 2 à venir : réception écran verrouillé (app native).

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

interface Props {
  role: 'member' | 'listener'
  channel: string
  me: { id: string; name: string }
  members: { id: string; name: string }[]
}
interface Msg { id: string; senderName: string; durationMs: number; at: string; url: string | null }

const RATE = 16000
const MAX_TALK_MS = 60_000

// ── Loi µ (G.711) ─────────────────────────────────────────────────────────────
function muEncode(f32: Float32Array): Uint8Array {
  const out = new Uint8Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i])) * 32767
    const sign = s < 0 ? 0x80 : 0
    if (s < 0) s = -s
    s = Math.min(32635, s + 132)
    let exp = 7
    for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1) { /* cherche l'exposant */ }
    const mant = (s >> (exp + 3)) & 0x0f
    out[i] = ~(sign | (exp << 4) | mant) & 0xff
  }
  return out
}
function muDecode(u8: Uint8Array): Float32Array {
  const out = new Float32Array(u8.length)
  for (let i = 0; i < u8.length; i++) {
    const u = ~u8[i] & 0xff
    const sign = u & 0x80, exp = (u >> 4) & 0x07, mant = u & 0x0f
    let s = ((mant << 3) + 132) << exp
    s -= 132
    out[i] = (sign ? -s : s) / 32768
  }
  return out
}
function downsample(input: Float32Array, inRate: number): Float32Array {
  const ratio = inRate / RATE
  const len = Math.floor(input.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0; for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}
const toB64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s) }
const fromB64 = (b: string) => { const s = atob(b); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8 }
function wav(chunks: Float32Array[]): Blob {
  const n = chunks.reduce((a, c) => a + c.length, 0)
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  let o = 44
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}

export default function TalkieClient({ role, channel, me, members }: Props) {
  const [active, setActive]   = useState(false)
  const [online, setOnline]   = useState<{ id: string; name: string }[]>([])
  const [floor, setFloor]     = useState<{ id: string; name: string } | null>(null)
  const [talking, setTalking] = useState(false)
  const [msgs, setMsgs]       = useState<Msg[]>([])
  const [error, setError]     = useState<string | null>(null)

  const ctxRef   = useRef<AudioContext | null>(null)
  const chRef    = useRef<any>(null)
  const nextRef  = useRef(0)
  const floorRef = useRef<{ id: string; ts: number } | null>(null)
  const lastAudioRef = useRef(0)
  const talkRef  = useRef<{ ts: number; stream: MediaStream; proc: ScriptProcessorNode; src: MediaStreamAudioSourceNode; rec: Float32Array[]; seq: number; timer: any } | null>(null)
  const onlineRef = useRef<{ id: string; name: string }[]>([])
  const isMember = role === 'member'

  const beep = useCallback((freq: number, ms = 90) => {
    const ctx = ctxRef.current; if (!ctx) return
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = freq; g.gain.value = 0.08
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms / 1000)
  }, [])

  const loadMsgs = useCallback(async () => {
    try { const r = await fetch('/api/talkie/messages', { cache: 'no-store' }); const j = await r.json(); if (r.ok) setMsgs(j.messages || []) } catch { /* réessai au prochain message */ }
  }, [])

  // Connexion au canal (après « Activer » : le son ne peut démarrer qu'après un geste).
  useEffect(() => {
    if (!active) return
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const ch = sb.channel(channel, { config: { broadcast: { self: false, ack: false }, presence: { key: me.id } } })
    chRef.current = ch
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState() as Record<string, any[]>
      const list = Object.values(st).flat().map((p: any) => ({ id: p.id, name: p.name })).filter((p, i, a) => p.id && a.findIndex(x => x.id === p.id) === i)
      onlineRef.current = list; setOnline(list)
    })
    ch.on('broadcast', { event: 'start' }, ({ payload }: any) => {
      // Deux appuis en même temps : le premier arrivé garde la parole.
      const mine = talkRef.current
      if (mine && (payload.ts < mine.ts || (payload.ts === mine.ts && payload.id < me.id))) stopTalking(false)
      floorRef.current = { id: payload.id, ts: payload.ts }
      setFloor({ id: payload.id, name: payload.name })
      nextRef.current = 0; lastAudioRef.current = Date.now()
      beep(880)
    })
    ch.on('broadcast', { event: 'a' }, ({ payload }: any) => {
      const ctx = ctxRef.current; if (!ctx) return
      lastAudioRef.current = Date.now()
      const f32 = muDecode(fromB64(payload.d))
      const buf = ctx.createBuffer(1, f32.length, RATE); buf.getChannelData(0).set(f32)
      const node = ctx.createBufferSource(); node.buffer = buf; node.connect(ctx.destination)
      const t = Math.max(ctx.currentTime + 0.15, nextRef.current)
      node.start(t); nextRef.current = t + buf.duration
    })
    ch.on('broadcast', { event: 'end' }, ({ payload }: any) => {
      if (floorRef.current?.id === payload.id) { floorRef.current = null; setFloor(null) }
      beep(660, 70)
      setTimeout(loadMsgs, 2500)
    })
    ch.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED' && isMember) await ch.track({ id: me.id, name: me.name })   // les superadmins n'apparaissent pas
    })
    // Parole « coincée » (fin perdue) : on libère au bout de 4 s sans son.
    const guard = setInterval(() => { if (floorRef.current && Date.now() - lastAudioRef.current > 4000) { floorRef.current = null; setFloor(null) } }, 1000)
    let lock: any = null
    ;(navigator as any).wakeLock?.request?.('screen').then((l: any) => { lock = l }).catch(() => {})
    return () => { clearInterval(guard); lock?.release?.().catch?.(() => {}); sb.removeChannel(ch); chRef.current = null }
  }, [active, channel, me.id, me.name, isMember, beep, loadMsgs])

  useEffect(() => { loadMsgs() }, [loadMsgs])

  async function activate() {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx: AudioContext = new Ctx()
      await ctx.resume()
      ctxRef.current = ctx
      setActive(true); setError(null)
    } catch { setError('Le son n’a pas pu démarrer sur ce téléphone.') }
  }

  async function startTalking() {
    if (!isMember || talkRef.current || !chRef.current || !ctxRef.current) return
    if (floorRef.current && floorRef.current.id !== me.id) { navigator.vibrate?.(120); return }
    const ts = Date.now()
    setTalking(true); setError(null)
    chRef.current.send({ type: 'broadcast', event: 'start', payload: { id: me.id, name: me.name, ts } })
    beep(1200, 70)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      const ctx = ctxRef.current
      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      const state = { ts, stream, proc, src, rec: [] as Float32Array[], seq: 0, timer: setTimeout(() => stopTalking(true), MAX_TALK_MS) }
      proc.onaudioprocess = (e) => {
        if (talkRef.current !== state) return
        const down = downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate)
        state.rec.push(down)
        chRef.current?.send({ type: 'broadcast', event: 'a', payload: { s: state.seq++, d: toB64(muEncode(down)) } })
      }
      src.connect(proc); proc.connect(ctx.destination)
      talkRef.current = state
    } catch {
      setTalking(false)
      chRef.current?.send({ type: 'broadcast', event: 'end', payload: { id: me.id } })
      setError('Micro indisponible : autorise le micro pour l’app dans les réglages du téléphone.')
    }
  }

  function stopTalking(send = true) {
    const t = talkRef.current
    setTalking(false)
    if (!t) return
    talkRef.current = null
    clearTimeout(t.timer)
    try { t.proc.disconnect(); t.src.disconnect() } catch { /* déjà débranché */ }
    t.stream.getTracks().forEach(tr => tr.stop())
    chRef.current?.send({ type: 'broadcast', event: 'end', payload: { id: me.id } })
    if (!send) return
    const ms = Math.round(t.rec.reduce((a, c) => a + c.length, 0) / RATE * 1000)
    if (ms < 400) return   // appui trop court : rien à garder
    const peerOnline = onlineRef.current.some(p => p.id !== me.id)
    const fd = new FormData(); fd.append('audio', wav(t.rec), 'talkie.wav'); fd.append('durationMs', String(ms)); fd.append('peerOnline', peerOnline ? '1' : '0')
    fetch('/api/talkie/messages', { method: 'POST', body: fd }).then(() => loadMsgs()).catch(() => setError('Message non enregistré (réseau).'))
  }

  const others = members.filter(m => m.id !== me.id)
  const busy = !!floor && floor.id !== me.id

  return (
    <div className="p-4 max-w-md mx-auto space-y-4">
      <div>
        <h1 className="text-ink font-bold text-xl">📻 Talkie garde de nuit</h1>
        <p className="text-ink-muted text-sm mt-1">
          {isMember ? `En direct avec ${others.map(o => o.name).join(', ') || 'l’autre chauffeur de garde'}.` : `Écoute discrète : ${members.map(m => m.name).join(' et ')}.`}
        </p>
      </div>

      {!active ? (
        <button type="button" onClick={activate} className="w-full min-h-[64px] rounded-2xl bg-brand hover:bg-brand-hover text-white font-bold text-base">
          {isMember ? '📻 Activer le talkie' : '🎧 Écouter le canal'}
        </button>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {members.map(m => {
              const on = online.some(o => o.id === m.id)
              return <span key={m.id} className={`px-2.5 py-1 rounded-full font-semibold ${on ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300'}`}>{on ? '🟢' : '⚪'} {m.name}{m.id === me.id ? ' (toi)' : ''}</span>
            })}
          </div>

          <div className="text-center text-sm font-semibold min-h-[20px]">
            {talking ? <span className="text-red-700 dark:text-red-300">🔴 Tu parles…</span>
              : floor ? <span className="text-green-700 dark:text-green-300">🔊 {floor.name} parle…</span>
              : <span className="text-ink-muted">Canal libre</span>}
          </div>

          {isMember && (
            <div className="flex justify-center">
              <button type="button"
                onPointerDown={e => { e.preventDefault(); startTalking() }}
                onPointerUp={() => stopTalking(true)} onPointerCancel={() => stopTalking(true)} onPointerLeave={() => talking && stopTalking(true)}
                onContextMenu={e => e.preventDefault()}
                disabled={busy}
                style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as any}
                className={`w-52 h-52 rounded-full font-bold text-lg text-white shadow-lg transition-transform select-none ${talking ? 'bg-red-600 scale-95' : busy ? 'bg-slate-400' : 'bg-brand hover:bg-brand-hover'}`}>
                {talking ? 'Relâche pour finir' : busy ? 'Occupé' : 'Maintiens pour parler'}
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="text-red-700 dark:text-red-300 text-sm bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2">⚠️ {error}</p>}

      <div className="bg-surface border rounded-2xl p-3 space-y-2">
        <p className="text-ink font-semibold text-sm">Messages de la nuit</p>
        {!msgs.length ? <p className="text-ink-muted text-xs">Aucun message pour l’instant.</p> : msgs.map(m => (
          <div key={m.id} className="space-y-1">
            <p className="text-xs text-ink-secondary">{new Date(m.at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} · {m.senderName} · {Math.max(1, Math.round(m.durationMs / 1000))} s</p>
            {m.url && <audio controls preload="none" src={m.url} className="w-full h-9" />}
          </div>
        ))}
      </div>

      <p className="text-ink-faint text-[11px] text-center">Canal professionnel, enregistré et susceptible d’être écouté par la direction.</p>
    </div>
  )
}
