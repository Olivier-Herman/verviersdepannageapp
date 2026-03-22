'use client'

import { signOut } from 'next-auth/react'
import Link from 'next/link'
import type { Session } from 'next-auth'

const NAV_MODULES = [
  { id: 'encaissement',  label: 'Encaissement Chauffeur', icon: '💳', href: '/encaissement',   color: 'bg-brand',     size: 'large' },
  { id: 'encaissements', label: 'Encaissements',           icon: '📊', href: '/encaissements',  color: 'bg-surface',   size: 'small' },
  { id: 'caisse',        label: 'Ma Caisse',               icon: '💰', href: '/caisse',         color: 'bg-surface',   size: 'small' },
  { id: 'depose',        label: 'Dépose Véhicule',         icon: '🗺️', href: '/depose',         color: 'bg-green-700', size: 'large' },
  { id: 'avance_fonds',  label: 'Avance de Fonds',         icon: '📄', href: '/avance-fonds',   color: 'bg-surface',   size: 'small' },
  { id: 'documents',     label: 'Documents',               icon: '📁', href: '/documents',      color: 'bg-surface',   size: 'small' },
  { id: 'check_vehicle', label: 'Check Véhicule',          icon: '🔍', href: '/check-vehicle',  color: 'bg-surface',   size: 'small' },
  { id: 'tgr',           label: 'TGR Touring',             icon: '🛡️', href: '/services/tgr',   color: 'bg-surface',   size: 'small' },
  { id: 'admin',         label: 'Administration',          icon: '⚙️', href: '/admin',          color: 'bg-purple-900',size: 'small' },
]

const CALL_MODULE_MAP: Record<string, string> = {
  'depannage': 'Service Dépannage',
  'fourriere': 'Service Fourrière',
  'rentacar':  'Service Rent A Car',
}

const CALL_MODULES = [
  { id: 'depannage', label: 'Dépannage',  icon: '🚗' },
  { id: 'fourriere', label: 'Fourrière',  icon: '🚔' },
  { id: 'rentacar',  label: 'Rent A Car', icon: '🔑' },
]

export default function DashboardClient({
  session,
  callShortcuts
}: {
  session: Session
  callShortcuts: any[]
}) {
  const userModules = session.user.modules || []
  const isAdmin = ['admin', 'superadmin'].includes(session.user.role)

  const initials = session.user.name
    ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'

  const getPhone = (moduleId: string) => {
    const label = CALL_MODULE_MAP[moduleId]
    return callShortcuts.find(s => s.label === label)?.phone
  }

  const visibleNavModules = NAV_MODULES.filter(m => {
    if (m.id === 'admin') return isAdmin
    if (isAdmin) return true
    return userModules.includes(m.id)
  })

  const visibleCallModules = CALL_MODULES.filter(m => {
    if (isAdmin) return true
    return userModules.includes(m.id)
  })

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4 safe-top">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-white rounded-lg px-3 py-1.5">
            <img src="/logo.jpg" alt="Verviers Dépannage" className="h-9 w-auto object-contain" />
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-zinc-500 hover:text-white transition-colors text-sm"
          >
            Déconnexion
          </button>
        </div>
        <div className="flex items-center gap-3 bg-[#222] rounded-xl px-3 py-2.5">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{session.user.name}</p>
            <p className="text-zinc-500 text-xs capitalize">{session.user.role}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
            <span className="text-green-500 text-xs">En service</span>
          </div>
        </div>
      </div>

      {/* Modules */}
      <div className="flex-1 px-4 py-5 overflow-y-auto">
        {visibleNavModules.length === 0 && visibleCallModules.length === 0 ? (
          <div className="text-center py-16 text-zinc-600">
            <p className="text-4xl mb-4">🔒</p>
            <p className="font-medium text-white mb-1">Aucun module activé</p>
            <p className="text-sm">Contacte un administrateur pour obtenir l'accès.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {visibleNavModules.map((mod) => (
                <Link
                  key={mod.id}
                  href={mod.href}
                  className={`
                    ${mod.size === 'large' ? 'col-span-2' : ''}
                    ${mod.color}
                    border border-[#2a2a2a] rounded-2xl p-4
                    flex ${mod.size === 'large' ? 'items-center justify-between' : 'flex-col'}
                    gap-3 active:opacity-80 transition-opacity
                  `}
                >
                  <div>
                    <p className="text-white font-semibold text-sm leading-tight">{mod.label}</p>
                    {mod.size === 'large' && (
                      <p className="text-white/60 text-xs mt-1">Appuyer pour ouvrir</p>
                    )}
                  </div>
                  <span className="text-2xl">{mod.icon}</span>
                </Link>
              ))}
            </div>

            {visibleCallModules.length > 0 && (
              <>
                <p className="text-zinc-600 text-xs font-semibold uppercase tracking-widest mt-5 mb-3">
                  Appels directs
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {visibleCallModules.map((mod) => {
                    const phone = getPhone(mod.id)
                    return (
                      <a
                        key={mod.id}
                        href={phone ? `tel:${phone}` : '#'}
                        className={`bg-[#1A1A1A] border rounded-2xl p-3 flex flex-col items-center gap-2 active:opacity-80 transition-all text-center ${phone ? 'border-[#2a2a2a] hover:border-brand' : 'border-[#1e1e1e] opacity-40'}`}
                      >
                        <span className="text-2xl">{mod.icon}</span>
                        <p className="text-white font-semibold text-xs leading-tight">{mod.label}</p>
                      </a>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <div className="safe-bottom h-4" />
    </div>
  )
}
