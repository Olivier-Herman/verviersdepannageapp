'use client'

// Appareil photo en rafale (Olivier 28/09/2026 : « il faut que je puisse les
// mettre en rafale »). L'aperçu reste ouvert : un toucher = une page, on
// enchaîne sans repasser par l'écran de validation du téléphone. Chaque prise
// est remise tout de suite au parent (qui l'envoie en arrière-plan).
// Si le navigateur refuse la caméra en direct, on retombe sur l'appareil
// photo du téléphone, une photo à la fois, sans perdre les pages déjà prises.

import { useEffect, useRef, useState } from 'react'

export default function BurstCamera({ onShot, onClose, title = 'Pages', count }: {
  onShot: (photo: Blob) => void
  onClose: () => void
  title?: string
  count: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fallbackRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [flash, setFlash] = useState(false)
  const [last, setLast] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('indisponible')
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } } })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        const v = videoRef.current
        if (v) { v.srcObject = stream; await v.play().catch(() => {}); setReady(true) }
      } catch { setFailed(true) }
    })()
    return () => { cancelled = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [])

  const shoot = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob(b => {
      if (!b) return
      setLast(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(b) })
      onShot(b)
    }, 'image/jpeg', 0.85)
    setFlash(true); setTimeout(() => setFlash(false), 120)
    try { navigator.vibrate?.(30) } catch {}
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" role="dialog" aria-label="Appareil photo">
      <div className="flex items-center justify-between px-4 py-3 text-white" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <span className="text-base font-semibold">{title} : {count}</span>
        <button type="button" onClick={onClose} className="min-h-[44px] rounded-btn bg-white text-black px-4 text-sm font-bold">Terminé</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {!failed && <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-contain" />}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {!ready && !failed && <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">Ouverture de l’appareil photo…</div>}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
            <p className="text-sm text-white/80">L’aperçu en direct n’est pas disponible ici : on prend les pages une par une avec l’appareil photo du téléphone.</p>
            <button type="button" onClick={() => fallbackRef.current?.click()} className="min-h-[52px] rounded-btn bg-white text-black px-5 text-base font-bold">📷 Prendre la page {count + 1}</button>
            <input ref={fallbackRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setLast(p => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(f) }); onShot(f) } e.target.value = '' }} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-6 py-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/40 bg-white/10">{last && <img src={last} alt="" className="w-full h-full object-cover" />}</div>
        {!failed && <button type="button" onClick={shoot} disabled={!ready} aria-label="Prendre la page" className="w-20 h-20 rounded-full border-4 border-white bg-white/90 active:scale-95 transition-transform disabled:opacity-40" />}
        <div className="w-14" />
      </div>
    </div>
  )
}
