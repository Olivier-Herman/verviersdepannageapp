'use client'
// src/components/decharges/DamageSchemaPad.tsx
//
// Pad de dessin pour annoter les degats sur un vehicule.
// 4 vues (avant/arriere/gauche/droite). Chaque vue = silhouette SVG en fond
// + canvas transparent par-dessus pour le dessin au doigt (rouge epais).
//
// Au save, chaque vue est "aplatie" en PNG (silhouette + annotation) et
// retournee comme data URL dans un dict { front?, back?, left?, right? }.

import { useEffect, useRef, useState } from 'react'
import { CarSilhouette, CAR_VIEW_LABEL, type CarView } from './CarSilhouettes'

const CANVAS_W = 400
const CANVAS_H = 240
const STROKE_COLOR = '#dc2626'  // rouge-600
const STROKE_WIDTH = 4
const VIEWS: CarView[] = ['top', 'front', 'back', 'left', 'right']

export interface DamageSchemaUrls {
  top?:   string
  front?: string
  back?:  string
  left?:  string
  right?: string
}

interface Props {
  /** Schemas existants (si edition) */
  initial?: DamageSchemaUrls
  onSave:   (urls: DamageSchemaUrls) => void
  onCancel: () => void
}

export default function DamageSchemaPad({ initial, onSave, onCancel }: Props) {
  const [activeView, setActiveView] = useState<CarView>('front')
  const [hasDrawing, setHasDrawing] = useState<Record<CarView, boolean>>({
    top: !!initial?.top, front: !!initial?.front, back: !!initial?.back, left: !!initial?.left, right: !!initial?.right,
  })

  // 5 refs distincts pour preserver le dessin entre changements d onglet
  const canvasRefs = useRef<Record<CarView, HTMLCanvasElement | null>>({
    top: null, front: null, back: null, left: null, right: null,
  })

  // Charge les dessins initiaux (si edition) au montage
  useEffect(() => {
    VIEWS.forEach(view => {
      if (!initial?.[view]) return
      const canvas = canvasRefs.current[view]
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H)
      img.src = initial[view]!
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getCanvas = () => canvasRefs.current[activeView]

  // Drawing (pointer events = touch + mouse + pen)
  const isDrawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const getRelPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = getCanvas()
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width  * CANVAS_W,
      y: (e.clientY - rect.top)  / rect.height * CANVAS_H,
    }
  }
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const pos = getRelPos(e)
    if (!pos) return
    isDrawing.current = true
    lastPos.current = pos
    const ctx = getCanvas()?.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, STROKE_WIDTH / 2, 0, Math.PI * 2)
    ctx.fillStyle = STROKE_COLOR
    ctx.fill()
    setHasDrawing(d => ({ ...d, [activeView]: true }))
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return
    e.preventDefault()
    const pos = getRelPos(e)
    if (!pos || !lastPos.current) return
    const ctx = getCanvas()?.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = STROKE_COLOR
    ctx.lineWidth   = STROKE_WIDTH
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawing.current = false
    lastPos.current = null
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }

  const clearView = (view: CarView) => {
    const canvas = canvasRefs.current[view]
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    setHasDrawing(d => ({ ...d, [view]: false }))
  }

  // Aplatit silhouette + annotation en un seul PNG (data URL).
  // Strategie : on rasterise le SVG silhouette via XMLSerializer → Image → canvas final
  // sur lequel on superpose le canvas d annotation. Tout reste cote client (pas de fetch).
  const flattenView = async (view: CarView): Promise<string | null> => {
    if (!hasDrawing[view]) return null
    const drawCanvas = canvasRefs.current[view]
    if (!drawCanvas) return null

    // Rasterise la silhouette : on cree un SVG inline qui contient le meme
    // composant rendu en HTML (on prend l element DOM de la vue active).
    const svgEl = document.getElementById(`car-svg-${view}`) as SVGSVGElement | null
    if (!svgEl) return null

    const svgString = new XMLSerializer().serializeToString(svgEl)
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = svgUrl
      })

      const out = document.createElement('canvas')
      out.width = CANVAS_W
      out.height = CANVAS_H
      const ctx = out.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H)
      ctx.drawImage(drawCanvas, 0, 0)
      return out.toDataURL('image/png')
    } finally {
      URL.revokeObjectURL(svgUrl)
    }
  }

  const handleSave = async () => {
    const out: DamageSchemaUrls = {}
    for (const view of VIEWS) {
      const url = await flattenView(view)
      if (url) out[view] = url
    }
    onSave(out)
  }

  const drawingCount = VIEWS.filter(v => hasDrawing[v]).length

  return (
    <div className="fixed inset-0 bg-surface z-50 flex flex-col">
      {/* Header */}
      <div className="bg-surface border-b border px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-3 mb-2">
          <button onClick={onCancel} className="text-ink-secondary text-sm flex items-center gap-1">← Annuler</button>
          <p className="text-ink font-semibold text-sm">Schéma de dégâts {drawingCount > 0 && <span className="text-ink-muted">· {drawingCount}/{VIEWS.length}</span>}</p>
          <button
            onClick={handleSave}
            disabled={drawingCount === 0}
            className="px-3 py-1.5 bg-brand disabled:opacity-40 text-white text-sm rounded-lg font-semibold">
            Valider
          </button>
        </div>
        {/* Onglets de vue */}
        <div className="flex gap-1 overflow-x-auto">
          {VIEWS.map(v => (
            <button key={v}
              onClick={() => setActiveView(v)}
              className={`px-3 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition ${
                activeView === v
                  ? 'bg-brand text-white'
                  : hasDrawing[v]
                    ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                    : 'bg-surface-hover text-ink-secondary border border'
              }`}>
              {CAR_VIEW_LABEL[v]}{hasDrawing[v] && ' ●'}
            </button>
          ))}
        </div>
      </div>

      {/* Zone de dessin */}
      <div className="flex-1 overflow-hidden flex flex-col items-center justify-center p-4 bg-surface-2">
        <p className="text-ink-muted text-xs mb-3">Dessine au doigt pour annoter les dégâts</p>
        <div className="relative w-full max-w-md aspect-[5/3] bg-white rounded-2xl shadow-md overflow-hidden">
          {/* SVG silhouettes (toutes rendues mais une seule visible — preserve les refs canvas) */}
          {VIEWS.map(v => (
            <div key={v} className="absolute inset-0" style={{ display: activeView === v ? 'block' : 'none' }}>
              <div id={`car-svg-${v}`} className="absolute inset-0 text-zinc-500 pointer-events-none">
                <CarSilhouette view={v} className="w-full h-full" />
              </div>
              {/* Canvas overlay pour le dessin (touch action none = pas de scroll) */}
              <canvas
                ref={el => { canvasRefs.current[v] = el }}
                width={CANVAS_W}
                height={CANVAS_H}
                className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => clearView(activeView)}
          disabled={!hasDrawing[activeView]}
          className="mt-4 px-4 py-2 bg-surface-hover disabled:opacity-40 text-ink-secondary text-xs rounded-lg flex items-center gap-1.5">
          🧽 Effacer cette vue
        </button>
      </div>
    </div>
  )
}
