'use client'

// Bouton « Carte étrangère (photo) » : capture/upload une image de la pièce
// (sur tablette tactile → caméra ; sur PC → sélecteur de fichier), l'envoie à
// l'OCR Claude (/api/eid/ocr) et renvoie les champs via onImport() — même
// format et même préremplissage que la lecture eID belge.
// Pour FR/DE/NL/LU + passeports (puce verrouillée, la MRZ se lit par photo).

import { useRef, useState } from 'react'
import type { EidData } from './EidImportButton'

const fileToBase64 = (file: File) => new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => {
    const s = String(r.result || '')
    const comma = s.indexOf(',')
    resolve({ base64: comma >= 0 ? s.slice(comma + 1) : s, mimeType: file.type || 'image/jpeg' })
  }
  r.onerror = () => reject(new Error('lecture image'))
  r.readAsDataURL(file)
})

export default function IdPhotoButton({
  onImport,
  className,
}: {
  onImport: (d: EidData) => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permet de reprendre la même image
    if (!file) return
    setBusy(true); setError(null)
    try {
      const { base64, mimeType } = await fileToBase64(file)
      const r = await fetch('/api/eid/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Lecture impossible.'); return }
      if (!j.firstName && !j.lastName) { setError('Pièce non reconnue — réessaie avec une photo nette.'); return }
      onImport(j as EidData)
    } catch {
      setError('Erreur réseau.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={className}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        onChange={onFile} style={{ display: 'none' }} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
        className="text-xs text-brand hover:underline flex items-center gap-1 disabled:opacity-50"
        title="Lire une carte étrangère / passeport par photo (OCR)">
        {busy ? '⏳ Lecture…' : '📷 Carte étrangère (photo)'}
      </button>
      {error && <p className="text-critical text-xs mt-1">⚠ {error}</p>}
    </span>
  )
}
