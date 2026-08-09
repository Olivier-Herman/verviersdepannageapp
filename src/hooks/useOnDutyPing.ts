'use client'

import { useEffect, useState } from 'react'
import { isInDaySchedule, isInNightSchedule } from '@/lib/schedule'

const SCHEDULE_CHECK_MS   = 60_000  // Re-evaluer l'horaire toutes les minutes
const STORAGE_KEY         = 'on-duty'

// Synchronise le statut de présence MANUEL (users.manual_offline) — c'est CE
// champ que lit le dispatch pour la bulle rouge clignotante d'un chauffeur passé
// « Hors service ». Sans ça, le toggle ne faisait que du localStorage + off-duty
// GPS et le dispatch ne voyait jamais le passage hors ligne. Olivier 2026-08-09.
function pushPresence(offline: boolean) {
  fetch('/api/users/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offline }),
  }).catch(() => {})
}

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
    const isOn = localStorage.getItem(STORAGE_KEY) === '1'
    setOnDutyState(isOn)
    // Auto-réparation : un chauffeur qui rouvre l'app en étant « en service » ne
    // doit jamais rester bloqué en hors-ligne côté dispatch (bulle rouge fantôme).
    if (isOn) pushPresence(false)
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
        pushPresence(false)  // planning force en service → plus hors ligne
      }
    }
    evaluate()
    const id = setInterval(evaluate, SCHEDULE_CHECK_MS)
    return () => clearInterval(id)
  }, [scheduleInfo.day, scheduleInfo.night, onDuty])

  // ⚠️ Le GPS n'est PLUS piloté ici. Décision Olivier 2026-07-26 : le GPS ne
  // s'active QUE lorsqu'une mission est attribuée au chauffeur (cf.
  // useMissionGpsTracking, monté dans AppShell) — fini le GPS toute la vacation
  // qui vidait la batterie. Ce toggle « En service » ne sert donc plus qu'à
  // l'affichage présence / planning ; il ne déclenche aucun ping GPS.

  const setOnDuty = (value: boolean) => {
    if (isLockedByDuty && !value) return  // Verrouille off pendant les heures planifiées
    setOnDutyState(value)
    if (typeof window !== 'undefined') {
      if (value) localStorage.setItem(STORAGE_KEY, '1')
      else       localStorage.removeItem(STORAGE_KEY)
    }
    // En service → manual_offline=false ; Hors service → manual_offline=true
    // (bulle rouge clignotante au dispatch). C'est le cœur du fix.
    pushPresence(!value)
    if (!value) {
      fetch('/api/users/off-duty', { method: 'POST' }).catch(() => {})
      setError(null)
      setLastPing(null)
    }
  }

  return { onDuty, setOnDuty, lastPing, error, isLockedByDuty, scheduleInfo }
}
