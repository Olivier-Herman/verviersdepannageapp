'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Session } from 'next-auth'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'

// ─────────────────────────────────────────────────────────
// CONFIGURATION DES SECTIONS
// ─────────────────────────────────────────────────────────

type IconColor = 'brand' | 'success' | 'info' | 'warning' | 'purple' | 'alert'

const ICON_COLOR_CLASSES: Record<IconColor, string> = {
  brand:   'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  info:    'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  purple:  'bg-purple-soft text-purple',
  alert:   'bg-alert-soft text-alert',
}

interface ActionItem {
  id:       string
  label:    string
  subtitle: string
  href:     string
  icon:     string
  color:    IconColor
}

interface ModuleItem {
  id:    string
  label: string
  href:  string
  icon:  string
  color: IconColor
}

// Section 1 — actions principales (mises en avant, grandes cards)
// `police_mission` est conditionnel sur hasTowsoft (1ère position si présent)
const MAIN_ACTIONS: ActionItem[] = [
  { id: 'police_mission',  label: 'Créer une mission',      subtitle: 'Police · Saisie · Mal Garée · SNC', href: '/mission/police', icon: '🚨', color: 'brand'   },
  { id: 'encaissement',    label: 'Encaissement Chauffeur', subtitle: 'Espèces · Carte · Virement',         href: '/encaissement',   icon: '💳', color: 'success' },
  { id: 'missions',        label: 'Dispatch Missions',      subtitle: 'Pipeline temps réel',                href: '/dispatch',       icon: '📡', color: 'info'    },
  { id: 'driver_missions', label: 'Mes Missions',           subtitle: 'Mes interventions du jour',          href: '/mission',        icon: '🚗', color: 'warning' },
  { id: 'avance_fonds',    label: 'Avance de Fonds',        subtitle: 'Demander une avance',                href: '/avance-fonds',   icon: '💰', color: 'success' },
]

// Section 2 — modules secondaires (cards compactes)
const MODULES: ModuleItem[] = [
  { id: 'check_vehicle', label: 'Check Véhicule',  href: '/check-vehicule', icon: '🔍', color: 'info'    },
  { id: 'tgr',           label: 'TGR Touring',     href: '/services/tgr',   icon: '🛡️', color: 'purple'  },
  { id: 'finance',       label: 'Finance',         href: '/finance',        icon: '💵', color: 'success' },
  { id: 'admin',         label: 'Administration',  href: '/admin',          icon: '⚙️', color: 'alert'   },
  { id: 'depose',        label: 'Dépose Véhicule', href: '/depose',         icon: '🗺️', color: 'warning' },
]

// Section 3 — appels rapides
const CALL_MODULE_MAP: Record<string, string> = {
  depannage: 'Service Dépannage',
  fourriere: 'Service Fourrière',
  rentacar:  'Service Rent A Car',
}

const CALL_MODULES = [
  { id: 'depannage', label: 'Dépannage',  icon: '🚗' },
  { id: 'fourriere', label: 'Fourrière',  icon: '🚓' },
  { id: 'rentacar',  label: 'Rent A Car', icon: '🔑' },
]

// ─────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────

