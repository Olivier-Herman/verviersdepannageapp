'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { Truck, X } from 'lucide-react'
import Link from 'next/link'

interface ActiveCheck {
  id: string
  vehicle: { plate: string; name: string }
  claimed_by_user?: { name: string }
}

export default function VehicleCheckBanner() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [activeCheck, setActiveCheck] = useState<ActiveCheck | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const roles = Array.isArray((session?.user as any)?.roles)
    ? (session?.user as any).roles
    : [(session?.user as any)?.role]
  const isAdminOrDispatcher = roles?.some((r: string) =>
    ['admin', 'superadmin', 'dispatcher'].includes(r)
  )

  useEffect(() => {
    // Ne pas afficher sur la page du check elle-même
    if (!session || isAdminOrDispatcher) return
    if (pathname.startsWith('/check-vehicule')) return

    fetch('/api/check-vehicule')
      .then(r => r.json())
      .then(data => setActiveCheck(data.activeCheck || null))
      .catch(() => {})
  }, [session, pathname])

  // Réafficher si le path change (le driver a navigué)
  useEffect(() => {
    setDismissed(false)
  }, [pathname])

  if (!activeCheck || dismissed || isAdminOrDispatcher) return null

  return (
    <Link href={`/check-vehicule/${activeCheck.id}`} className="block mx-4 mt-3">
      <div className="bg-orange-500/15 border border-orange-500 rounded-xl p-3 flex items-start gap-3">
        <Truck className="text-orange-400 mt-0.5 flex-shrink-0" size={18} />
        <div className="flex-1 min-w-0">
          <p className="text-orange-300 font-semibold text-sm">Contrôle véhicule en cours</p>
          <p className="text-orange-200 text-xs mt-0.5 leading-relaxed">
            Véhicule <strong>{activeCheck.vehicle?.plate}</strong>
            {activeCheck.claimed_by_user && ` · Responsable\u00a0: ${activeCheck.claimed_by_user.name}`}
          </p>
          <p className="text-orange-400 text-xs mt-1">
            Présentez-vous avec le véhicule, les documents et le matériel.
          </p>
        </div>
        <button
          onClick={e => { e.preventDefault(); setDismissed(true) }}
          className="text-orange-400 hover:text-orange-200 flex-shrink-0 p-0.5 transition"
          aria-label="Fermer"
        >
          <X size={16} />
        </button>
      </div>
    </Link>
  )
}
