'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// GPS piloté par les ATTRIBUTIONS (économie batterie).
//
// Règle (décision Olivier 2026-07-26) : le GPS s'active dès qu'une mission est
// ATTRIBUÉE au chauffeur (statut 'assigned', avant même l'acceptation) et se
// COUPE dès qu'il n'a plus aucune attribution active. Fini le GPS allumé toute
// la vacation (le vrai gouffre batterie) : il ne tourne que le temps d'une
// mission (durée bornée), ce qui permet le suivi + l'arrivée « sur place »
// semi-auto même écran verrouillé, sans vider la batterie hors mission.
//
// Détection du nombre d'attributions : fetch initial + realtime (canal filtré
// assigned_to) + repli poll 60s. Le comptage réel est fait côté serveur
// (/api/users/active-assignment-count) pour ne pas dépendre du RLS navigateur.

const PING_INTERVAL_MS = 30_000
const FALLBACK_POLL_MS  = 60_000

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export function useMissionGpsTracking(userId?: string | null) {
  const [tracking, setTracking] = useState(false)

  // ── 1. Déterminer s'il y a ≥1 attribution active ──────────────────────────
  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const refresh = async () => {
      try {
        const r = await fetch('/api/users/active-assignment-count', { cache: 'no-store' })
        const j = await r.json()
        if (!cancelled) setTracking((j?.count || 0) > 0)
      } catch { /* on garde l'état courant */ }
    }

    refresh()
    // Realtime : toute création/MAJ/suppression d'une mission qui m'est
    // attribuée peut changer le compte → on recompte.
    const ch = sb.channel(`gps-assign-${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incoming_missions',
        filter: `assigned_to=eq.${userId}`,
      }, () => { refresh() })
      .subscribe()
    // Repli si le realtime rate un événement (réseau instable).
    const poll = setInterval(refresh, FALLBACK_POLL_MS)

    return () => { cancelled = true; sb.removeChannel(ch); clearInterval(poll) }
  }, [userId])

  // ── 2. GPS : actif UNIQUEMENT tant que `tracking` ─────────────────────────
  useEffect(() => {
    if (!tracking) return

    let cancelled = false
    let lastPostMs = 0
    let webIntervalId: any = null
    let capWatchId: string | null = null

    const postPing = async (lat: number, lng: number) => {
      const now = Date.now()
      if (now - lastPostMs < PING_INTERVAL_MS - 1000) return   // throttle 30s
      lastPostMs = now
      try {
        await fetch('/api/users/ping-location', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lng }),
        })
      } catch { /* réseau — best-effort */ }
    }

    ;(async () => {
      // Natif : watchPosition CONTINU pendant la mission (durée bornée) → suivi
      // + « sur place » semi-auto marchent même écran verrouillé (background mode
      // location). Coût batterie acceptable car limité au temps de la mission.
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (Capacitor.isNativePlatform()) {
          const { Geolocation } = await import('@capacitor/geolocation')
          await Geolocation.requestPermissions().catch(() => {})
          capWatchId = await Geolocation.watchPosition(
            { enableHighAccuracy: false, timeout: 10_000 },
            (pos, err) => {
              if (cancelled || err || !pos) return
              postPing(pos.coords.latitude, pos.coords.longitude)
            },
          )
          return
        }
      } catch { /* fallback web */ }

      // Web : getCurrentPosition sur intervalle.
      if (typeof navigator === 'undefined' || !navigator.geolocation) return
      const sendWeb = () => navigator.geolocation.getCurrentPosition(
        (pos) => { if (!cancelled) postPing(pos.coords.latitude, pos.coords.longitude) },
        () => {},
        { enableHighAccuracy: false, maximumAge: 15_000, timeout: 10_000 },
      )
      sendWeb()
      webIntervalId = setInterval(sendWeb, PING_INTERVAL_MS)
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
  }, [tracking])

  // ── 3. Plus d'attribution → efface la position (best-effort, une fois) ─────
  const wasTracking = useRef(false)
  useEffect(() => {
    if (wasTracking.current && !tracking) {
      fetch('/api/users/off-duty', { method: 'POST' }).catch(() => {})
    }
    wasTracking.current = tracking
  }, [tracking])

  return { tracking }
}
