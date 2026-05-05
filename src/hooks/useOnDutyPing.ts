'use client'

import { useEffect, useState } from 'react'

const PING_INTERVAL_MS    = 30_000
const STORAGE_KEY         = 'on-duty'

/**
 * Hook qui gère l'état "En service" :
 *  - Persiste dans localStorage pour rester actif entre changements de page.
 *  - Quand actif : demande la position GPS toutes les 30s et la POST sur
 *    /api/users/ping-location pour que le dispatcher voit la position
 *    en temps réel dans le modal "Choisir un chauffeur".
 *  - Quand désactivé : appelle /api/users/off-duty pour effacer la position.
 *
 * Utilisable depuis n'importe quelle page (Sidebar, Dashboard, etc).
 */
export function useOnDutyPing() {
  const [onDuty, setOnDutyState] = useState<boolean>(false)
  const [error,  setError]       = useState<string | null>(null)
  const [lastPing, setLastPing]  = useState<Date | null>(null)

  // Hydrate depuis localStorage au montage
  useEffect(() => {
    if (typeof window === 'undefined') return
    setOnDutyState(localStorage.getItem(STORAGE_KEY) === '1')
  }, [])

  // Boucle de ping
  useEffect(() => {
    if (!onDuty) return

    let cancelled = false
    const sendPing = () => {
      if (!navigator.geolocation) {
        setError('Géolocalisation non disponible sur ce navigateur')
        return
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return
          try {
            await fetch('/api/users/ping-location', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            })
            setLastPing(new Date())
            setError(null)
          } catch {
            setError('Erreur réseau lors du ping')
          }
        },
        (err) => { if (!cancelled) setError(err.message || 'Permission GPS refusée') },
        { enableHighAccuracy: false, maximumAge: 15_000, timeout: 10_000 }
      )
    }

    sendPing()
    const id = setInterval(sendPing, PING_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [onDuty])

  const setOnDuty = (value: boolean) => {
    setOnDutyState(value)
    if (typeof window !== 'undefined') {
      if (value) localStorage.setItem(STORAGE_KEY, '1')
      else       localStorage.removeItem(STORAGE_KEY)
    }
    if (!value) {
      // Effacer la position côté serveur
      fetch('/api/users/off-duty', { method: 'POST' }).catch(() => {})
      setError(null)
      setLastPing(null)
    }
  }

  return { onDuty, setOnDuty, lastPing, error }
}
