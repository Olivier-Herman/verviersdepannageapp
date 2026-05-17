// src/lib/auth-signout.ts
//
// Wrapper du signOut NextAuth qui purge AUSSI le Bearer token cote
// Apple Watch (via le plugin Capacitor WatchBridge) avant de logout.
//
// Sans ce wrapper, l ancien user reste visible sur la Watch (token
// cache 90 j dans Keychain Watch).

import { signOut, type SignOutParams } from 'next-auth/react'

export async function signOutCascade<R extends boolean = true>(params?: SignOutParams<R>) {
  if (typeof window !== 'undefined') {
    const plugin = (window as any).Capacitor?.Plugins?.WatchBridge
    if (plugin) {
      try { await plugin.clearToken() } catch { /* best effort */ }
    }
  }
  return signOut(params)
}
