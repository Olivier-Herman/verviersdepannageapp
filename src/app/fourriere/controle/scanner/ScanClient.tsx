'use client'

// Contrôle du parc — téléphone (Olivier 21/10/2026). On choisit sa zone, la caméra lit
// les étiquettes en continu, sans bouton : chaque lecture est validée par un son et une
// vibration (1 bip = à sa place, 2 bips = changée de zone, 3 bips = Domaine, son grave =
// pas attendue au parc, buzz = étiquette inconnue). Sans étiquette : photo de la plaque ou
// du châssis, VD Soft retrouve la fiche.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { orderZones, zoneLabel, TAMPON, TAMPON_KEY, type Zone } from '../zones'

type Kind = 'ok' | 'transfere' | 'domaine' | 'en_trop' | 'deja' | 'inconnu' | 'erreur'
interface Feed { at: number; kind: Kind; message: string; detail?: string }

const READER_ID = 'controle-parc-reader'
// Batterie (Olivier 28/10/2026) : caméra en 640×480, lecteur du téléphone quand il existe, 5 lectures/s,
// veille après 60 s sans scan ou quand l'app passe en arrière-plan.
const VEILLE_MS = 60_000
const DEDUP_MS = 4000

// Sons : un seul AudioContext, débloqué au toucher « Démarrer » (obligatoire sur iPhone).
let audio: AudioContext | null = null
function unlockAudio() {
  try {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!audio && C) audio = new C()
    audio?.resume?.()
  } catch { /* pas de son */ }
}
function tones(seq: [number, number][], type: OscillatorType = 'square') {
  if (!audio) return
  let t = audio.currentTime + 0.01
  for (const [f, d] of seq) {
    const o = audio.createOscillator(), g = audio.createGain()
    o.type = type; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d)
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + d + 0.02)
    t += d + 0.07
  }
}
function signal(kind: Kind) {
  const vib = (p: number | number[]) => { try { (navigator as any).vibrate?.(p) } catch {} }
  switch (kind) {
    case 'ok':        tones([[1320, 0.13]]); vib(90); break
    case 'transfere': tones([[1320, 0.1], [1320, 0.1]]); vib([70, 60, 70]); break
    case 'domaine':   tones([[1046, 0.09], [1046, 0.09], [1046, 0.09]]); vib([60, 50, 60, 50, 60]); break
    case 'deja':      tones([[880, 0.08]], 'sine'); vib(40); break
    case 'en_trop':   tones([[220, 0.4]], 'sawtooth'); vib([300]); break
    default:          tones([[150, 0.16], [150, 0.16]], 'sawtooth'); vib([150, 80, 150])
  }
}
const ICON: Record<Kind, string> = { ok: '🟢', transfere: '🟠', domaine: '🟣', deja: '🔵', en_trop: '⚪', inconnu: '🔴', erreur: '🔴' }
const RING: Record<Kind, string> = { ok: 'ring-green-500', transfere: 'ring-amber-500', domaine: 'ring-violet-500', deja: 'ring-sky-500', en_trop: 'ring-fuchsia-500', inconnu: 'ring-red-600', erreur: 'ring-red-600' }

async function resizeImage(file: File): Promise<{ base64: string; mimeType: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return { base64: c.toDataURL('image/jpeg', 0.85).split(',')[1], mimeType: 'image/jpeg' }
  } finally { URL.revokeObjectURL(url) }
}

