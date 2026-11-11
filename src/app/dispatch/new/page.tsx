// src/app/dispatch/new/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import NewMissionClient      from './NewMissionClient'
import { cookies }           from 'next/headers'
import { isPreviewOn }       from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

export default async function NewMissionPage({ searchParams }: { searchParams?: { ancien?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r =>
    (user.roles || [user.role]).includes(r)
  )
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()

  const [{ data: drivers }, { data: warnings }, { data: catalogSources }] = await Promise.all([
    supabase.from('users').select('id, name').eq('active', true)
      .or('role.in.(driver,admin,superadmin),roles.ov.{driver,admin,superadmin}').order('name'),
    supabase.from('mission_warnings').select('id, label, icon, color')
      .eq('active', true).order('sort_order'),
    // Catalog central des sources : pas de hardcode cote client.
    // Toute source ajoutee dans /admin/sources apparait automatiquement ici.
    // Tri alphabetique par label (cohereent avec /admin/sources).
    supabase.from('mission_source_catalog').select('key, label').eq('active', true).order('label'),
  ])

  // Création rapide : préversion du nouveau Dispatch (Olivier seul). Même bascule que /dispatch :
  // trois appuis sur le titre du Dispatch (cookie) ou ?ancien=1 → présentation actuelle.
  const rapide = await isPreviewOn('dispatch_v2', user.role, user.id)
    && searchParams?.ancien !== '1' && cookies().get('vd_dispatch_ancien')?.value !== '1'
  // Raccourcis : les 6 sources les plus utilisées ces 3 derniers mois.
  let raccourcis: string[] = []
  if (rapide) {
    // Lecture par tranches de 1 000 (limite du serveur), ordre stable par id.
    const n = new Map<string, number>()
    const depuis = new Date(Date.now() - 90 * 86400000).toISOString()
    for (let de = 0; de < 20000; de += 1000) {
      const { data: page } = await supabase.from('incoming_missions').select('source')
        .gte('received_at', depuis).eq('dossier_leg', false).order('id').range(de, de + 999)
      for (const r of page || []) if ((r as any).source) n.set((r as any).source, (n.get((r as any).source) || 0) + 1)
      if (!page || page.length < 1000) break
    }
    raccourcis = Array.from(n.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k).filter(k => k !== 'unknown').slice(0, 6)
  }

  return (
    <NewMissionClient
      rapide={rapide}
      raccourcis={raccourcis}
      drivers={drivers || []}
      warnings={warnings || []}
      sources={catalogSources || []}
      userName={user.name || ''}
      userEmail={user.email || undefined}
      userId={user.id || undefined}
      userRole={user.role || ''}
      userModules={user.modules || []}
      googleMapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
    />
  )
}
