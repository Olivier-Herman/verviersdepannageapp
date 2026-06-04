// src/app/admin/parc/page.tsx
//
// Configuration des lignes du parc fourriere : pour chaque zone (figee),
// l'admin peut ajouter/modifier/supprimer des lignes (auto-incrementees
// A1, A2, ...) avec leur capacite.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import ParcAdminClient       from './ParcAdminClient'

export const dynamic = 'force-dynamic'

export default async function ParcAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const ok = ['admin', 'superadmin'].some(r => roles.includes(r) || user.role === r)
  if (!ok) redirect('/')

  const sb = createAdminClient()
  const [{ data: zones }, { data: rows }, { data: settings }, { data: depots }] = await Promise.all([
    sb.from('parc_zones').select('*').order('sort_order'),
    sb.from('parc_rows').select('*').order('zone_key').order('row_number'),
    sb.from('parc_settings').select('canvas_height_px, ville_destruction_email').eq('id', 1).maybeSingle(),
    sb.from('depots').select('id, name, sort_order, active, is_default_parc').order('sort_order'),
  ])

  return (
    <ParcAdminClient
      initialZones={zones || []}
      initialRows={rows  || []}
      initialDepots={depots || []}
      initialCanvasHeight={settings?.canvas_height_px || 2400}
      initialVilleDestructionEmail={(settings as any)?.ville_destruction_email || null}
    />
  )
}
