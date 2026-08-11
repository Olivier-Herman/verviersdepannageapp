'use client'

// Olivier 2026-06-05 : variante 'icon' du TruckSwitcher pour le header
// AppShell (a cote de la loupe). Affiche un bouton compact avec icone
// camion + petite plaque, ouvre le meme modal de selection que le
// TruckSwitcher 'card'.
//
// Reserve aux roles autorises (driver / admin / superadmin / dispatcher).

import { useEffect, useState } from 'react'
import { createPortal }         from 'react-dom'
import { useSession }          from 'next-auth/react'
import { Truck }               from 'lucide-react'
import { T }                   from '@/lib/i18n/T'

interface TruckItem {
  id:     string
  name:   string
  plate:  string
  brand?: string | null
  model?: string | null
}

interface CurrentTruckState {
  default_truck:        TruckItem | null
  current_truck:        TruckItem | null
  current_truck_set_at: string | null
  needs_confirmation:   boolean
  confirm_disabled?:    boolean
}

const TRUCK_SWITCH_ALLOWED_ROLES = ['driver', 'admin', 'superadmin', 'dispatcher']

export function TruckSwitcherIcon() {
  const { data: session, status: sessionStatus } = useSession()
  const [state,  setState]  = useState<CurrentTruckState | null>(null)
  const [trucks, setTrucks] = useState<TruckItem[]>([])
  const [open,   setOpen]   = useState(false)
  const [busy,   setBusy]   = useState(false)

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !session?.user) return
    const user = session.user as any
    const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
    if (!TRUCK_SWITCH_ALLOWED_ROLES.some(r => roles.includes(r))) return

    fetch('/api/users/me/current-truck')
      .then(r => r.json())
      .then((data: CurrentTruckState) => setState(data))
      .catch(() => {})
  }, [sessionStatus, session])

  async function openPicker() {
    setOpen(true)
    if (trucks.length === 0) {
      try {
        const res  = await fetch('/api/trucks')
        const data = await res.json()
        setTrucks(data.trucks || [])
      } catch {/* silent */}
    }
  }

  async function pickTruck(truckId: string) {
    setBusy(true)
    try {
      await fetch('/api/users/me/current-truck', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ truck_id: truckId }),
      })
      const refreshed = await fetch('/api/users/me/current-truck').then(r => r.json())
      setState(refreshed)
      setOpen(false)
    } catch {/* silent */}
    finally { setBusy(false) }
  }

  if (!session) return null
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!TRUCK_SWITCH_ALLOWED_ROLES.some(r => roles.includes(r))) return null
  if (!state) return null

  const current = state.current_truck || state.default_truck

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        title={current ? `Camion : ${current.name} (${current.plate})` : 'Choisir un camion'}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink transition"
      >
        <Truck size={14} />
        {current
          ? <span className="text-xs font-mono font-semibold hidden sm:inline">{current.plate}</span>
          : <span className="text-xs hidden sm:inline">Camion</span>
        }
      </button>

      {/* Monte sur <body> : ce composant vit dans le header `sticky z-20`, qui
          cree un contexte d'empilement — sans portal le modal passe SOUS la sidebar. */}
      {open && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
             onClick={() => !busy && setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
               className="bg-white w-full max-w-md rounded-2xl border p-5 space-y-4 max-h-[90vh] overflow-y-auto my-auto">
            <div className="text-center">
              <div className="text-4xl mb-2">🚚</div>
              <h3 className="text-gray-900 font-bold text-lg"><T k="truck_modal.select_title" /></h3>
              <p className="text-gray-500 text-xs mt-1"><T k="truck_modal.switcher_subtitle" /></p>
            </div>

            {trucks.length === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 text-center">
                <p className="text-amber-900 text-sm font-semibold"><T k="truck_modal.no_trucks_title" /></p>
                <p className="text-amber-700 text-xs mt-1">
                  <T k="truck_modal.no_trucks_subtitle" />
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {trucks.map(t => {
                  const isCurrent = current?.id === t.id
                  return (
                    <button key={t.id}
                      onClick={() => !isCurrent && pickTruck(t.id)}
                      disabled={busy || isCurrent}
                      className={`w-full text-left p-3 border-2 rounded-xl transition ${
                        isCurrent
                          ? 'bg-blue-100 border-blue-400 cursor-default'
                          : 'bg-gray-50 border-gray-200 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-50'
                      }`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-900 font-bold">{t.name}</p>
                          <p className="text-gray-600 text-sm font-mono">{t.plate}</p>
                          {(t.brand || t.model) && (
                            <p className="text-gray-500 text-xs">{[t.brand, t.model].filter(Boolean).join(' · ')}</p>
                          )}
                        </div>
                        {isCurrent && <span className="text-blue-600 text-sm font-bold"><T k="truck_modal.current" /></span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            <button onClick={() => setOpen(false)} disabled={busy}
              className="w-full py-2.5 text-gray-500 text-sm hover:text-gray-700">
              <T k="truck_modal.btn_close" />
            </button>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
