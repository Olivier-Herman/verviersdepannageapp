'use client'

// PwaNativeGuard — si l user a force_native_app=true et qu il est sur
// PWA/Web (pas Capacitor native), affiche une page de blocage pleine
// avec liens de telechargement App Store / APK Android.
// Olivier 2026-06-02. Cible : chauffeurs recalcitrants.

import { useEffect, useState } from 'react'
import { useSession }          from 'next-auth/react'
import Link                    from 'next/link'

export function PwaNativeGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const [isNative,   setIsNative]   = useState<boolean | null>(null)

  // Detecte la plateforme une fois au mount
  useEffect(() => {
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        setIsNative(Capacitor.isNativePlatform())
      } catch {
        setIsNative(false)
      }
    })()
  }, [])

  // En cours de chargement → render children pour ne pas flasher
  if (status === 'loading' || isNative === null) return <>{children}</>
  if (!session) return <>{children}</>

  const u                 = session.user as any
  const role              = u.role || ''
  const forceNative       = !!u.forceNativeApp
  const isDriverPure      = role === 'driver' || (Array.isArray(u.roles) && u.roles.includes('driver') && !u.roles.some((r: string) => ['admin', 'superadmin', 'dispatcher', 'facturation', 'fourriere'].includes(r)))

  // Pas de blocage si pas concerne
  if (!forceNative || !isDriverPure || isNative) return <>{children}</>

  // BLOCAGE — message generique "version obsolete" (Olivier 2026-06-02 :
  // pas de lien direct, le chauffeur a deja recu le lien par message).
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white px-4">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-200 max-w-md w-full p-8 text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-xl font-bold text-gray-900">Cette version de l&apos;app est obsolète</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          Télécharge l&apos;application iPhone en cliquant sur le lien envoyé par message pour continuer à l&apos;utiliser.
        </p>
        <Link href="/api/auth/signout"
          className="inline-block text-gray-400 hover:text-gray-600 text-xs underline pt-2">
          Se déconnecter
        </Link>
      </div>
    </div>
  )
}
