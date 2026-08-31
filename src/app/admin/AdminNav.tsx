'use client'

// AdminNav : navigation horizontale groupee par theme (separateurs entre
// groupes). Inclut TOUTES les sections /admin/* pour ne plus avoir a
// taper l URL a la main. Pour une vraie nav segmentee (sidebar collapsible),
// cf chantier [[admin-zero-hardcode]].

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Tag, MapPin, Users, Car,
  Receipt, DollarSign,
  Radio, Bell, ShieldCheck, FileSignature,
  Map, ClipboardCheck,
  FileText, Archive, Wallet, Truck,
  Settings, Home, Printer, LifeBuoy,
  ToggleLeft, Mail,
  type LucideIcon } from 'lucide-react'

type NavItem = { href: string; label: string; icon: LucideIcon }
type NavGroup = { title: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    title: 'Référentiel',
    items: [
      { href: '/admin/sources',          label: 'Sources',          icon: Tag },
      { href: '/admin/depots',           label: 'Dépôts',           icon: MapPin },
      { href: '/admin/trucks',           label: 'Dépanneuses',      icon: Truck },
      { href: '/admin/adoption',         label: 'Adoption',         icon: Tag },
      { href: '/admin/saisie-motifs',    label: 'Motifs de saisie', icon: Tag },
      { href: '/admin/reception-motifs', label: 'Motifs réception', icon: Tag },
      { href: '/admin/competences',      label: 'Compétences',      icon: Users },
      { href: '/admin/visites',          label: 'Visites comptoir', icon: Users },
      { href: '/admin/police-zones',     label: 'Zones de police',  icon: ShieldCheck },
      { href: '/admin/garage-partners',  label: 'Garages',          icon: Users },
      { href: '/admin/garage-users',     label: 'Comptes garages',  icon: Users },
      { href: '/admin/garage-cancellations', label: 'Annulations garage', icon: ShieldCheck },
      { href: '/admin/users',            label: 'Utilisateurs',     icon: Users },
      { href: '/admin/vr-locations',     label: 'Lieux VR',         icon: Car },
    ],
  },
  {
    title: 'Tarification',
    items: [
      { href: '/admin/tarifs',     label: 'Tarifs',     icon: Receipt },
      { href: '/admin/surcharges', label: 'Surcharges', icon: DollarSign },
      { href: '/admin/facturation-auto', label: 'Facturation auto', icon: Receipt },
      { href: '/admin/mail-agent',       label: 'Agent Mail',       icon: Mail },
    ],
  },
  {
    title: 'Workflow',
    items: [
      { href: '/admin/dispatch',      label: 'Dispatch',      icon: Radio },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell },
      { href: '/admin/decharges',     label: 'Décharges',     icon: ShieldCheck },
      { href: '/admin/missions',      label: 'Missions',      icon: FileSignature },
    ],
  },
  {
    title: 'Parc & Flotte',
    items: [
      { href: '/admin/parc',           label: 'Plan parc',     icon: Map },
      { href: '/admin/flux2',          label: 'Flux 2',        icon: ToggleLeft },
      { href: '/admin/labels',         label: 'Étiquettes',    icon: Printer },
      { href: '/admin/check-vehicule', label: 'Check véhicule', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Documents & Compta',
    items: [
      { href: '/admin/documents', label: 'Documents', icon: FileText },
      { href: '/admin/archives',  label: 'Archives',  icon: Archive },
      { href: '/admin/cash',      label: 'Caisses',   icon: Wallet },
      { href: '/admin/ventes',    label: 'Ventes',    icon: Car },
      { href: '/admin/tgr',       label: 'TGR',       icon: Truck },
    ],
  },
  {
    title: 'Support',
    items: [
      { href: '/admin/cobrowse', label: 'Demandes d aide', icon: LifeBuoy },
      { href: '/admin/matthieu', label: 'La tête à Matthieu', icon: LifeBuoy },
    ],
  },
  {
    title: 'Réglages',
    items: [
      { href: '/admin/settings', label: 'Paramètres', icon: Settings },
    ],
  },
]

export default function AdminNav() {
  const pathname = usePathname()
  const isHome = pathname === '/admin'

  return (
    <nav className="flex overflow-x-auto items-stretch px-4 py-2 bg-surface-2 border-b scrollbar-hide">
      {/* Lien accueil admin */}
      <Link href="/admin"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 mr-2 ${
          isHome ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
        }`}
        title="Tableau de bord administration"
      >
        <Home size={15} />
        Accueil
      </Link>

      {GROUPS.map((group, gIdx) => (
        <div key={group.title} className="flex items-stretch">
          {/* Separateur vertical entre groupes (sauf avant le premier) */}
          <span className="self-stretch w-px bg-border mx-2" aria-hidden />

          {/* Label de groupe (texte tres discret au-dessus des items) */}
          <div className="flex flex-col items-start gap-0.5 min-w-0">
            <span className="text-ink-faint text-[10px] uppercase tracking-wider px-2 pt-0.5">
              {group.title}
            </span>
            <div className="flex gap-1">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + '/')
                return (
                  <Link key={href} href={href}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-brand text-white'
                        : 'text-ink-secondary hover:text-ink hover:bg-surface-hover'
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      ))}
    </nav>
  )
}
