// Suivi & relance des réquisitoires manquants (fourrière / saisie).
// Liste les saisies sans réquisitoire reçu, avec l'indicateur « email policier
// connu (Odoo) » + boutons d'action. Olivier 2026-08-08.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'
import { RELANCE_SOURCES }   from '@/lib/requisitoire/relance'
import RelanceRequisitoireClient from './RelanceRequisitoireClient'

export const dynamic = 'force-dynamic'

export default async function RelanceRequisitoirePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const roles = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])].filter(Boolean)
  const modules: string[] = user.modules || []
  const hasAccess = roles.some((r: string) => ['admin', 'superadmin'].includes(r)) || modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  const sb = createAdminClient()
  const { data: rows } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, incident_address, address, created_at, saisie_motif_label, police_pv_number, police_zone, officer_name, officer_partner_id, requisitoire_token, requisitoire_stop, requisitoire_last_reminder_at, requisitoire_reminder_count')
    .in('source', RELANCE_SOURCES)
    .is('requisitoire_at', null)
    .not('status', 'in', '(cancelled,ignored,deleted)')
    .order('created_at', { ascending: true })
    .limit(500)

  const missions = rows || []
  // Le token de dépôt est généré À LA DEMANDE (copie du lien / envoi relance),
  // PAS ici — sinon 200+ UPDATE séquentiels feraient timeouter le rendu.

  // Résout en un appel l'email des policiers (contacts Odoo).
  const partnerIds = [...new Set(missions.map(m => m.officer_partner_id).filter(Boolean))] as number[]
  const emailMap: Record<number, string> = {}
  if (partnerIds.length) {
    try {
      const parts = await odooRpc<any[]>('res.partner', 'read', [partnerIds], { fields: ['email'] })
      for (const p of (parts || [])) if (p.email && /@/.test(p.email)) emailMap[p.id] = p.email
    } catch { /* Odoo indispo → pas d'email résolu */ }
  }

  const items = missions.map(m => ({
    id: m.id,
    ref: m.mission_number != null ? `SAI-${m.mission_number}` : null,
    plate: m.vehicle_plate,
    vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
    location: m.incident_address || m.address || null,
    saisie_at: m.created_at,
    zone: m.police_zone,
    officer_name: m.officer_name,
    officer_email: m.officer_partner_id ? (emailMap[m.officer_partner_id] || null) : null,
    officer_linked: !!m.officer_partner_id,
    token: m.requisitoire_token,
    stop: m.requisitoire_stop,
    reminder_count: m.requisitoire_reminder_count || 0,
    last_reminder_at: m.requisitoire_last_reminder_at,
  }))

  return <RelanceRequisitoireClient initialItems={items} appUrl={process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'} />
}
