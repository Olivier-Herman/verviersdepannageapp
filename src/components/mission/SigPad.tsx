'use client'
// src/components/mission/SigPad.tsx
//
// Pad de signature client (canvas). Extrait tel quel de DriverClient le
// 2026-08-11 pour être partagé avec l'écran de clôture du flux 2 — même
// comportement, même rendu : fond blanc opaque (sinon PNG transparent illisible
// sur le PDF), point initial pour signer d'un simple tap, Effacer / Valider.

import { useEffect, useRef, useState } from 'react'

export default function SigPad({ onSave }: { onSave: (d: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pen = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [drawn, setDrawn] = useState(false)

  // Initialise un fond blanc opaque sur le canvas (sinon toDataURL → fond
  // transparent, ce qui peut etre illisible sur le PDF).
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }, [])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) / r.width  * c.width,
      y: (e.clientY - r.top)  / r.height * c.height,
    }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const p = getPos(e)
    pen.current = true
    last.current = p
    // Petit point initial pour signer un simple tap
    ctx.fillStyle = '#111111'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pen.current) return
    e.preventDefault()
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const p = getPos(e)
    if (!last.current) { last.current = p; return }
    ctx.lineWidth   = 2.8
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.strokeStyle = '#111111'
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    setDrawn(true)
  }
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pen.current = false
    last.current = null
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }
  const clear = () => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    setDrawn(false)
  }
  return (
    <div>
      <div className="border border rounded-xl overflow-hidden bg-white mb-3">
        <canvas
          ref={ref}
          width={680}
          height={260}
          className="w-full touch-none"
          style={{ aspectRatio: '680 / 260' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 py-2.5 bg-surface-hover text-ink-secondary rounded-xl text-sm">Effacer</button>
        <button onClick={() => ref.current && onSave(ref.current.toDataURL('image/png'))} disabled={!drawn}
          className="flex-1 py-2.5 bg-green-600 disabled:opacity-40 text-white rounded-xl text-sm font-medium">✅ Valider</button>
      </div>
    </div>
  )
}
