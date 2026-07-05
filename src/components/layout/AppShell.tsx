'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { signOutCascade } from '@/lib/auth-signout'
import { useState } from 'react'
import { Moon, Sun, LogOut, Menu, ChevronRight, ChevronLeft } from 'lucide-react'
import VehicleCheckBanner from '@/components/check-vehicule/VehicleCheckBanner'
import FinesMonthlyRecap  from '@/components/FinesMonthlyRecap'
import NotificationsProvider from '@/components/notifications/NotificationsProvider'
import { T } from '@/lib/i18n/T'
import WatchPairingBridge from '@/components/watch/WatchPairingBridge'
import { filterNavItems } from './nav-items'
import MobileNavDrawer from './MobileNavDrawer'
import GlobalSearch from '@/components/GlobalSearch'
import { TruckSwitcherIcon } from '@/components/trucks/TruckSwitcherIcon'
import DispatchAlertBadge from '@/components/notifications/DispatchAlertBadge'
import CobrowseUserBridge, { CobrowseUserBanner } from '@/components/cobrowse/CobrowseUserBridge'
import { useTheme } from '@/components/theme/ThemeProvider'
import { useOnDutyPing } from '@/hooks/useOnDutyPing'
import { useSidebarCollapsed } from './useSidebarCollapsed'
import { Avatar } from '@/components/ui/Avatar'

const TOOLTIP_CLS =
  'absolute left-full top-1/2 -translate-y-1/2 ml-3 px-3 py-1.5 rounded-md ' +
  'bg-ink text-surface text-xs font-medium shadow-md whitespace-nowrap ' +
  'opacity-0 group-hover:opacity-100 transition-opacity duration-150 ' +
  'pointer-events-none z-[100]'

interface AppShellProps {
  children:     React.ReactNode
  title:        string
  backHref?:    string
  headerExtra?: React.ReactNode
  userRole?:    string
  userName?:    string
  userEmail?:   string
  userId?:      string
  userModules?: string[]
  /** Mode embarqué : rend UNIQUEMENT le contenu (sans sidebar ni header). Utilisé
   *  pour intégrer une fiche existante telle quelle dans la vue dossier (?embed=1).
   *  Défaut false → aucun impact sur l'affichage normal. Olivier 2026-07-05. */
  embedded?:    boolean
}

