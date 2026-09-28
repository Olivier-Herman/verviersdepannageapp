'use client'

// Documents du véhicule scannés au parc, affichés sur la fiche (Olivier
// 28/09/2026). Vignettes cliquables (ouvre la page en grand), documents
// reconnus et absents d'après la lecture. Rien ne s'affiche s'il n'y a pas
// de scan.

import { useEffect, useState } from 'react'
import { DOCUMENT_LABELS } from '@/lib/taches/accident-steps'

type Doc = { id: string; file_name: string | null; mime_type: string | null; created_at: string }

export default function ScanDocumentsCard({ missionId }: { missionId: string }) {
  const [data, setData] = useState<{ documents: Doc[]; recognized: string[]; missing: string[] } | null>(null)
  useEffect(() => {
    fetch(`/api/missions/${missionId}/scan-documents`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(setData).catch(() => {})
  }, [missionId])
  if (!data || data.documents.length === 0) return null
  return (
    <div className="bg-surface border rounded-2xl p-5">
      <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">📄 Documents du véhicule ({data.documents.length} page{data.documents.length > 1 ? 's' : ''})</h3>
      {(data.recognized.length > 0 || data.missing.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {data.recognized.map(t => <span key={t} className="rounded-full bg-success-soft text-success px-2 py-0.5 text-xs font-semibold">{DOCUMENT_LABELS[t] || t}</span>)}
          {data.missing.map(t => <span key={t} className="rounded-full bg-warning-soft text-warning px-2 py-0.5 text-xs font-semibold">Absent : {DOCUMENT_LABELS[t] || t}</span>)}
        </div>
      )}
      <div className="grid grid-cols-4 gap-1.5">
        {data.documents.map((d, i) => {
          const src = `/api/missions/documents/${d.id}?inline=1`
          const isPdf = (d.mime_type || '').includes('pdf')
          return (
            <a key={d.id} href={src} target="_blank" rel="noreferrer" className="relative block aspect-[3/4] overflow-hidden rounded-lg border border-border bg-surface-2">
              {isPdf ? <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-ink-secondary">PDF</span>
                : <img src={src} alt={`Page ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />}
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[11px] font-bold text-white">{i + 1}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