export default function ScanClient({ userName }: { userName: string }) {
  const [ctrlId, setCtrlId] = useState<string | null | undefined>(undefined)
  const [zones, setZones] = useState<Zone[]>([])
  const [zone, setZone] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [camErr, setCamErr] = useState<string | null>(null)
  const [veille, setVeille] = useState(false)
  const activiteRef = useRef(Date.now())
  const [feed, setFeed] = useState<Feed[]>([])
  const [flash, setFlash] = useState<Kind | null>(null)
  const [manual, setManual] = useState('')
  const [photo, setPhoto] = useState<null | { busy: boolean; plate?: string | null; vin?: string | null; photo_path?: string; candidates?: any[]; error?: string }>(null)
  const [confirmDone, setConfirmDone] = useState(false)
  const [doneZones, setDoneZones] = useState<Record<string, any>>({})
  const scannerRef = useRef<any>(null)
  const lastRef = useRef<Map<string, number>>(new Map())
  const zoneRef = useRef(zone)
  const busyRef = useRef(false)
  zoneRef.current = zone

  // Zones proposées : stockage (I = zone Domaine), zone tampon (J + relivraison + Transit), LABO.
  const options = (() => {
    const out: { key: string; label: string }[] = []
    let tamponAdded = false
    for (const z of zones) {
      if (z.key === 'Verviers') continue   // dépôt de Verviers : relevé sans étiquette du dimanche repris d'office
      if (TAMPON.includes(z.key)) { if (!tamponAdded) { out.push({ key: TAMPON_KEY, label: 'Zone tampon (J, relivraison, Transit, SNC)' }); tamponAdded = true } continue }
      out.push({ key: z.key, label: `Zone ${zoneLabel(z)}` })
    }
    return out
  })()

  const loadCtrl = useCallback(async () => {
    const r = await fetch('/api/fourriere/controle', { cache: 'no-store' }).then(r => r.json()).catch(() => null)
    const id = r?.current?.id || null
    setCtrlId(id)
    if (id) {
      const s = await fetch(`/api/fourriere/controle/${id}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null)
      if (s?.zones) setZones(orderZones(s.zones))
      if (s?.controle) setDoneZones(s.controle.zones_done || {})
    }
  }, [])
  useEffect(() => { loadCtrl() }, [loadCtrl])

  const push = (f: Omit<Feed, 'at'>) => {
    setFeed(prev => [{ ...f, at: Date.now() }, ...prev].slice(0, 30))
    setFlash(f.kind); setTimeout(() => setFlash(null), 1200)
    signal(f.kind)
  }

  const post = useCallback(async (body: any) => {
    const r = await fetch(`/api/fourriere/controle/${ctrlId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return r.json().catch(() => ({ error: 'Réponse illisible' }))
  }, [ctrlId])

  const send = useCallback(async (payload: { raw?: string; mission_id?: string; via?: string; photo_path?: string }) => {
    if (!zoneRef.current) { push({ kind: 'erreur', message: 'Choisissez d’abord votre zone' }); return }
    busyRef.current = true
    try {
      const r = await post({ action: 'scan', zone: zoneRef.current, ...payload })
      if (r.error) push({ kind: 'erreur', message: r.error })
      else push({ kind: r.kind, message: r.message, detail: r.detail })
    } catch { push({ kind: 'erreur', message: 'Pas de réseau — rescannez cette étiquette' }) }
    finally { busyRef.current = false }
  }, [post])

  async function startCam() {
    unlockAudio(); setCamErr(null)
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      const s = new Html5Qrcode(READER_ID, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } } as any)
      scannerRef.current = s
      activiteRef.current = Date.now(); setVeille(false)
      await s.start({ facingMode: 'environment' }, { fps: 5, videoConstraints: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, qrbox: (w: number, h: number) => { const m = Math.floor(Math.min(w, h) * 0.7); return { width: m, height: m } } } as any,
        (text: string) => {
          if (busyRef.current) return
          const now = Date.now(), last = lastRef.current.get(text) || 0
          if (now - last < DEDUP_MS) return
          lastRef.current.set(text, now)
          activiteRef.current = now
          send({ raw: text, via: 'etiquette' })
        }, () => {})
      setRunning(true)
    } catch (e: any) {
      setCamErr(e?.message?.includes('Permission') || e?.name === 'NotAllowedError' ? 'Accès à la caméra refusé : autorisez la caméra pour ce site dans les réglages du téléphone.' : 'Caméra indisponible sur ce téléphone.')
    }
  }
  async function stopCam() {
    try { await scannerRef.current?.stop(); scannerRef.current?.clear() } catch {}
    scannerRef.current = null; setRunning(false)
  }
  useEffect(() => () => { stopCam() }, [])
  // Veille : 60 s sans étiquette lue, ou app en arrière-plan → caméra coupée ; un toucher la relance.
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => { if (Date.now() - activiteRef.current > VEILLE_MS) { stopCam(); setVeille(true) } }, 5_000)
    const onVis = () => { if (document.visibilityState === 'hidden') { stopCam(); setVeille(true) } }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  async function chooseZone(z: string) {
    setZone(z); setConfirmDone(false)
    if (ctrlId && z) post({ action: 'presence', zone: z })
  }

  async function onPhoto(f: File | undefined) {
    if (!f) return
    unlockAudio()
    setPhoto({ busy: true })
    try {
      const img = await resizeImage(f)
      const r = await post({ action: 'photo', ...img })
      if (r.error) setPhoto({ busy: false, error: r.error })
      else setPhoto({ busy: false, plate: r.plate, vin: r.vin, photo_path: r.photo_path, candidates: r.candidates || [] })
    } catch { setPhoto({ busy: false, error: 'Lecture de la photo impossible' }) }
  }

  async function zoneFinished() {
    await post({ action: 'zone', zone })
    signal('ok')
    const label = zone === TAMPON_KEY ? 'Zone tampon' : `Zone ${zone}`
    setFeed(prev => [{ at: Date.now(), kind: 'ok' as Kind, message: `${label} terminée` }, ...prev])
    setDoneZones(d => ({ ...d, [zone]: true }))
    const i = options.findIndex(o => o.key === zone)
    const next = options[i + 1]?.key || ''
    setConfirmDone(false)
    if (next) chooseZone(next)
  }

  if (ctrlId === undefined) return <div className="p-6 text-ink-muted">Chargement…</div>
  if (!ctrlId) {
    return (
      <div className="p-4 max-w-md mx-auto space-y-3">
        <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 p-4 space-y-2 bg-white/60 dark:bg-zinc-900/60">
          <h1 className="text-lg font-bold text-ink">Aucun contrôle en cours</h1>
          <p className="text-sm text-ink-secondary">Le contrôle se lance depuis l’écran de contrôle du parc. Ensuite, chacun scanne depuis son téléphone.</p>
          <Link href="/fourriere/controle" className="inline-flex items-center min-h-[44px] px-4 rounded-xl bg-red-700 text-white font-bold">Ouvrir l’écran de contrôle</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 max-w-md mx-auto space-y-3">
      <div className="flex justify-between items-center text-sm text-ink-muted"><span>📱 {userName || 'Moi'}</span><Link href="/fourriere/controle" className="underline min-h-[44px] inline-flex items-center">Écran de contrôle</Link></div>
      <select value={zone} onChange={e => chooseZone(e.target.value)} className="w-full min-h-[48px] rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 bg-white dark:bg-zinc-900 text-ink text-base font-semibold">
        <option value="">— Dans quelle zone êtes-vous ? —</option>
        {options.map(o => <option key={o.key} value={o.key}>{o.label}{doneZones[o.key] || (o.key === TAMPON_KEY && doneZones['J']) ? ' ✓' : ''}</option>)}
      </select>

      <div className={`relative rounded-2xl overflow-hidden bg-black ring-4 ${flash ? RING[flash] : 'ring-transparent'} transition`} style={{ minHeight: 260 }}>
        <div id={READER_ID} className="w-full" />
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-white text-sm">{veille ? 'Caméra en veille pour économiser la batterie.' : 'La caméra lit les étiquettes toute seule : aucun bouton à presser. Chaque lecture donne un son.'}</p>
            <button onClick={startCam} disabled={!zone} className="min-h-[48px] px-6 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">{!zone ? 'Choisissez votre zone' : veille ? 'Toucher pour reprendre' : 'Démarrer le scan'}</button>
            {camErr && <p className="text-red-300 text-xs">{camErr}</p>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className={`min-h-[48px] rounded-xl border border-zinc-300 dark:border-zinc-700 text-ink font-semibold flex items-center justify-center gap-1 ${zone ? '' : 'opacity-40 pointer-events-none'}`}>
          📸 Pas d’étiquette
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { onPhoto(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {!confirmDone
          ? <button onClick={() => setConfirmDone(true)} disabled={!zone} className="min-h-[48px] rounded-xl border border-zinc-300 dark:border-zinc-700 text-ink font-semibold disabled:opacity-40">✓ Zone terminée</button>
          : <button onClick={zoneFinished} className="min-h-[48px] rounded-xl bg-green-600 text-white font-bold">Confirmer : zone finie</button>}
      </div>
      <form onSubmit={e => { e.preventDefault(); if (manual.trim()) { unlockAudio(); send({ raw: manual.trim(), via: 'plaque' }); setManual('') } }} className="flex gap-2">
        <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Ou tapez la plaque / le n° de fiche" className="flex-1 min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 bg-transparent text-ink" />
        <button disabled={!zone || !manual.trim()} className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-ink font-semibold disabled:opacity-40">OK</button>
      </form>
      {running && <button onClick={stopCam} className="text-xs underline text-ink-muted min-h-[36px]">Arrêter la caméra</button>}
      <p className="text-[11px] text-ink-muted text-center">1 bip = à sa place · 2 bips = changée de zone · 3 bips = Domaine · son grave = pas attendue au parc · buzz = étiquette inconnue</p>

      <div className="space-y-1.5">
        {feed.length === 0 && <div className="text-sm text-ink-muted text-center">Les voitures scannées s’affichent ici.</div>}
        {feed.map((f, i) => (
          <div key={f.at + '-' + i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm flex gap-2">
            <span>{ICON[f.kind]}</span>
            <div className="min-w-0"><div className="text-ink font-semibold break-words">{f.message}</div>{f.detail && <div className="text-xs text-ink-muted">{f.detail}</div>}</div>
          </div>
        ))}
      </div>

      {photo && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md p-4 space-y-3 relative">
            <button onClick={() => setPhoto(null)} aria-label="Fermer" className="absolute top-1 right-1 w-11 h-11 text-xl text-ink-secondary">✕</button>
            <h2 className="font-bold text-ink text-lg">Voiture sans étiquette</h2>
            {photo.busy && <p className="text-sm text-ink-secondary">Lecture de la photo…</p>}
            {photo.error && <p className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{photo.error}</p>}
            {!photo.busy && !photo.error && (
              <>
                <p className="text-sm text-ink">{photo.plate || photo.vin ? <>Lu sur la photo : {photo.plate && <b className="font-mono">{photo.plate}</b>}{photo.plate && photo.vin && ' · '}{photo.vin && <b className="font-mono">châssis {photo.vin}</b>}</> : 'Rien de lisible sur la photo.'}</p>
                {(photo.candidates || []).length === 0 && (photo.plate || photo.vin) && <p className="text-sm text-amber-900 bg-amber-50 rounded-xl p-3">Aucune fiche trouvée pour cette plaque ou ce châssis. Reprenez la photo ou tapez la plaque.</p>}
                <div className="space-y-2">
                  {(photo.candidates || []).map((c: any) => (
                    <button key={c.id} onClick={() => { setPhoto(null); send({ mission_id: c.id, via: 'photo', photo_path: photo.photo_path }) }}
                      className="w-full min-h-[52px] rounded-xl border-2 border-green-600 px-3 py-2 text-left">
                      <div className="font-mono font-bold text-ink">{c.vehicle_plate || 'sans plaque'} <span className="font-sans font-normal text-ink-muted text-sm">· {[c.vehicle_brand, c.vehicle_model].filter(Boolean).join(' ')}</span></div>
                      <div className="text-xs text-ink-muted">Fiche #{c.mission_number} · {c.parc_zone_key ? `zone ${c.parc_zone_key}` : 'sans zone'} — C’est elle</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            <label className="min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 text-ink font-semibold flex items-center justify-center">
              Reprendre la photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { onPhoto(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
