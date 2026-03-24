'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Clock, CheckCircle2, AlertCircle, ChevronRight, Truck } from 'lucide-react'
import type { Session } from 'next-auth'
import type { VehicleCheck } from '@/types'

const STATUS_CONFIG = {
  scheduled:     { label: 'Planifié',                   color: 'text-zinc-400',  bg: 'bg-zinc-800',        icon: Clock         },
  pending_claim: { label: 'En attente de prise charge', color: 'text-yellow-400',bg: 'bg-yellow-900/30',   icon: AlertCircle   },
  in_progress:   { label: 'En cours',                   color: 'text-blue-400',  bg: 'bg-blue-900/30',     icon: ClipboardCheck},
  completed:     { label: 'Terminé',                    color: 'text-green-400', bg: 'bg-green-900/30',    icon: CheckCircle2  },
}

export default function CheckVehiculeClient({ session }: { session: Session }) {
  const router = useRouter()
  const [checks, setChecks]           = useState<VehicleCheck[]>([])
  const [activeCheck, setActiveCheck] = useState<VehicleCheck | null>(null)
  const [loading, setLoading]         = useState(true)

  const roles = Array.isArray((session.user as any)?.roles)
    ? (session.user as any).roles
    : [(session.user as any)?.role]
  const isResponsible = roles.some((r: string) =>
    ['admin', 'superadmin', 'dispatcher'].includes(r)
  )

  useEffect(() => {
    fetch('/api/check-vehicule')
      .then(r => r.json())
      .then(data => {
        setChecks(data.checks || [])
        setActiveCheck(data.activeCheck || null)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    )
  }

  const pendingClaims = checks.filter(c => c.status === 'pending_claim')
  const inProgress    = checks.filter(c => c.status === 'in_progress')
  const completed     = checks.filter(c => c.status === 'completed')

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-5">

      {/* Bannière driver: contrôle en cours sur son véhicule */}
      {!isResponsible && activeCheck && (
        <div className="bg-orange-500/15 border border-orange-500 rounded-xl p-4 flex items-start gap-3">
          <Truck className="text-orange-400 mt-0.5 flex-shrink-0" size={20} />
          <div>
            <p className="text-orange-300 font-semibold">Contrôle en cours sur votre véhicule</p>
            <p className="text-orange-200 text-sm mt-1">
              Véhicule <strong>{activeCheck.vehicle?.plate}</strong>
              {activeCheck.claimed_by_user && ` · Responsable\u00a0: ${activeCheck.claimed_by_user.name}`}
            </p>
            <p className="text-orange-400 text-xs mt-1.5">
              Présentez-vous avec le véhicule, les documents et le matériel.
            </p>
          </div>
        </div>
      )}

      {/* À prendre en charge (responsables) */}
      {isResponsible && pendingClaims.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-600 rounded-xl p-4">
          <p className="text-yellow-400 font-semibold text-sm mb-2">⚡ À prendre en charge</p>
          {pendingClaims.map(c => (
            <button key={c.id} onClick={() => router.push(`/check-vehicule/${c.id}`)}
              className="w-full flex items-center justify-between bg-yellow-900/30 hover:bg-yellow-900/50 rounded-lg p-3 mt-1.5 transition"
            >
              <div className="text-left">
                <p className="text-white font-medium">{c.vehicle?.name} — {c.vehicle?.plate}</p>
                <p className="text-yellow-400 text-xs mt-0.5">
                  Planifié le {new Date(c.scheduled_date).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
              </div>
              <ChevronRight className="text-yellow-400 flex-shrink-0" size={18} />
            </button>
          ))}
        </div>
      )}

      {/* En cours (responsables) */}
      {isResponsible && inProgress.map(c => (
        <button key={c.id} onClick={() => router.push(`/check-vehicule/${c.id}`)}
          className="w-full flex items-center justify-between bg-blue-900/20 border border-blue-700 rounded-xl p-4 hover:bg-blue-900/30 transition"
        >
          <div className="text-left">
            <p className="text-blue-400 text-xs font-semibold mb-1">EN COURS</p>
            <p className="text-white font-medium">{c.vehicle?.name} — {c.vehicle?.plate}</p>
            {c.claimed_by_user && <p className="text-zinc-400 text-xs mt-0.5">Responsable\u00a0: {c.claimed_by_user.name}</p>}
          </div>
          <ChevronRight className="text-blue-400 flex-shrink-0" size={18} />
        </button>
      ))}

      {/* Historique */}
      <div>
        <h2 className="text-zinc-400 text-sm font-medium mb-3">Historique</h2>
        {completed.length === 0 ? (
          <div className="text-center py-12 text-zinc-600">
            <ClipboardCheck size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">Aucun contrôle terminé</p>
          </div>
        ) : (
          <div className="space-y-2">
            {completed.map(c => (
              <button key={c.id} onClick={() => router.push(`/check-vehicule/${c.id}`)}
                className="w-full flex items-center gap-3 bg-surface border border-border hover:border-zinc-600 rounded-xl p-4 transition text-left"
              >
                <div className="p-2 rounded-lg bg-green-900/30">
                  <CheckCircle2 className="text-green-400" size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{c.vehicle?.name} — {c.vehicle?.plate}</p>
                  <p className="text-zinc-400 text-xs mt-0.5">
                    Terminé le {c.completed_at ? new Date(c.completed_at).toLocaleDateString('fr-BE') : '—'}
                    {c.claimed_by_user && ` · ${c.claimed_by_user.name}`}
                  </p>
                </div>
                <ChevronRight className="text-zinc-600 flex-shrink-0" size={16} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
