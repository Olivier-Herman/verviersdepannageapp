'use client'

import { useEffect, useState } from 'react'
import Link                    from 'next/link'

interface Mission {
  id:                string
  mission_number:    number | null
  status:            string
  mission_type:      string | null
  vehicle_plate:     string | null
  vehicle_brand:     string | null
  vehicle_model:     string | null
  incident_address:  string | null
  incident_city:     string | null
  received_at:       string
  accepted_at:       string | null
  completed_at:      string | null
  remarks_general:   string | null
  commanded_by:      string | null
  invoice:           { number: string | null } | null
  credit_note:       { number: string | null } | null
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new:         { label: 'Reçue',     color: 'bg-blue-100 text-blue-800' },
  assigned:    { label: 'Assignée',  color: 'bg-indigo-100 text-indigo-800' },
  accepted:    { label: 'Acceptée',  color: 'bg-indigo-100 text-indigo-800' },
  in_progress: { label: 'En cours',  color: 'bg-orange-100 text-orange-800' },
  delivering:  { label: 'Livraison', color: 'bg-teal-100 text-teal-800' },
  completed:   { label: 'Terminée',  color: 'bg-green-100 text-green-800' },
  to_invoice:  { label: 'Terminée',  color: 'bg-green-100 text-green-800' },
  cancelled:   { label: 'Annulée',   color: 'bg-gray-100 text-gray-600' },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function GarageDashboardPage() {
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/garage/missions')
      .then(r => r.json())
      .then(d => setMissions(d.missions || []))
      .finally(() => setLoading(false))
  }, [])

  const inProgress = missions.filter(m => !['completed', 'to_invoice', 'cancelled'].includes(m.status))
  const finished   = missions.filter(m =>  ['completed', 'to_invoice', 'cancelled'].includes(m.status))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">Mes missions</h1>
        <Link href="/garage/demande"
          className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold px-3.5 py-2 rounded-xl">
          + Nouvelle demande
        </Link>
      </div>

      {loading && <p className="text-gray-400 text-sm">Chargement…</p>}

      {!loading && missions.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
          <div className="text-5xl mb-3">🚗</div>
          <p className="text-gray-900 font-semibold mb-1">Aucune demande pour le moment</p>
          <p className="text-gray-500 text-sm mb-6">Crée ta première demande d&apos;intervention quand tu en as besoin.</p>
          <Link href="/garage/demande"
            className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl">
            + Nouvelle demande
          </Link>
        </div>
      )}

      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-widest font-bold text-gray-500">En cours ({inProgress.length})</h2>
          <ul className="space-y-2">
            {inProgress.map(m => <MissionCard key={m.id} m={m} />)}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-widest font-bold text-gray-500">Terminées ({finished.length})</h2>
          <ul className="space-y-2">
            {finished.slice(0, 10).map(m => <MissionCard key={m.id} m={m} />)}
          </ul>
        </section>
      )}
    </div>
  )
}

function MissionCard({ m }: { m: Mission }) {
  const cfg = STATUS_LABEL[m.status] || { label: m.status, color: 'bg-gray-100 text-gray-700' }
  const hasDocs = !!(m.invoice || m.credit_note)
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
              {m.mission_type === 'depannage'  && <span className="text-xs text-gray-500 font-semibold">🔧 DSP</span>}
              {m.mission_type === 'remorquage' && <span className="text-xs text-gray-500 font-semibold">🚛 REM</span>}
            </div>
            <p className="text-gray-900 font-bold">
              {m.vehicle_plate && <span className="font-mono">{m.vehicle_plate}</span>}
              {(m.vehicle_brand || m.vehicle_model) && <span className="text-gray-600 font-normal"> · {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}</span>}
            </p>
            {m.incident_address && (
              <p className="text-gray-500 text-sm mt-0.5 truncate">📍 {m.incident_address}{m.incident_city ? `, ${m.incident_city}` : ''}</p>
            )}
            {m.commanded_by && (
              <p className="text-gray-500 text-sm mt-0.5">👤 Commandé par&nbsp;: <span className="text-gray-700 font-medium">{m.commanded_by}</span></p>
            )}
          </div>
        </div>
        <p className="text-gray-400 text-xs">
          Reçue le {fmtDate(m.received_at)}
          {m.mission_number && <span className="ml-2 text-gray-300 font-mono">#{m.mission_number}</span>}
        </p>
      </div>

      {hasDocs && (
        <div className="flex flex-wrap gap-2 px-4 pb-3 pt-3 border-t border-gray-100">
          {m.invoice && (
            <a href={`/api/garage/missions/${m.id}/document-pdf?type=invoice`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2.5 py-1.5 transition">
              📄 Facture{m.invoice.number ? ` ${m.invoice.number}` : ''}
            </a>
          )}
          {m.credit_note && (
            <a href={`/api/garage/missions/${m.id}/document-pdf?type=credit_note`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg px-2.5 py-1.5 transition">
              📄 Note de crédit{m.credit_note.number ? ` ${m.credit_note.number}` : ''}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
