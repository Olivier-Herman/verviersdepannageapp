// src/app/admin/documents/AdminDocumentsClient.tsx
'use client'

import { useState } from 'react'
import Link         from 'next/link'
import { DOC_TYPES } from '@/app/documents/DocumentsClient'

interface Driver   { id: string; name: string; email: string }
interface Document {
  id:         string
  user_id:    string
  doc_type:   string
  expires_at: string
  file_url:   string
  notes?:     string
  user:       { name: string; email: string }
}

function daysUntilExpiry(expiresAt: string): number {
  const exp = new Date(expiresAt); const now = new Date()
  exp.setHours(0,0,0,0); now.setHours(0,0,0,0)
  return Math.ceil((exp.getTime() - now.getTime()) / 86400000)
}

function statusConfig(days: number) {
  if (days < 0)    return { color: 'text-red-500',    bg: 'bg-red-500/10',    label: 'Expiré',    dot: 'bg-red-500' }
  if (days <= 30)  return { color: 'text-red-400',    bg: 'bg-red-500/10',    label: '< 1 mois',  dot: 'bg-red-400' }
  if (days <= 90)  return { color: 'text-orange-400', bg: 'bg-orange-500/10', label: '< 3 mois',  dot: 'bg-orange-400' }
  if (days <= 180) return { color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: '< 6 mois',  dot: 'bg-yellow-400' }
  return             { color: 'text-green-400',  bg: 'bg-green-500/10',  label: 'Valide',    dot: 'bg-green-400' }
}

export default function AdminDocumentsClient({
  drivers,
  documents,
}: {
  drivers:   Driver[]
  documents: Document[]
}) {
  const [filter,   setFilter]   = useState('')
  const [viewDoc,  setViewDoc]  = useState<Document | null>(null)

  // Grouper les documents par chauffeur
  const byDriver = drivers.map(driver => {
    const driverDocs = documents.filter(d => d.user_id === driver.id)
    const docMap: Record<string, Document> = {}
    driverDocs.forEach(d => { docMap[d.doc_type] = d })
    return { driver, docMap }
  })

  const filtered = filter
    ? byDriver.filter(({ driver }) =>
        driver.name.toLowerCase().includes(filter.toLowerCase())
      )
    : byDriver

  // Stats globales
  const allDocs  = documents
  const expired  = allDocs.filter(d => daysUntilExpiry(d.expires_at) < 0).length
  const critical = allDocs.filter(d => { const days = daysUntilExpiry(d.expires_at); return days >= 0 && days <= 30 }).length
  const warning  = allDocs.filter(d => { const days = daysUntilExpiry(d.expires_at); return days > 30 && days <= 90 }).length
  const missing  = drivers.length * 4 - allDocs.length

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-white font-bold text-2xl mb-1">Documents chauffeurs</h1>
        <p className="text-zinc-500 text-sm">{drivers.length} chauffeurs · {allDocs.length} documents enregistrés</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Expirés',      value: expired,  color: 'text-red-400' },
          { label: '< 1 mois',     value: critical, color: 'text-orange-400' },
          { label: '< 3 mois',     value: warning,  color: 'text-yellow-400' },
          { label: 'Manquants',    value: missing,  color: 'text-zinc-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-zinc-500 text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filtre */}
      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="Rechercher un chauffeur…"
        className="w-full lg:max-w-sm bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl
                   px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-4" />

      {/* Tableau */}
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
        {/* Header tableau */}
        <div className="grid grid-cols-5 gap-4 px-4 py-3 border-b border-[#2a2a2a]
                        text-zinc-500 text-xs uppercase tracking-wider">
          <div>Chauffeur</div>
          {DOC_TYPES.map(dt => (
            <div key={dt.value} className="text-center">{dt.icon} {dt.label}</div>
          ))}
        </div>

        {/* Lignes */}
        {filtered.map(({ driver, docMap }) => (
          <div key={driver.id}
            className="grid grid-cols-5 gap-4 px-4 py-3 border-b border-[#1e1e1e]
                       hover:bg-[#222] transition-colors items-center">
            {/* Chauffeur */}
            <div>
              <p className="text-white text-sm font-medium">{driver.name}</p>
              <p className="text-zinc-600 text-xs">{driver.email}</p>
            </div>

            {/* Documents */}
            {DOC_TYPES.map(dt => {
              const doc  = docMap[dt.value]
              if (!doc) return (
                <div key={dt.value} className="text-center">
                  <span className="text-zinc-700 text-xs">Manquant</span>
                </div>
              )
              const days = daysUntilExpiry(doc.expires_at)
              const cfg  = statusConfig(days)
              return (
                <div key={dt.value} className="text-center">
                  <button onClick={() => setViewDoc(doc)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
                                font-medium ${cfg.bg} ${cfg.color} hover:opacity-80 transition-opacity`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {days < 0
                      ? `Expiré`
                      : new Date(doc.expires_at).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    }
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Modal vue document */}
      {viewDoc && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewDoc(null)}>
          <div className="bg-[#1A1A1A] rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-white font-bold">
                  {DOC_TYPES.find(d => d.value === viewDoc.doc_type)?.label}
                </h2>
                <p className="text-zinc-500 text-sm">{viewDoc.user?.name}</p>
              </div>
              <button onClick={() => setViewDoc(null)} className="text-zinc-500 text-2xl">×</button>
            </div>
            <img src={viewDoc.file_url} alt="Document"
              className="w-full rounded-xl border border-[#2a2a2a] mb-4 object-contain max-h-96 bg-[#0F0F0F]" />
            <div className="space-y-2">
              {[
                ['Chauffeur',   viewDoc.user?.name],
                ['Expiration',  new Date(viewDoc.expires_at).toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' })],
                ['Notes',       viewDoc.notes],
              ].filter(r => r[1]).map(([label, value]) => (
                <div key={label} className="flex justify-between py-2 border-b border-[#2a2a2a]">
                  <span className="text-zinc-500 text-sm">{label}</span>
                  <span className="text-white text-sm">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