export default function DashboardClient({
  session,
  callShortcuts,
  hasTowsoft = false,
}: {
  session: Session
  callShortcuts: any[]
  hasTowsoft?: boolean
}) {
  const sessionUser = session.user as any
  const userModules: string[] = sessionUser.modules || []
  const userRole: string      = sessionUser.role || ''
  const isAdmin               = ['admin', 'superadmin'].includes(userRole)

  // Si on arrive ici via une notification push (service worker fallback iOS PWA),
  // un query param ?redirect=/mission/abc nous indique où aller vraiment.
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const redirect = searchParams.get('redirect')
    if (redirect && redirect.startsWith('/')) {
      router.replace(redirect)
    }
  }, [searchParams, router])

  // ── Filtrage selon les modules accordés ──
  const isVisible = (id: string): boolean => {
    if (id === 'police_mission') return hasTowsoft
    if (id === 'admin')          return isAdmin && userModules.includes('admin')
    if (id === 'finance')        return userModules.includes('encaissements') || userModules.includes('caisse')
    return userModules.includes(id)
  }

  const visibleActions = MAIN_ACTIONS.filter(a => isVisible(a.id))
  const visibleModules = MODULES.filter(m => isVisible(m.id))
  const visibleCalls   = CALL_MODULES.filter(c => userModules.includes(c.id))

  const getPhone = (id: string): string | undefined => {
    const label = CALL_MODULE_MAP[id]
    return callShortcuts.find(s => s.label === label)?.phone
  }

  const isEmpty = visibleActions.length === 0 && visibleModules.length === 0 && visibleCalls.length === 0

  return (
    <AppShell
      title="Dashboard"
      backHref="/dashboard"
      userRole={userRole}
      userName={session.user?.name ?? ''}
      userEmail={session.user?.email ?? undefined}
      userId={sessionUser.id}
      userModules={userModules}
    >
      <AmbientBackground>
        <div className="px-4 lg:px-8 py-5 lg:py-8 max-w-5xl mx-auto">

          {/* Hero header — desktop visible, mobile garde le header sticky AppShell */}
          <div className="hidden lg:block mb-8 ambient-fade-up">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand/20 via-purple-500/15 to-info/15 flex items-center justify-center text-2xl shadow-lg shadow-brand/10 flex-shrink-0">
                <span className="ambient-sparkle">👋</span>
              </div>
              <div>
                <h1 className="font-display text-ink text-2xl lg:text-3xl font-bold leading-tight">
                  Bonjour {session.user?.name?.split(' ')[0] || ''}
                </h1>
                <p className="text-ink-muted text-sm mt-1">Voici tes actions et modules disponibles.</p>
              </div>
            </div>
          </div>

          {/* Section 1 — Actions principales */}
          {visibleActions.length > 0 && (
            <section className="mb-8 ambient-fade-up ambient-stagger-1">
              <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
                Actions principales
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleActions.map(item => <ActionCard key={item.id} item={item} />)}
              </div>
            </section>
          )}

          {/* Section 2 — Modules */}
          {visibleModules.length > 0 && (
            <section className="mb-8 ambient-fade-up ambient-stagger-2">
              <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
                Modules
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleModules.map(item => <ModuleCard key={item.id} item={item} />)}
              </div>
            </section>
          )}

          {/* Section 3 — Appels rapides */}
          {visibleCalls.length > 0 && (
            <section className="mb-4 ambient-fade-up ambient-stagger-3">
              <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">
                Appels rapides
              </h2>
              <div className="flex flex-wrap gap-2">
                {visibleCalls.map(c => (
                  <QuickCall key={c.id} item={c} phone={getPhone(c.id)} />
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {isEmpty && (
            <div className="text-center py-16 border-2 border-dashed rounded-card text-ink-muted ambient-fade-up">
              <p className="text-4xl mb-3" aria-hidden="true">🔒</p>
              <p className="font-display font-semibold text-ink mb-1">Aucun module activé</p>
              <p className="text-sm">Contacte un administrateur pour t&apos;attribuer des accès.</p>
            </div>
          )}
        </div>
      </AmbientBackground>
    </AppShell>
  )
}

// ─────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ─────────────────────────────────────────────────────────

function ActionCard({ item }: { item: ActionItem }) {
  return (
    <Link
      href={item.href}
      className="group bg-surface border rounded-card shadow-card p-5 flex items-start gap-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md hover:border-strong"
    >
      <div
        aria-hidden="true"
        className={`w-10 h-10 rounded-md flex items-center justify-center text-lg flex-shrink-0 ${ICON_COLOR_CLASSES[item.color]}`}
      >
        {item.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display text-ink font-bold text-[15px] leading-tight">{item.label}</p>
        <p className="text-ink-muted text-xs mt-1">{item.subtitle}</p>
        <p className="text-ink-secondary text-xs font-semibold mt-3 group-hover:text-brand transition-colors">
          Ouvrir →
        </p>
      </div>
    </Link>
  )
}

function ModuleCard({ item }: { item: ModuleItem }) {
  return (
    <Link
      href={item.href}
      className="bg-surface border rounded-md shadow-card p-4 flex items-center gap-3 transition-all duration-150 hover:-translate-y-px hover:shadow-md hover:border-strong"
    >
      <div
        aria-hidden="true"
        className={`w-8 h-8 rounded-md flex items-center justify-center text-base flex-shrink-0 ${ICON_COLOR_CLASSES[item.color]}`}
      >
        {item.icon}
      </div>
      <span className="text-ink text-sm font-medium truncate">{item.label}</span>
    </Link>
  )
}

function QuickCall({
  item,
  phone,
}: {
  item: { id: string; label: string; icon: string }
  phone?: string
}) {
  if (!phone) {
    return (
      <span
        title="Numéro non configuré"
        className="inline-flex items-center gap-2 bg-surface border rounded-md px-3.5 py-2 text-sm font-medium text-ink-faint opacity-50 cursor-not-allowed"
      >
        <span aria-hidden="true">{item.icon}</span>
        <span>{item.label}</span>
      </span>
    )
  }
  return (
    <a
      href={`tel:${phone}`}
      className="inline-flex items-center gap-2 bg-surface border rounded-md px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-hover hover:border-strong transition-colors"
    >
      <span aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
    </a>
  )
}
