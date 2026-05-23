import Link from 'next/link'
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { Radio, Percent, Database, MapPin, Archive } from 'lucide-react'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function DispatchAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [
    { count: missionsCount },
    { count: sourcesCount },
    { count: surchargesCount },
    { count: depotsCount },
    { count: archivedCount },
  ] = await Promise.all([
    sb.from('incoming_missions').select('id', { count: 'exact', head: true }).is('archived_at', null),
    sb.from('mission_source_catalog').select('key', { count: 'exact', head: true }),
    sb.from('surcharge_clients').select('key', { count: 'exact', head: true }),
    sb.from('depots').select('id', { count: 'exact', head: true }),
    sb.from('incoming_missions').select('id', { count: 'exact', head: true }).not('archived_at', 'is', null),
  ])

  const sections = [
    {
      href:  '/admin/missions',
      label: 'Missions',
      icon:  Radio,
      desc:  'Historique, erreurs de parsing, monitoring des emails entrants.',
      count: missionsCount || 0,
      countLabel: 'missions',
    },
    {
      href:  '/admin/sources',
      label: 'Sources',
      icon:  Database,
      desc:  'Catalogue des sources (Touring, Allianz, VAB…). Pilote les majorations et tarifs.',
      count: sourcesCount || 0,
      countLabel: 'sources',
    },
    {
      href:  '/admin/surcharges',
      label: 'Majorations',
      icon:  Percent,
      desc:  'Grilles de majoration tarifaire par client × jour × plage horaire.',
      count: surchargesCount || 0,
      countLabel: 'grilles',
    },
    {
      href:  '/admin/depots',
      label: 'Dépôts',
      icon:  MapPin,
      desc:  'Parcs et lieux de dépôt utilisés pour le suivi véhicule.',
      count: depotsCount || 0,
      countLabel: 'dépôts',
    },
    {
      href:  '/admin/archives',
      label: 'Archives',
      icon:  Archive,
      desc:  'Missions facturées archivées automatiquement (7 jours après facturation).',
      count: archivedCount || 0,
      countLabel: 'archivées',
    },
  ]

  return (
    <>
      <div className="p-4 lg:p-6 space-y-4">
        <div>
          <h1 className="text-ink text-xl font-semibold">Module Dispatch</h1>
          <p className="text-ink-muted text-sm">Paramétrage du module de dispatch et de facturation.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map(s => (
            <Link key={s.href} href={s.href}
              className="bg-surface border rounded-2xl p-5 hover:bg-surface-hover hover:border-brand transition group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand group-hover:bg-brand group-hover:text-white transition">
                  <s.icon size={20} />
                </div>
                <span className="text-ink-muted text-xs">{s.count} {s.countLabel}</span>
              </div>
              <h2 className="text-ink font-semibold text-base mb-1">{s.label}</h2>
              <p className="text-ink-muted text-sm">{s.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
