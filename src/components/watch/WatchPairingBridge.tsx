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
  if (typeof window === 'undefined') {
    console.log('[WatchBridge] SSR (no window) — skip')
    return null
  }
  const w = window as any
  const isNative = w.Capacitor?.isNativePlatform?.()
  console.log('[WatchBridge] Capacitor.isNativePlatform =', isNative)
  if (!isNative) return null
  const plugin = w.Capacitor?.Plugins?.WatchBridge
  console.log('[WatchBridge] Capacitor.Plugins.WatchBridge =', plugin ? 'OK' : 'undefined')
  console.log('[WatchBridge] all plugin keys =', Object.keys(w.Capacitor?.Plugins ?? {}))
  return plugin ?? null
}

export default function WatchPairingBridge() {
  const { status, data: session } = useSession()
  const lastUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    console.log('[WatchBridge] useEffect status =', status)
    if (status !== 'authenticated') {
      console.log('[WatchBridge] not authenticated yet, skip')
      return
    }
    const plugin = getPlugin()
    if (!plugin) {
      console.log('[WatchBridge] no plugin available, skip')
      return
    }

    const userId = (session?.user as any)?.id || session?.user?.email || ''
    console.log('[WatchBridge] userId =', userId)
    if (!userId) return
    if (lastUserIdRef.current === userId) {
      console.log('[WatchBridge] same userId already paired, skip')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        console.log('[WatchBridge] checking isWatchPaired...')
        const { paired } = await plugin.isWatchPaired()
        console.log('[WatchBridge] isWatchPaired =', paired)
        if (!paired) return
        console.log('[WatchBridge] fetching /api/watch/issue-token...')
        const resp = await fetch('/api/watch/issue-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
        console.log('[WatchBridge] issue-token HTTP', resp.status)
        if (!resp.ok) return
        const { token, expires_at } = await resp.json() as { token: string; expires_at: string }
        console.log('[WatchBridge] token recu, length =', token?.length)
        if (!token || cancelled) return
        await plugin.forwardToken({ token, expires_at })
        lastUserIdRef.current = userId
        console.log('[WatchBridge] forwardToken OK')
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
