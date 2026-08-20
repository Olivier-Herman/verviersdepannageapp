import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import AdminVentesClient     from './AdminVentesClient'

export const dynamic = 'force-dynamic'

export default async function AdminVentesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['ventes', 'facturation'] })
  if (!acc.ok) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data: sales } = await sb
    .from('vehicle_sales').select('*').order('created_at', { ascending: false })

  // Compteurs d'offres, en une requête : la liste en affiche un par ligne.
  const ids = (sales || []).map(s => s.id)
  const counts: Record<string, { total: number; confirmed: number; best: number | null }> = {}
  if (ids.length) {
    const { data: bids } = await sb.from('vehicle_sale_bids').select('sale_id, amount, status').in('sale_id', ids)
    for (const b of bids || []) {
      const c = counts[b.sale_id] || (counts[b.sale_id] = { total: 0, confirmed: 0, best: null })
      c.total++
      if (b.status === 'confirmed' || b.status === 'awarded') {
        c.confirmed++
        c.best = c.best == null ? Number(b.amount) : Math.max(c.best, Number(b.amount))
      }
    }
  }

  // Fiches où un abandon est enregistré et qui ne sont pas encore en vente :
  // c'est le vivier du bouton « Depuis un abandon ».
  const { data: abandons } = await sb
    .from('incoming_missions')
    .select('id, mission_number, source, vehicle_brand, vehicle_model, vehicle_plate, abandon_at')
    .not('abandon_at', 'is', null)
    .neq('source', 'police_saisie')
    .order('abandon_at', { ascending: false })
    .limit(50)

  const dejaEnVente = new Set((sales || []).map(s => s.mission_id).filter(Boolean))

  return (
    <AdminVentesClient
      initialSales={(sales || []).map(s => ({ ...s, bids: counts[s.id] || { total: 0, confirmed: 0, best: null } }))}
      abandons={(abandons || []).filter(a => !dejaEnVente.has(a.id))}
    />
  )
}
