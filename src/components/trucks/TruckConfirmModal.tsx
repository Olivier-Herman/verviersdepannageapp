'use client'

// Modal global qui s ouvre :
// - A la premiere ouverture apres 7h00 OU 17h00 de la journee, si current_truck_set_at < dernier seuil
// - Si aucun current_truck assigne (force la selection initiale)
//
// Olivier 2026-06-01 : "On ajoute un modal a la premiere ouverture apres 7h
// et 17h qui demande 'Utilises tu bien le camion ...' avec un oui ou non
// modifier et qu il puisse adapter".
//
// Monte au niveau Providers (visible dans toute l app).

import { useEffect, useState } from 'react'
import { useSession }          from 'next-auth/react'

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

const ROLES_WITH_TRUCK = ['driver', 'dispatcher', 'admin', 'superadmin']

export function TruckConfirmModal() {
  const { data: session, status } = useSession()
  const [state,   setState]   = useState<CurrentTruckState | null>(null)
  const [trucks,  setTrucks]  = useState<Truck[]>([])
  const [view,    setView]    = useState<'confirm' | 'select' | 'closed'>('closed')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Charge l etat au mount + a chaque changement de session
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user) return
    const user = session.user as any
    const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
    // Seuls les users qui peuvent rouler un camion ont le modal
    const concerned = roles.some(r => ROLES_WITH_TRUCK.includes(r))
    if (!concerned) return

    // Olivier 2026-06-01 : pre-check : si l admin n a pas encore configure de
    // depanneuses, on n affiche RIEN (pas de modal bloquant). L admin doit
    // d abord aller sur /admin/trucks pour configurer.
    Promise.all([
      fetch('/api/users/me/current-truck').then(r => r.json()),
      fetch('/api/trucks').then(r => r.json()),
    ]).then(([currentData, trucksData]: [CurrentTruckState, { trucks: Truck[] }]) => {
      const trucksList = trucksData?.trucks || []
      setTrucks(trucksList)
      setState(currentData)

      // Olivier 2026-06-01 : si l user a desactive la confirmation (admin
      // pur, dispatcher non-roulant, etc.), on n affiche jamais.
      if (currentData.confirm_disabled) return

      // Aucune depanneuse configuree -> on ne montre rien (pas bloquant)
      if (trucksList.length === 0) return

      // Si pas de current_truck ET pas de default : ouvre selection
      if (!currentData.current_truck && !currentData.default_truck) {
        setView('select')
      } else if (currentData.needs_confirmation) {
        // Suggere le current_truck si dispo, sinon le default
        setView('confirm')
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function loadTrucks() {
    try {
      const res = await fetch('/api/trucks')
      const data = await res.json()
      setTrucks(data.trucks || [])
      return data.trucks || []
    } catch (e: any) {
      setError(e.message)
      return []
    }
  }

  async function confirmYes() {
    if (!state) return
    const truckId = state.current_truck?.id || state.default_truck?.id || null
    setBusy(true); setError(null)
    try {
      await fetch('/api/users/me/current-truck', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ truck_id: truckId }),
      })
      setView('closed')
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function pickTruck(truckId: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/users/me/current-truck', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ truck_id: truckId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      // Recharge l etat
      const refreshed = await fetch('/api/users/me/current-truck').then(r => r.json())
      setState(refreshed)
      setView('closed')
    } catch (e: any) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  if (view === 'closed') return null

  const suggested = state?.current_truck || state?.default_truck

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-2xl border p-5 space-y-4">

        {view === 'confirm' && suggested && (
          <>
            <div className="text-center">
              <div className="text-5xl mb-3">🚚</div>
              <h3 className="text-xl font-bold text-gray-900">Confirme ta dépanneuse</h3>
              <p className="text-gray-600 text-sm mt-2">Utilises-tu bien :</p>
            </div>

            <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4 text-center">
              <p className="text-blue-900 font-bold text-lg">{suggested.name}</p>
              <p className="text-blue-700 text-sm font-mono mt-1">{suggested.plate}</p>
              {(suggested.brand || suggested.model) && (
                <p className="text-blue-600 text-xs mt-1">{[suggested.brand, suggested.model].filter(Boolean).join(' · ')}</p>
              )}
            </div>

            {error && <p className="text-red-600 text-xs text-center">⚠ {error}</p>}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setView('select'); loadTrucks() }}
                disabled={busy}
                className="py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold disabled:opacity-50">
                Non, modifier
              </button>
              <button onClick={confirmYes} disabled={busy}
                className="py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold disabled:opacity-50">
                {busy ? '⏳ ...' : '✓ Oui'}
              </button>
            </div>
          </>
        )}

        {view === 'select' && (
          <>
            <div className="text-center">
              <div className="text-5xl mb-3">🚚</div>
              <h3 className="text-xl font-bold text-gray-900">Choisis ta dépanneuse</h3>
              <p className="text-gray-600 text-sm mt-1">Pour aujourd'hui — modifiable à tout moment dans ton profil.</p>
            </div>

            {trucks.length === 0 ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 text-center">
                <p className="text-amber-900 font-semibold">⚠️ Aucune dépanneuse configurée</p>
                <p className="text-amber-700 text-xs mt-2">
                  L'administrateur n'a pas encore ajouté les dépanneuses dans <strong>/admin/trucks</strong>. Préviens-le pour qu'il les saisisse.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {trucks.map(t => (
                  <button key={t.id}
                    onClick={() => pickTruck(t.id)}
                    disabled={busy}
                    className="w-full text-left p-3 bg-gray-50 hover:bg-blue-50 border-2 hover:border-blue-300 border-gray-200 rounded-xl transition disabled:opacity-50">
                    <p className="text-gray-900 font-bold">{t.name}</p>
                    <p className="text-gray-600 text-sm font-mono">{t.plate}</p>
                    {(t.brand || t.model) && (
                      <p className="text-gray-500 text-xs">{[t.brand, t.model].filter(Boolean).join(' · ')}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            {error && <p className="text-red-600 text-xs text-center">⚠ {error}</p>}

            {/* Bouton "Fermer" toujours visible (jamais bloquer l app, meme si truck non choisi) */}
            <button onClick={() => setView('closed')} disabled={busy}
              className="w-full py-2 text-gray-500 text-sm hover:text-gray-700">
              {trucks.length === 0 ? 'Fermer' : 'Plus tard'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
