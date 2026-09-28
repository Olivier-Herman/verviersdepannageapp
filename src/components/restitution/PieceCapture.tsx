'use client'

// Photo de la pièce d'identité, recto puis verso, pour la restitution
// (Olivier 28/09/2026). L'appareil photo du téléphone s'ouvre à chaque face ;
// les deux photos partent ensemble, sont rangées dans le dossier et lues pour
// pré-remplir le client.

import { useRef, useState } from 'react'
import { compressImage } from '@/lib/image-compress'

export default function PieceCapture({ missionId, onSent }: { missionId: string; onSent: (ctx: any) => void }) {
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const side = shots.length === 0 ? 'recto' : 'verso'

  const take = () => camRef.current?.click()

  const onFile = async (f: File) => {
    const small = await compressImage(f, 1800)
    setShots(p => [...p, { blob: small, url: URL.createObjectURL(small) }])
  }
  const send = async (list = shots) => {
    setBusy(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('action', 'id_photo')
      list.forEach((s, i) => fd.append('files', new File([s.blob], `piece-${i === 0 ? 'recto' : 'verso'}.jpg`, { type: s.blob.type || 'image/jpeg' })))
      const r = await fetch(`/api/restitution/${missionId}`, { method: 'POST', body: fd })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Envoi impossible')
      list.forEach(s => URL.revokeObjectURL(s.url))
      onSent(j)
    } catch (e: any) { setErr(e?.message || 'Envoi impossible') } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      {shots.length > 0 && <div className="grid grid-cols-2 gap-2">{shots.map((s, i) => (
        <div key={i} className="relative rounded-xl overflow-hidden border border-border bg-surface-2 aspect-[3/2]">
          <img src={s.url} alt={i === 0 ? 'Recto' : 'Verso'} className="w-full h-full object-cover" />
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 text-xs font-bold text-white">{i === 0 ? 'Recto' : 'Verso'}</span>
          <button type="button" onClick={() => setShots(p => p.filter((_, k) => k !== i))} aria-label="Reprendre cette photo" className="absolute right-0 top-0 w-9 h-9 bg-black/55 text-white font-bold rounded-bl-lg">✕</button>
        </div>))}</div>}
      {shots.length < 2 && <button type="button" onClick={take} disabled={busy} className="w-full min-h-[52px] rounded-btn bg-brand hover:bg-brand-hover text-white font-bold shadow-brand disabled:opacity-50">📷 Photographier le {side}</button>}
      {shots.length === 1 && <button type="button" onClick={() => send()} disabled={busy} className="w-full min-h-[44px] rounded-btn border border-strong bg-surface text-ink font-semibold">Pas de verso (passeport) : envoyer</button>}
      {shots.length === 2 && <button type="button" onClick={() => send()} disabled={busy} className="w-full min-h-[52px] rounded-btn bg-brand hover:bg-brand-hover text-white font-bold shadow-brand disabled:opacity-50">{busy ? 'Envoi et lecture…' : 'Envoyer les 2 photos'}</button>}
      {err && <p className="text-sm text-critical font-semibold">{err}</p>}
    </div>
  )
}
