'use client'

// Widget chauffeur pour changer manuellement de depanneuse, accessible
// depuis n importe quel ecran (notamment /mission ou il passe le plus de
// temps). Olivier 2026-06-02.
//
// Affiche le truck actuel en ligne compacte + bouton "Changer" qui ouvre
// un mini-modal de selection. POST /api/users/me/current-truck a la
// validation.
//
// Reserve aux users avec role 'driver' (cf [[trucks-modal-driver-only]]).

import { useEffect, useState } from 'react'
import { useSession }          from 'next-auth/react'
import { T }                   from '@/lib/i18n/T'

interface Truck {
  id:     string
  name:   string
  plate:  string
  brand?: string | null
  model?: string | null
}

interface CurrentTruckState {
  default_truck:        Truck | null
  current_truck:        Truck | null
  current_truck_set_at: string | null
  needs_confirmation:   boolean
  confirm_disabled?:    boolean
}

export function TruckSwitcher() {
  const { data: session, status: sessionStatus } = useSession()
  const [state,  setState]  = useState<CurrentTruckState | null>(null)
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [open,   setOpen]   = useState(false)
  const [busy,   setBusy]   = useState(false)

  // Charge l etat initial — seulement si l user est driver
  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !session?.user) return
    const user = session.user as any
    const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
    if (!roles.includes('driver')) return

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

  // Pas affiche si pas un driver, ou si aucun truck assigne et trucks vides
  // (admin n a pas configure les depanneuses ; on ne pollue pas l UI)
  if (!session) return null
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!roles.includes('driver')) return null
  if (!state) return null

  const current = state.current_truck || state.default_truck

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-surface border rounded-2xl hover:border-strong transition text-left"
      >
        <span className="text-xl">🚚</span>
        <div className="flex-1 min-w-0">
          {current ? (
            <>
              <p className="text-ink text-sm font-semibold leading-tight">{current.name}</p>
              <p className="text-ink-muted text-xs font-mono">{current.plate}</p>
            </>
          ) : (
            <p className="text-ink-muted text-sm"><T k="truck_modal.switcher_none" /></p>
          )}
        </div>
        <span className="text-ink-muted text-xs font-medium"><T k="truck_modal.switcher_change" /></span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm p-4"
             onClick={() => !busy && setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
               className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl border p-5 space-y-4">
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
              <div className="space-y-2 max-h-72 overflow-y-auto">
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
      )}
    </>
  )
}
