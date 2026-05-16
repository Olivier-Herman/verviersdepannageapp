'use client'

import { useEffect, useState } from 'react'
import { isInDaySchedule, isInNightSchedule } from '@/lib/schedule'

const PING_INTERVAL_MS    = 30_000
const SCHEDULE_CHECK_MS   = 60_000  // Re-evaluer l'horaire toutes les minutes
const STORAGE_KEY         = 'on-duty'

/**
 * Hook qui gère l'état "En service" :
 *  - Persiste en localStorage pour rester actif entre changements de page.
 *  - Quand actif : ping GPS toutes les 30s vers /api/users/ping-location.
 *  - Quand désactivé : POST /api/users/off-duty pour effacer la position.
 *  - Si le user a un planning (schedule_day / schedule_night) actif et qu'on
 *    est dans la plage horaire, le statut est FORCÉ on et le toggle est
 *    bloqué côté UI. Le hook expose `isLockedByDuty` pour que l'UI le sache.
 */
export function useOnDutyPing() {
  const [onDuty,        setOnDutyState]     = useState<boolean>(false)
  const [error,         setError]           = useState<string | null>(null)
  const [lastPing,      setLastPing]        = useState<Date | null>(null)
  const [isLockedByDuty, setIsLockedByDuty] = useState<boolean>(false)
  const [scheduleInfo,  setScheduleInfo]    = useState<{ day: boolean; night: boolean }>({ day: false, night: false })

  // Charge le planning du user courant
  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.json())
      .then(u => setScheduleInfo({ day: !!u.schedule_day, night: !!u.schedule_night }))
      .catch(() => {})
  }, [])

  // Hydrate le toggle depuis localStorage au montage
  useEffect(() => {
    if (typeof window === 'undefined') return
    setOnDutyState(localStorage.getItem(STORAGE_KEY) === '1')
  }, [])

  // Vérifie en continu si on est dans la plage horaire planifiée → force on duty
  useEffect(() => {
    const evaluate = () => {
      const now = new Date()
      const inDay   = scheduleInfo.day   && isInDaySchedule(now)
      const inNight = scheduleInfo.night && isInNightSchedule(now)
      const forced  = inDay || inNight
      setIsLockedByDuty(forced)
      if (forced && !onDuty) {
        setOnDutyState(true)
        if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, '1')
      }
    }
    evaluate()
    const id = setInterval(evaluate, SCHEDULE_CHECK_MS)
    return () => clearInterval(id)
  }, [scheduleInfo.day, scheduleInfo.night, onDuty])

  // Boucle de ping GPS
  // Web : navigator.geolocation.getCurrentPosition + setInterval (s arrete en
  //       background sur iOS Safari, mais c est le web behavior attendu).
  // Capacitor iOS : @capacitor/geolocation.watchPosition + Background Modes
  //                 location → continue a recevoir des positions meme app fermee.
  //                 Throttle pour ne POST qu une fois toutes les 30s.
  useEffect(() => {
    if (!onDuty) return

    let cancelled = false
    let lastPostMs = 0
    let webIntervalId: any = null
    let capWatchId: string | null = null

    const postPing = async (lat: number, lng: number) => {
      const now = Date.now()
      if (now - lastPostMs < PING_INTERVAL_MS - 1000) return  // throttle 30s
      lastPostMs = now
      try {
        await fetch('/api/users/ping-location', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ lat, lng }),
        })
        if (!cancelled) { setLastPing(new Date()); setError(null) }
      } catch {
        if (!cancelled) setError('Erreur reseau lors du ping')
      }
    }

    ;(async () => {
      // Capacitor (mobile native) : watchPosition continue en background
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (Capacitor.isNativePlatform()) {
          const { Geolocation } = await import('@capacitor/geolocation')
          // Permission Always pour background ; iOS demandera quand meme
          // l autorisation systeme la premiere fois
          await Geolocation.requestPermissions().catch(() => {})
          capWatchId = await Geolocation.watchPosition(
            { enableHighAccuracy: false, timeout: 10_000 },
            (pos, err) => {
              if (cancelled) return
              if (err) { setError(err.message || 'Erreur GPS'); return }
              if (!pos) return
              postPing(pos.coords.latitude, pos.coords.longitude)
            }
          )
          return
        }
      } catch {
        // pas capacitor → fallback web ci-dessous
      }

      // Web (browser) : getCurrentPosition + setInterval
      if (!navigator.geolocation) {
        setError('Geolocalisation non disponible')
        return
      }
      const sendPingWeb = () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => { if (!cancelled) postPing(pos.coords.latitude, pos.coords.longitude) },
          (err) => { if (!cancelled) setError(err.message || 'Permission GPS refusee') },
          { enableHighAccuracy: false, maximumAge: 15_000, timeout: 10_000 }
        )
      }
      sendPingWeb()
      webIntervalId = setInterval(sendPingWeb, PING_INTERVAL_MS)
    })()

    return () => {
      cancelled = true
      if (webIntervalId) clearInterval(webIntervalId)
      if (capWatchId) {
        import('@capacitor/geolocation')
          .then(({ Geolocation }) => Geolocation.clearWatch({ id: capWatchId! }))
          .catch(() => {})
      }
    }
  }, [onDuty])

  const setOnDuty = (value: boolean) => {
    if (isLockedByDuty && !value) return  // Verrouille off pendant les heures planifiées
    setOnDutyState(value)
    if (typeof window !== 'undefined') {
      if (value) localStorage.setItem(STORAGE_KEY, '1')
      else       localStorage.removeItem(STORAGE_KEY)
    }
    if (!value) {
      fetch('/api/users/off-duty', { method: 'POST' }).catch(() => {})
      setError(null)
      setLastPing(null)
    }
  }

  return { onDuty, setOnDuty, lastPing, error, isLockedByDuty, scheduleInfo }
}
