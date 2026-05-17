'use client'

// WatchPairingBridge.tsx
//
// Pont entre la session NextAuth (cookies dans WKWebView) et le plugin
// Capacitor WatchBridge (cote iPhone Swift) qui forward le Bearer JWT
// a l Apple Watch via WCSession.
//
// Flow :
//   1. Detecte Capacitor + Watch couplee
//   2. Fetch POST /api/watch/issue-token (cookies NextAuth disponibles ici)
//   3. Appelle Capacitor.Plugins.WatchBridge.forwardToken({ token, expires_at })
//
// Monté dans AppShell (= toutes les pages authentifiées). Au mount + a chaque
// changement de session (login/logout), tente le pairing. Re-fetch a chaque
// pageload pour rester simple — le token est cache HttpOnly cote backend et
// le forward Watch est idempotent.

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'

interface WatchBridgePlugin {
  forwardToken(options: { token: string; expires_at: string }): Promise<{ ok: boolean }>
  clearToken(): Promise<{ ok: boolean }>
  isWatchPaired(): Promise<{ paired: boolean }>
}

function getPlugin(): WatchBridgePlugin | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  if (!w.Capacitor?.isNativePlatform?.()) return null
  return w.Capacitor?.Plugins?.WatchBridge ?? null
}

export default function WatchPairingBridge() {
  const { status, data: session } = useSession()
  const lastUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    const plugin = getPlugin()
    if (!plugin) return  // Pas Capacitor ou plugin absent (build sans Watch bridge)

    // Eviter de re-fetch si on a deja forward le token pour ce user.
    const userId = (session?.user as any)?.id || session?.user?.email || ''
    if (!userId) return
    if (lastUserIdRef.current === userId) return

    let cancelled = false
    ;(async () => {
      try {
        const { paired } = await plugin.isWatchPaired()
        if (!paired) {
          console.log('[WatchBridge] Pas d Apple Watch couplee — skip')
          return
        }
        const resp = await fetch('/api/watch/issue-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!resp.ok) {
          console.warn('[WatchBridge] issue-token HTTP', resp.status)
          return
        }
        const { token, expires_at } = await resp.json() as { token: string; expires_at: string }
        if (!token) return
        if (cancelled) return
        await plugin.forwardToken({ token, expires_at })
        lastUserIdRef.current = userId
        console.log('[WatchBridge] Token forwarde a la Watch')
      } catch (e) {
        console.warn('[WatchBridge] error:', e)
      }
    })()

    return () => { cancelled = true }
  }, [status, session])

  // Logout : purge le token cote Watch
  useEffect(() => {
    if (status !== 'unauthenticated') return
    const plugin = getPlugin()
    if (!plugin) return
    if (lastUserIdRef.current === null) return
    plugin.clearToken().catch(() => {})
    lastUserIdRef.current = null
  }, [status])

  return null
}
