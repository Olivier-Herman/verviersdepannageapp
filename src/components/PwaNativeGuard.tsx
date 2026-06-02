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

  // BLOCAGE
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-white to-amber-50 px-4">
      <div className="bg-white rounded-3xl shadow-2xl border-2 border-red-300 max-w-lg w-full p-8 text-center space-y-5">
        <div className="text-6xl">📱</div>
        <h1 className="text-2xl font-bold text-gray-900">Application native obligatoire</h1>
        <p className="text-gray-700 text-base leading-relaxed">
          Bonjour <strong>{session.user?.name}</strong>,<br />
          ton compte est configuré pour utiliser <strong>uniquement l&apos;application native VD Soft</strong>.
        </p>
        <p className="text-gray-500 text-sm">
          Le navigateur web ou la version PWA n&apos;est pas autorisée pour ton profil. Télécharge l&apos;app sur ton smartphone et reconnecte-toi.
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-3 text-left">
          <a href="https://apps.apple.com/us/app/vd-soft/id6769551627" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 bg-black hover:bg-gray-800 text-white rounded-xl p-3 transition">
            <div className="text-3xl"></div>
            <div className="flex-1">
              <p className="text-xs opacity-75">Pour iPhone</p>
              <p className="font-bold">Télécharger sur l&apos;App Store</p>
            </div>
          </a>
          <a href="https://app.verviersdepannage.com/downloads/android"
            className="flex items-center gap-3 bg-green-600 hover:bg-green-700 text-white rounded-xl p-3 transition">
            <div className="text-3xl">🤖</div>
            <div className="flex-1">
              <p className="text-xs opacity-75">Pour Android</p>
              <p className="font-bold">Télécharger l&apos;APK</p>
            </div>
          </a>
        </div>

        <p className="text-gray-500 text-xs">
          Pour toute question, contacte Olivier ou un administrateur.
        </p>
        <Link href="/api/auth/signout"
          className="inline-block text-gray-400 hover:text-gray-600 text-xs underline">
          Se déconnecter
        </Link>
      </div>
    </div>
  )
}
