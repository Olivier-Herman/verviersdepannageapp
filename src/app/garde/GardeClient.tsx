'use client'

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'

interface Driver {
  id:              string
  name:            string
  towsoft_name:    string
  schedule_day:    boolean
  schedule_night:  boolean
}

export default function GardeClient({
  userName,
  userRole,
  userModules = [],
}: {
  userName:     string
  userRole:     string
  userModules?: string[]
}) {
  const [drivers, setDrivers]   = useState<Driver[]>([])
  const [loading, setLoading]   = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/garde').then(async r => {
      const d = await r.json()
      if (!r.ok) {
        setError(`HTTP ${r.status}: ${d.error || 'erreur inconnue'}`)
      } else if (Array.isArray(d)) {
        setDrivers(d)
      } else {
        setError(`Réponse inattendue : ${JSON.stringify(d)}`)
      }
      setLoading(false)
    }).catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const toggle = async (driver: Driver, field: 'schedule_day' | 'schedule_night') => {
    const newVal = !driver[field]
    setSavingId(driver.id)
    setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, [field]: newVal } : d))
    try {
      await fetch('/api/garde', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: driver.id, [field]: newVal }),
      })
    } catch {
      setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, [field]: !newVal } : d))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <AppShell title="🛡️ Garde — Planning chauffeurs" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="px-4 lg:px-8 py-5 lg:py-6 max-w-4xl mx-auto">
        <p className="text-zinc-400 text-sm mb-6">
          Active les plages pendant lesquelles chaque chauffeur est forcé en service.
          Pendant ces heures, ils ne pourront pas se mettre hors service depuis leur dashboard.
        </p>

        {loading && <p className="text-zinc-500 text-center py-8">Chargement…</p>}

        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            <p className="font-semibold mb-1">Erreur</p>
            <p className="text-xs">{error}</p>
          </div>
        )}

        {!loading && !error && drivers.length === 0 && (
          <p className="text-zinc-500 text-center py-8">Aucun chauffeur actif (towsoft_name manquant ?)</p>
        )}

        <div className="space-y-2">
          {drivers.map(d => (
            <div key={d.id} className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-white font-semibold">{d.name}</p>
                  <p className="text-zinc-500 text-xs">TowSoft: {d.towsoft_name}</p>
                </div>
                {savingId === d.id && <span className="text-zinc-500 text-xs">…</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button"
                  onClick={() => toggle(d, 'schedule_day')}
                  className={`px-3 py-3 rounded-xl border text-left transition ${
                    d.schedule_day
                      ? 'bg-green-500/10 border-green-500/40'
                      : 'bg-[#0F0F0F] border-[#2a2a2a] hover:border-zinc-600'
                  }`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold">☀️ Jour</span>
                    <span className={`w-2 h-2 rounded-full ${d.schedule_day ? 'bg-green-400' : 'bg-zinc-600'}`} />
                  </div>
                  <p className="text-zinc-500 text-xs">07:00 → 20:00</p>
                </button>
                <button type="button"
                  onClick={() => toggle(d, 'schedule_night')}
                  className={`px-3 py-3 rounded-xl border text-left transition ${
                    d.schedule_night
                      ? 'bg-indigo-500/10 border-indigo-500/40'
                      : 'bg-[#0F0F0F] border-[#2a2a2a] hover:border-zinc-600'
                  }`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold">🌙 Nuit / Garde</span>
                    <span className={`w-2 h-2 rounded-full ${d.schedule_night ? 'bg-indigo-400' : 'bg-zinc-600'}`} />
                  </div>
                  <p className="text-zinc-500 text-xs">17:00 → 09:00</p>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
