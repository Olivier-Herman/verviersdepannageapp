'use client'

// Bouton « Ajouter des photos » de l'écran d'étiquette QR (Olivier 07/09/2026).
// Ouvre l'appareil photo, compresse comme l'app chauffeur (1600 px, JPEG 0,82)
// et envoie sur /api/missions/[id]/photos-add : les photos rejoignent celles
// du chauffeur sur la fiche.

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'

async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const max = 1600
      const ratio = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(b => resolve(b || file), 'image/jpeg', 0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

export default function AddPhotosButton({ missionId, initialCount }: { missionId: string; initialCount: number }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy,  setBusy]  = useState(false)
  const [count, setCount] = useState(initialCount)
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list || []); if (!files.length) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('files', await compress(f), f.name.replace(/\.[^.]+$/, '') + '.jpg')
      const r = await fetch(`/api/missions/${missionId}/photos-add`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`)
      setAdded(prev => [...prev, ...(j.urls || [])])
      setCount(j.total ?? count + files.length)
    } catch (e: any) {
      setError(e?.message || 'Envoi impossible')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="bg-surface border rounded-2xl p-3 space-y-2">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
        className="w-full py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition flex items-center justify-center gap-2">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        {busy ? 'Envoi des photos…' : 'Ajouter des photos'}
      </button>
      <p className="text-ink-muted text-xs text-center">
        {count === 0 ? 'Aucune photo sur la fiche pour l’instant' : `${count} photo${count > 1 ? 's' : ''} sur la fiche`}
        {added.length > 0 && <span className="text-emerald-700 font-semibold"> · {added.length} ajoutée{added.length > 1 ? 's' : ''} à l’instant ✓</span>}
      </p>
      {added.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {added.map(u => <img key={u} src={u} alt="" className="w-full aspect-square object-cover rounded-lg border" />)}
        </div>
      )}
      {error && <p className="text-red-700 text-xs text-center">{error}</p>}
    </div>
  )
}
