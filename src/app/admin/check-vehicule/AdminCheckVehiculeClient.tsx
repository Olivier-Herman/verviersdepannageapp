'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardCheck, Play, Clock, CheckCircle2, AlertCircle,
  Loader2, ChevronRight, Settings
} from 'lucide-react'
import type { VehicleCheck } from '@/types'

const STATUS_CONFIG = {
  scheduled:     { label: 'Planifié',    color: 'text-zinc-400',   icon: Clock         },
  pending_claim: { label: 'En attente',  color: 'text-yellow-400', icon: AlertCircle   },
  in_progress:   { label: 'En cours',    color: 'text-blue-400',   icon: ClipboardCheck},
  completed:     { label: 'Terminé',     color: 'text-green-400',  icon: CheckCircle2  },
}

export default function AdminCheckVehiculeClient() {
  const router = useRouter()
  const [checks, setChecks]             = useState<VehicleCheck[]>([])
  const [loading, setLoading]           = useState(true)
  const [triggering, setTriggering]     = useState(false)
  const [triggerResult, setTriggerResult] = useState<{ vehicleName: string; date: string } | null>(null)
  const [triggerError, setTriggerError] = useState('')

  const load = () => {
    fetch('/api/check-vehicule')
      .then(r => r.json())
      .then(data => setChecks(data.checks || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleTrigger = async () => {
    setTriggering(true)
    setTriggerError('')
    setTriggerResult(null)
    const res  = await fetch('/api/check-vehicule/trigger', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) {
      setTriggerError(data.error || 'Erreur lors du tirage')
    } else {
      setTriggerResult({
        vehicleName: `${data.vehicle.name} (${data.vehicle.plate})`,
        date: new Date(data.scheduledDate).toLocaleDateString('fr-BE', {
          weekday: 'long', day: 'numeric', month: 'long'
        }),
      })
      load()
    }
    setTriggering(false)
  }

  const stats = {
    total:    checks.length,
    pending:  checks.filter(c => ['scheduled', 'pending_claim', 'in_progress'].includes(c.status)).length,
    completed: checks.filter(c => c.status === 'completed').length,
    withNC:   checks.filter(c => c.results?.some(r => r.ok === false)).length,
  }

  return (
    <div>
      <div className="max-w-3xl mx-auto p-4 space-y-6">

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="text-brand" size={26} />
            <h1 className="text-xl font-bold text-white">Contrôles Véhicule</h1>
          </div>
          <button onClick={() => router.push('/admin/check-vehicule/settings')}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition text-sm px-3 py-2 rounded-lg bg-surface border border-border"
          >
            <Settings size={15} /> Paramètres
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total',       value: stats.total,     color: 'text-white'       },
            { label: 'En cours',    value: stats.pending,   color: 'text-blue-400'    },
            { label: 'Terminés',    value: stats.completed, color: 'text-green-400'   },
            { label: 'Avec N/C',    value: stats.withNC,    color: 'text-red-400'     },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-border rounded-xl p-3 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-zinc-500 text-xs mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Déclencher */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <h2 className="text-white font-semibold mb-2 flex items-center gap-2">
            <Play size={18} className="text-brand" /> Déclencher un contrôle
          </h2>
          <p className="text-zinc-400 text-sm mb-4">
            Sélectionne aléatoirement un véhicule (≠ dernier contrôle) et planifie la date
            un mardi, mercredi ou jeudi. Les responsables recevront un push le matin à 9h.
          </p>

          {triggerError && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 mb-4 text-red-300 text-sm">
              {triggerError}
            </div>
          )}
          {triggerResult && (
            <div className="bg-green-900/20 border border-green-700 rounded-lg p-3 mb-4">
              <p className="text-green-300 text-sm font-semibold">✅ Contrôle planifié</p>
              <p className="text-green-400 text-sm mt-1">
                <strong>{triggerResult.vehicleName}</strong> · {triggerResult.date}
              </p>
            </div>
          )}

          <button onClick={handleTrigger} disabled={triggering}
            className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white font-semibold px-6 py-3 rounded-xl transition disabled:opacity-50"
          >
            {triggering ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
            Lancer le tirage au sort
          </button>
        </div>

        {/* Historique */}
        <div>
          <h2 className="text-zinc-400 text-sm font-medium mb-3">Historique complet</h2>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-brand" size={28} />
            </div>
          ) : checks.length === 0 ? (
            <div className="text-center py-12 text-zinc-600">
              <ClipboardCheck size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">Aucun contrôle enregistré</p>
            </div>
          ) : (
            <div className="space-y-2">
              {checks.map(c => {
                const cfg      = STATUS_CONFIG[c.status]
                const Icon     = cfg.icon
                const ncCount  = c.results?.filter(r => r.ok === false).length ?? 0
                return (
                  <button key={c.id} onClick={() => router.push(`/check-vehicule/${c.id}`)}
                    className="w-full flex items-center gap-3 bg-surface border border-border hover:border-zinc-600 rounded-xl p-4 transition text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <Icon className={cfg.color} size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-medium truncate">
                          {c.vehicle?.name} — {c.vehicle?.plate}
                        </p>
                        {ncCount > 0 && (
                          <span className="flex-shrink-0 bg-red-900/50 text-red-400 text-xs px-1.5 py-0.5 rounded-full">
                            {ncCount} N/C
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-500 text-xs mt-0.5">
                        <span className={cfg.color}>{cfg.label}</span>
                        {' · '}
                        {new Date(c.scheduled_date).toLocaleDateString('fr-BE', {
                          weekday: 'long', day: 'numeric', month: 'long'
                        })}
                        {c.claimed_by_user && ` · ${c.claimed_by_user.name}`}
                      </p>
                    </div>
                    <ChevronRight className="text-zinc-600 flex-shrink-0" size={16} />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
