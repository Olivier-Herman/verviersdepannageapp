'use client'
// src/hooks/useEndFinishedLiveActivities.ts — ferme sur l'iPhone la Live Activity des
// missions terminées / annulées / retirées (Olivier 05/10/2026, 1VRK946 : bandeau
// « En route vers la destination » resté après la clôture, le chauffeur ayant quitté
// la fiche). À l'ouverture de l'app, au retour au premier plan et toutes les 60 s.
// No-op hors app iPhone.
import { useEffect } from 'react'
import { endForMission } from '@/lib/native/liveActivity'

const DONE = { step: 'done', title: 'Mission terminée', address: '', badgeText: 'TERMINÉ', accent: 'neutral' as const }

export function useEndFinishedLiveActivities(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return
    let stop = false, running = false
    const run = async () => {
      if (stop || running || document.visibilityState !== 'visible') return
      running = true
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return
        if (!Capacitor.isPluginAvailable('LiveActivity')) return   // ancienne app App Store : rien à fermer (06/10/2026)
        const r = await fetch('/api/missions/live-activities-finished', { cache: 'no-store' })
        if (!r.ok) return
        const { ids } = await r.json()
        for (const id of Array.isArray(ids) ? ids : []) await endForMission(String(id), DONE)
      } catch { /* best effort */ } finally { running = false }
    }
    run()
    const onVis = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(run, 60_000)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [userId])
}
