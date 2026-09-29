'use client'

import { useEffect, useState } from 'react'
import TransportDocsCapture from '@/components/restitution/TransportDocsCapture'
import AddPhotosButton from '@/components/qr/AddPhotosButton'

export default function PhotosPhoneClient({ missionId, type }: { missionId: string; type: 'transport' | 'divers' }) {
  const [ctx, setCtx] = useState<any>(null)
  useEffect(() => { fetch(`/api/restitution/${missionId}`, { cache: 'no-store' }).then(r => r.json()).then(setCtx).catch(() => {}) }, [missionId])
  const plate = ctx?.mission?.plate
  return (
    <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-3">
      <div>
        <div className="font-display text-xl font-bold text-ink">{type === 'divers' ? 'Photos du véhicule' : 'Documents du transporteur'}</div>
        <p className="text-sm text-ink-secondary">Restitution {plate ? <b className="font-mono">{plate}</b> : 'en cours'} : photographiez en rafale, tout va directement dans le dossier. Continuez ensuite sur le PC.</p>
      </div>
      {!ctx ? <p className="text-sm text-ink-muted">Chargement…</p>
        : type === 'divers'
          ? <AddPhotosButton missionId={missionId} initialCount={ctx.photoCount || 0} via="restitution" />
          : <TransportDocsCapture missionId={missionId} initial={ctx.transportDocs || 0} />}
    </div>
  )
}
