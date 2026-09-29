'use client'
// src/components/restitution/TransportDocsCapture.tsx

import { useEffect, useRef, useState } from 'react'
import BurstCamera from '@/components/camera/BurstCamera'
import { compressImage } from '@/lib/image-compress'

const Btn = ({ children, onClick, disabled, kind = 'ghost' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'brand' | 'ghost' }) =>
  <button type="button" onClick={onClick} disabled={disabled} className={`min-h-[44px] rounded-btn px-3.5 text-sm font-semibold disabled:opacity-60 ${kind === 'brand' ? 'bg-brand hover:bg-brand-hover text-white shadow-brand' : 'border border-strong bg-surface text-ink'}`}>{children}</button>

// Documents du transporteur (CMR, ordre d'enlèvement…) en rafale, une photo à
// la fois vers le dossier (Olivier 29/09/2026).
export default function TransportDocsCapture({ missionId, initial, pcMode = false, onAskPhone, waiting = false }: { missionId: string; initial: number; pcMode?: boolean; onAskPhone?: () => void; waiting?: boolean }) {
  const chain = useRef<Promise<void>>(Promise.resolve())
  const fileRef = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState(false)
  const [count, setCount] = useState(initial)
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)
  useEffect(() => { setCount(n => Math.max(n, initial)) }, [initial])
  const enqueue = (blob: Blob) => {
    setPending(n => n + 1)
    chain.current = chain.current.then(async () => {
      try {
        const small = await compressImage(blob, 1800)
        const fd = new FormData(); fd.append('action', 'transport_doc'); fd.append('file', new File([small], 'document.jpg', { type: small.type || 'image/jpeg' }))
        const r = await fetch(`/api/restitution/${missionId}`, { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error)
        setCount(j.count ?? (n => n + 1))
      } catch { setFailed(n => n + 1) } finally { setPending(n => n - 1) }
    })
  }
  return <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
    {camera && <BurstCamera title="Documents du transporteur" count={count + pending} onShot={enqueue} onClose={() => setCamera(false)} />}
    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { Array.from(e.target.files || []).forEach(enqueue); e.target.value = '' }} />
    <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Documents du transporteur</div>
    <p className="text-sm text-ink-secondary">CMR, ordre d’enlèvement, carte du chauffeur… Photographiez autant de pages que nécessaire, elles rejoignent le dossier.</p>
    <div className="flex flex-wrap gap-2">
      {pcMode
        ? <Btn kind="brand" onClick={onAskPhone} disabled={waiting}>{waiting ? 'Notification envoyée sur votre téléphone…' : '📱 Photographier avec mon téléphone'}</Btn>
        : <Btn kind="brand" onClick={() => setCamera(true)}>📷 Photographier les documents</Btn>}
      <Btn onClick={() => fileRef.current?.click()}>{pcMode ? 'Choisir des fichiers sur ce PC' : 'Galerie'}</Btn>
    </div>
    <p className="text-xs text-ink-muted">{count === 0 ? 'Aucun document pour l’instant.' : `${count} photo${count > 1 ? 's' : ''} au dossier ✓`}{pending > 0 ? ` · ${pending} en cours d’envoi` : ''}{failed > 0 ? ` · ${failed} en échec, à reprendre` : ''}</p>
  </div>
}
