'use client'

// Ajouter des photos à une fiche, en rafale (Olivier 07/09 puis 28/09/2026 :
// « que je puisse rajouter des photos dans un dossier », « en rafale »).
// L'appareil photo reste ouvert (BurstCamera) ; chaque photo est réduite puis
// envoyée UNE PAR UNE, dans l'ordre : une requête serveur est plafonnée vers
// 4,5 Mo, et deux envois simultanés pouvaient s'écraser la liste des photos.
// Les photos rejoignent celles du chauffeur (driver_photos) : fiche, PDF, FSM.

import { useCallback, useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2 } from 'lucide-react'
import BurstCamera from '@/components/camera/BurstCamera'
import { compressImage } from '@/lib/image-compress'

export type PhotoVia = 'qr' | 'fiche' | 'accident' | 'restitution'

/** File d'envoi séquentielle des photos d'une fiche. */
export function usePhotoQueue(missionId: string, via: PhotoVia, onAdded?: (urls: string[]) => void) {
  const chain = useRef<Promise<void>>(Promise.resolve())
  const [sent, setSent] = useState(0)
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)
  const [added, setAdded] = useState<string[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const enqueue = useCallback((blob: Blob) => {
    setPending(n => n + 1)
    chain.current = chain.current.then(async () => {
      try {
        const small = await compressImage(blob, 1600)
        const fd = new FormData()
        fd.append('files', new File([small], `photo_${Date.now()}.jpg`, { type: small.type || 'image/jpeg' }))
        fd.append('via', via)
        const r = await fetch(`/api/missions/${missionId}/photos-add`, { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || String(r.status))
        const urls: string[] = j.urls || []
        setAdded(a => [...a, ...urls]); setSent(n => n + 1)
        if (typeof j.total === 'number') setTotal(j.total)
        onAdded?.(urls)
      } catch { setFailed(n => n + 1) } finally { setPending(n => n - 1) }
    })
  }, [missionId, via, onAdded])
  return { enqueue, sent, pending, failed, added, total }
}

export default function AddPhotosButton({ missionId, initialCount, via = 'qr', onAdded }: { missionId: string; initialCount: number; via?: PhotoVia; onAdded?: (urls: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState(false)
  const q = usePhotoQueue(missionId, via, onAdded)
  const count = q.total ?? initialCount + q.sent

  return (
    <div className="bg-surface border rounded-2xl p-3 space-y-2">
      {camera && <BurstCamera title="Photos" count={q.sent + q.pending} onShot={b => q.enqueue(b)} onClose={() => setCamera(false)} />}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { Array.from(e.target.files || []).forEach(f => q.enqueue(f)); e.target.value = '' }} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setCamera(true)}
          className="flex-1 min-h-[44px] py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-bold transition flex items-center justify-center gap-2">
          <Camera size={18} /> Ajouter des photos
        </button>
        <button type="button" onClick={() => inputRef.current?.click()} aria-label="Choisir des photos déjà prises"
          className="min-h-[44px] px-3 border border-strong rounded-xl text-ink-secondary hover:bg-surface-hover flex items-center justify-center gap-1.5 text-sm font-semibold">
          <ImagePlus size={18} /> Galerie
        </button>
      </div>
      <p className="text-ink-muted text-xs text-center">
        {count === 0 ? 'Aucune photo sur la fiche pour l’instant' : `${count} photo${count > 1 ? 's' : ''} sur la fiche`}
        {q.sent > 0 && <span className="text-emerald-700 font-semibold"> · {q.sent} ajoutée{q.sent > 1 ? 's' : ''} ✓</span>}
        {q.pending > 0 && <span className="text-ink-secondary font-semibold"> · <Loader2 size={11} className="inline animate-spin" /> {q.pending} en cours</span>}
        {q.failed > 0 && <span className="text-red-700 font-semibold"> · {q.failed} en échec, à reprendre</span>}
      </p>
      {q.added.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {q.added.map(u => <img key={u} src={u} alt="" className="w-full aspect-square object-cover rounded-lg border" />)}
        </div>
      )}
    </div>
  )
}