export default function AppShell({
  children,
  title,
  backHref = '/dashboard',
  headerExtra,
  userRole = '',
  userName = '',
  userEmail,
  userId,
  userModules = [],
  embedded = false,
}: AppShellProps) {
  const pathname = usePathname()
  // Lit l'ordre personnalise du menu depuis la session (set via /profil).
  // Le refresh de session a chaque page render assure que le drag&drop
  // se reflete immediatement sans relogin.
  const { data: session } = useSession()
  const userNavOrder = (session?.user as any)?.navOrder as string[] | null | undefined
  const visibleNav = filterNavItems({ userModules, userRole, userNavOrder })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { theme, toggleTheme, mounted } = useTheme()
  const { onDuty, setOnDuty, isLockedByDuty } = useOnDutyPing()
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()

  // Mode embarqué (dossier) : uniquement le contenu, sans chrome. On garde le
  // provider de notifications au cas où le contenu l'utilise.
  if (embedded) {
    return (
      <NotificationsProvider userId={userId || null}>
        <div className="min-h-screen bg-page">{children}</div>
      </NotificationsProvider>
    )
  }

  return (
   <NotificationsProvider userId={userId || null}>
    <WatchPairingBridge />
    <CobrowseUserBanner />
    <div className="min-h-screen flex">

      {/* ── SIDEBAR DESKTOP ─────────────────────────────── */}
      <aside
        className={`hidden lg:flex flex-col min-h-screen bg-surface border-r flex-shrink-0 fixed top-0 left-0 h-full z-30 transition-[width] duration-200 ease-in-out ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className={`flex items-center border-b ${collapsed ? 'px-2 py-3 gap-1 justify-between' : 'px-6 py-5 justify-between'}`}>
          <Link
            href="/dashboard"
            title="Retour au dashboard"
            className="inline-block hover:opacity-80 transition-opacity flex-shrink-0"
          >
            <img
              src="/logo.jpg"
              alt="VD Soft"
              className={`object-contain transition-all duration-200 ${collapsed ? 'h-7 w-7' : 'h-10 w-auto'}`}
            />
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Déployer la sidebar' : 'Réduire la sidebar'}
            title={collapsed ? 'Déployer' : 'Réduire'}
            className={`flex items-center justify-center rounded-md text-ink-secondary hover:text-ink hover:bg-surface-hover transition-colors flex-shrink-0 ${
              collapsed ? 'w-6 h-6' : 'w-7 h-7'
            }`}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className={`flex-1 py-4 overflow-y-auto flex flex-col gap-0.5 ${collapsed ? 'px-2' : 'px-3'}`}>
          {visibleNav.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link key={item.href} href={item.href}
                className={`group relative flex items-center rounded-md text-sm font-medium transition-colors ${
                  collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
                } ${
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {!collapsed && (item.i18nKey ? <T k={item.i18nKey} /> : item.label)}
                {collapsed && <span className={TOOLTIP_CLS}>{item.i18nKey ? <T k={item.i18nKey} /> : item.label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* ── FOOTER 3 ZONES ── */}
        <div className={`py-2 border-t space-y-1 ${collapsed ? 'px-1.5' : 'px-2'}`}>
          {/* Zone 1 — User block (clic vers /profil) */}
          <UserBlock userName={userName} userRole={userRole} userId={userId} userEmail={userEmail} collapsed={collapsed} />

          {/* Zone 2 — Status toggle */}
          <StatusToggle onDuty={onDuty} setOnDuty={setOnDuty} isLockedByDuty={isLockedByDuty} collapsed={collapsed} />

          {/* Zone 3 — Footer actions (Thème + Déconnexion) */}
          <FooterActions theme={theme} toggleTheme={toggleTheme} mounted={mounted} collapsed={collapsed} />
        </div>
      </aside>

      {/* ── CONTENU PRINCIPAL ────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-h-screen transition-[margin] duration-200 ease-in-out ${collapsed ? 'lg:ml-16' : 'lg:ml-64'}`}>

        {/* Header mobile — burger à gauche, logo centré.
            Note (sub-phase 2.3.A bis) : le bouton retour à droite a été retiré
            (anti-pattern UX — le retour appartient au contenu via Link/router.back,
            pas au shell). La prop `backHref` reste dans la signature pour
            rétrocompatibilité avec les pages qui la passent encore. Le menu
            (Dashboard inclus) est accessible via le burger. */}
        <div className="lg:hidden bg-surface border-b px-4 pt-12 pb-3 safe-top sticky top-0 z-20">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setDrawerOpen(true)}
              aria-label="Ouvrir le menu"
              className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-md text-ink flex-shrink-0">
              <Menu size={18} />
            </button>
            <Link
              href="/dashboard"
              title="Retour au dashboard"
              className="flex-1 flex justify-center hover:opacity-80 transition-opacity"
            >
              <img src="/logo.jpg" alt="VD Soft" className="h-8 w-auto object-contain" />
            </Link>
            <DispatchAlertBadge userRole={userRole} />
            <TruckSwitcherIcon />
            <CobrowseUserBridge />
            <GlobalSearch />
          </div>
          <h1 className="font-display text-ink font-bold text-lg">{title}</h1>
          {headerExtra}
        </div>

        {/* Drawer mobile (shared) */}
        <MobileNavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          userName={userName}
          userRole={userRole}
          userEmail={userEmail}
          userId={userId}
          userModules={userModules}
        />

        {/* Header desktop */}
        <div className="hidden lg:block bg-surface border-b px-8 py-5 sticky top-0 z-20">
          <div className="flex items-center justify-between gap-4">
            <h1 className="font-display text-ink font-bold text-2xl">{title}</h1>
            {headerExtra && <div className="flex-1 ml-8">{headerExtra}</div>}
            <DispatchAlertBadge userRole={userRole} />
            <TruckSwitcherIcon />
            <CobrowseUserBridge />
            <GlobalSearch />
          </div>
        </div>

        {/* Bannière check véhicule */}
        <VehicleCheckBanner />

        {/* Récap amendes du mois (profil Driver, le 2 du mois, une fois — gaté côté API) */}
        <FinesMonthlyRecap />

        {/* Contenu */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
   </NotificationsProvider>
  )
}

// ─────────────────────────────────────────────────────────
// SOUS-COMPOSANTS DU FOOTER (réutilisés dans MobileNavDrawer)
// ─────────────────────────────────────────────────────────

export function UserBlock({
  userName, userRole, userId, userEmail, onClick, collapsed = false,
}: {
  userName: string
  userRole: string
  userId?: string
  userEmail?: string
  onClick?: () => void
  collapsed?: boolean
}) {
  return (
    <Link
      href="/profil"
      onClick={onClick}
      className={`group relative rounded-md hover:bg-surface-hover transition-colors min-w-0 ${
        collapsed ? 'flex justify-center p-1.5' : 'flex items-center gap-3 px-3 py-2'
      }`}
    >
      <Avatar name={userName || '?'} userId={userId} email={userEmail} size="sm" />
      {!collapsed && (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-ink text-[13px] font-semibold truncate">{userName || 'Utilisateur'}</p>
            <p className="text-ink-muted text-[11px] truncate capitalize">{userRole}</p>
          </div>
          <ChevronRight
            size={14}
            className="text-ink-faint group-hover:text-ink-secondary group-hover:translate-x-0.5 transition-all flex-shrink-0"
          />
        </>
      )}
      {collapsed && <span className={TOOLTIP_CLS}>{userName || 'Mon profil'}</span>}
    </Link>
  )
}

export function StatusToggle({
  onDuty, setOnDuty, isLockedByDuty, collapsed = false,
}: {
  onDuty: boolean
  setOnDuty: (v: boolean) => void
  isLockedByDuty: boolean
  collapsed?: boolean
}) {
  // Verrouillé si planning forcé (schedule_day/night actif sur l'horaire courant)
  // → on bloque le passage off, mais on peut toujours cliquer pour passer on.
  const lockedOff = isLockedByDuty && onDuty
  const titleAttr = isLockedByDuty
    ? 'Statut verrouillé par votre planning de travail'
    : (onDuty ? 'Cliquer pour passer hors service' : 'Cliquer pour passer en service')
  const label = onDuty ? 'En service' : 'Hors service'

  return (
    <button
      type="button"
      onClick={() => setOnDuty(!onDuty)}
      disabled={lockedOff}
      title={collapsed ? '' : titleAttr}
      aria-pressed={onDuty}
      className={`group relative w-full rounded-md text-left transition-colors ${
        lockedOff ? 'cursor-help' : 'hover:bg-surface-hover'
      } ${collapsed ? 'flex items-center justify-center p-2' : 'flex items-center gap-2.5 px-3 py-2'}`}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${onDuty ? 'bg-success-fill' : 'bg-ink-faint'}`}
        style={{
          boxShadow: onDuty
            ? '0 0 0 3px var(--color-success-soft)'
            : '0 0 0 3px var(--bg-surface-hover)',
        }}
      />
      {!collapsed && (
        <>
          <span className={`text-xs font-semibold flex-1 ${onDuty ? 'text-success' : 'text-ink-muted'}`}>
            {label}
          </span>
          {isLockedByDuty && (
            <span className="text-[10px] opacity-60" aria-hidden="true">🔒</span>
          )}
        </>
      )}
      {collapsed && (
        <span className={TOOLTIP_CLS}>
          {label}{isLockedByDuty ? ' 🔒' : ''}
        </span>
      )}
    </button>
  )
}

export function FooterActions({
  theme, toggleTheme, mounted, onClose, collapsed = false,
}: {
  theme: 'light' | 'dark'
  toggleTheme: () => void
  mounted: boolean
  onClose?: () => void
  collapsed?: boolean
}) {
  const btnCls = collapsed
    ? 'group relative w-full flex items-center justify-center p-2 rounded-md text-ink-secondary hover:text-ink hover:bg-surface-hover transition-colors'
    : 'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-ink-secondary hover:text-ink hover:bg-surface-hover transition-colors'

  const themeLabel = theme === 'light' ? 'Mode sombre' : 'Mode clair'

  return (
    <div className={collapsed ? 'flex flex-col gap-1' : 'flex gap-1'}>
      <button
        type="button"
        onClick={() => { toggleTheme(); onClose?.() }}
        aria-label={theme === 'light' ? 'Basculer en mode sombre' : 'Basculer en mode clair'}
        title={collapsed ? '' : themeLabel}
        className={btnCls}
      >
        {mounted && (theme === 'light' ? <Moon size={14} /> : <Sun size={14} />)}
        {!collapsed && <span>Thème</span>}
        {collapsed && <span className={TOOLTIP_CLS}>{themeLabel}</span>}
      </button>
      <button
        type="button"
        onClick={() => signOutCascade({ callbackUrl: '/login' })}
        title={collapsed ? '' : 'Déconnexion'}
        aria-label="Déconnexion"
        className={btnCls}
      >
        <LogOut size={14} />
        {!collapsed && <span>Déconnexion</span>}
        {collapsed && <span className={TOOLTIP_CLS}>Déconnexion</span>}
      </button>
    </div>
  )
}
