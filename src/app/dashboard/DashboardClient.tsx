'use client'

import { signOut } from 'next-auth/react'
import Link from 'next/link'
import type { Session } from 'next-auth'
import AppShell from '@/components/layout/AppShell'

const NAV_MODULES = [
  { id: 'encaissement',  label: 'Encaissement Chauffeur', icon: '💳', href: '/encaissement',   color: 'bg-brand',      size: 'large' },
  { id: 'avance_fonds',  label: 'Avance de Fonds',        icon: '📄', href: '/avance-fonds',   color: 'bg-surface',    size: 'large' },
  { id: 'finance',       label: 'Finance',                icon: '💰', href: '/finance',         color: 'bg-surface',    size: 'small' },
  { id: 'check_vehicle', label: 'Check Véhicule',         icon: '🔍', href: '/check-vehicule', color: 'bg-surface',    size: 'small' },
  { id: 'tgr',           label: 'TGR Touring',            icon: '🛡️', href: '/services/tgr',   color: 'bg-surface',    size: 'small' },
  { id: 'depose',        label: 'Dépose Véhicule',        icon: '🗺️', href: '/depose',         color: 'bg-green-700',  size: 'small' },
  { id: 'profil',        label: 'Mon Profil',             icon: '👤', href: '/profil',         color: 'bg-surface',    size: 'small' },
  { id: 'admin',         label: 'Administration',         icon: '⚙️', href: '/admin',          color: 'bg-purple-900', size: 'large' },
]

const CALL_MODULE_MAP: Record<string, string> = {
  depannage: 'Service Dépannage',
  fourriere: 'Service Fourrière',
  rentacar:  'Service Rent A Car',
}

const CALL_MODULES = [
  { id: 'depannage', label: 'Dépannage',  icon: '🚗' },
  { id: 'fourriere', label: 'Fourrière',  icon: '🚔' },
  { id: 'rentacar',  label: 'Rent A Car', icon: '🔑' },
]

export default function DashboardClient({
  session,
  callShortcuts,
}: {
  session: Session
  callShortcuts: any[]
}) {
  const userModules = (session.user as any).modules || []
  const isAdmin     = ['admin', 'superadmin'].includes((session.user as any).role)
  const initials    = session.user.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'

  const getPhone = (moduleId: string) => {
    const label = CALL_MODULE_MAP[moduleId]
    return callShortcuts.find(s => s.label === label)?.phone
  }

  const isModuleVisible = (id: string): boolean => {
    if (id === 'profil') return true
    if (id === 'admin')  return isAdmin && userModules.includes('admin')
    if (id === 'finance') return userModules.includes('encaissements') || userModules.includes('caisse')
    return userModules.includes(id)
  }

  const visibleNav    = NAV_MODULES.filter(m => isModuleVisible(m.id))
  const visibleCalls  = CALL_MODULES.filter(m => userModules.includes(m.id))

  return (
    <AppShell
      title="Dashboard"
      backHref="/dashboard"
      userRole={(session.user as any).role}
      userName={session.user.name ?? ''}
      userModules={userModules}
    >
      {/* ── MOBILE ───────────────────────────────────────── */}
      <div className="lg:hidden px-4 py-5">
        <div className="flex items-center gap-3 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-3 py-2.5 mb-5">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{session.user.name}</p>
            <p className="text-zinc-500 text-xs capitalize">{(session.user as any).role}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-green-500 text-xs">En service</span>
          </div>
        </div>
        <ModuleGrid visibleNav={visibleNav} visibleCalls={visibleCalls} getPhone={getPhone} />
      </div>

      {/* ── DESKTOP ──────────────────────────────────────── */}
      <div className="hidden lg:block px-8 py-6">
        <div className="flex items-center gap-4 bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl px-5 py-4 mb-6 max-w-2xl">
          <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold">{session.user.name}</p>
            <p className="text-zinc-500 text-sm capitalize">{(session.user as any).role}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-green-500 text-sm">En service</span>
          </div>
          <button onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-zinc-500 hover:text-red-400 text-sm transition-colors ml-4">
            Déconnexion
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 max-w-5xl">
          {visibleNav.map(mod => (
            <Link key={mod.id} href={mod.href}
              className={`${mod.color} ${mod.size === 'large' ? 'col-span-3' : ''} border border-[#2a2a2a] rounded-2xl p-5 flex items-center justify-between gap-3 hover:border-brand/50 transition-all active:opacity-80`}
            >
              <div>
                <p className="text-white font-semibold text-base leading-tight">{mod.label}</p>
                <p className="text-white/50 text-xs mt-1">Ouvrir →</p>
              </div>
              <span className="text-3xl">{mod.icon}</span>
            </Link>
          ))}
        </div>

        {visibleCalls.length > 0 && (
          <>
            <p className="text-zinc-600 text-xs font-semibold uppercase tracking-widest mt-8 mb-3 max-w-5xl">
              Appels directs
            </p>
            <div className="flex gap-3 max-w-5xl">
              {visibleCalls.map(mod => {
                const phone = getPhone(mod.id)
                return (
                  <a key={mod.id} href={phone ? `tel:${phone}` : '#'}
                    className={`bg-[#1A1A1A] border rounded-2xl px-6 py-4 flex items-center gap-3 transition-all ${
                      phone ? 'border-[#2a2a2a] hover:border-brand' : 'border-[#1e1e1e] opacity-40'
                    }`}
                  >
                    <span className="text-2xl">{mod.icon}</span>
                    <p className="text-white font-semibold text-sm">{mod.label}</p>
                  </a>
                )
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

function ModuleGrid({
  visibleNav, visibleCalls, getPhone,
}: {
  visibleNav:   typeof NAV_MODULES
  visibleCalls: typeof CALL_MODULES
  getPhone:     (id: string) => string | undefined
}) {
  if (visibleNav.length === 0 && visibleCalls.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-600">
        <p className="text-4xl mb-4">🔒</p>
        <p className="font-medium text-white mb-1">Aucun module activé</p>
        <p className="text-sm">Contacte un administrateur.</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {visibleNav.map(mod => (
          <Link key={mod.id} href={mod.href}
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
              {mod.size === 'large' && <p className="text-white/60 text-xs mt-1">Appuyer pour ouvrir</p>}
            </div>
            <span className="text-2xl">{mod.icon}</span>
          </Link>
        ))}
      </div>

      {visibleCalls.length > 0 && (
        <>
          <p className="text-zinc-600 text-xs font-semibold uppercase tracking-widest mt-5 mb-3">
            Appels directs
          </p>
          <div className="grid grid-cols-3 gap-3">
            {visibleCalls.map(mod => {
              const phone = getPhone(mod.id)
              return (
                <a key={mod.id} href={phone ? `tel:${phone}` : '#'}
                  className={`bg-[#1A1A1A] border rounded-2xl p-3 flex flex-col items-center gap-2 active:opacity-80 transition-all text-center ${
                    phone ? 'border-[#2a2a2a] hover:border-brand' : 'border-[#1e1e1e] opacity-40'
                  }`}
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
  )
}
