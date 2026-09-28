'use client'

import { useEffect, useState } from 'react'
import PieceCapture from '@/components/restitution/PieceCapture'

export default function PiecePhoneClient({ missionId }: { missionId: string }) {
  const [plate, setPlate] = useState<string | null>(null)
  const [sent, setSent] = useState<any>(null)
  useEffect(() => { fetch(`/api/restitution/${missionId}`, { cache: 'no-store' }).then(r => r.json()).then(j => setPlate(j?.mission?.plate || null)).catch(() => {}) }, [missionId])
  const name = sent?.idDoc?.ocr ? [sent.idDoc.ocr.firstName, sent.idDoc.ocr.lastName].filter(Boolean).join(' ') : ''
  return (
    <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-3">
      <div>
        <div className="font-display text-xl font-bold text-ink">Pièce d’identité</div>
        <p className="text-sm text-ink-secondary">Restitution {plate ? <b className="font-mono">{plate}</b> : 'en cours'} : photographiez le recto puis le verso. Les photos vont directement dans le dossier.</p>
      </div>
      {sent ? (
        <div className="rounded-card bg-success-soft p-4 flex flex-col gap-1">
          <div className="font-bold text-success">✓ Photos envoyées</div>
          <p className="text-sm text-ink">{name ? `Lu sur la pièce : ${name}. ` : ''}Continuez sur le PC : les données du client y sont pré-remplies.</p>
        </div>
      ) : <PieceCapture missionId={missionId} onSent={setSent} />}
    </div>
  )
}
