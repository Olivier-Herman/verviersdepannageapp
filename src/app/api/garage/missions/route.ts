// GET  /api/garage/missions : liste des missions du garage courant (filtre
//                             par current partner = last_selected_at)
// POST /api/garage/missions : cree une nouvelle demande de mission
// Olivier 2026-06-02.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToRole }    from '@/lib/push'
import { isVhuSource }       from '@/lib/missions/vhu'
import { resolveMissionDocsBatch } from '@/lib/garage/mission-documents'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

async function getCurrentPartnerId(userId: string): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('garage_user_partners')
    .select('garage_partner_id, last_selected_at, is_default, garage_partners ( active )')
    .eq('user_id', userId)
  const links = (data || []).filter(l => (l as any).garage_partners?.active)
  if (links.length === 0) return null
  // Tri : last_selected_at desc, puis is_default
  links.sort((a, b) => {
    if (a.last_selected_at && b.last_selected_at) return b.last_selected_at!.localeCompare(a.last_selected_at!)
    if (a.last_selected_at) return -1
    if (b.last_selected_at) return 1
    if (a.is_default && !b.is_default) return -1
    if (b.is_default && !a.is_default) return 1
    return 0
  })
  return links[0].garage_partner_id
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'garage') return NextResponse.json({ error: 'Reserve garage' }, { status: 403 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const partnerId = await getCurrentPartnerId(userId)
  if (!partnerId) return NextResponse.json({ missions: [] })

  const sb = createAdminClient()

  // Olivier 2026-07-15 : le garage voit TOUTES les interventions de SA source
  // (pas seulement ses propres demandes). Filtre par la source attribuée au
  // partner (source_key), + repli sur requested_by_garage_id pour les fiches
  // sans source dédiée.
  const { data: partner } = await sb
    .from('garage_partners').select('source_key').eq('id', partnerId).maybeSingle()
  const sourceKey = (partner?.source_key || '').trim()

  let q = sb
    .from('incoming_missions')
    .select(`
      id, mission_number, status, mission_type,
      vehicle_plate, vehicle_brand, vehicle_model,
      incident_address, incident_city,
      received_at, accepted_at, completed_at,
      remarks_general,
      requested_by_user_id, odoo_quote_id, invoice_odoo_id, invoice_number
    `)
    .order('received_at', { ascending: false })
    .limit(200)
  q = sourceKey
    ? q.or(`source.eq.${sourceKey},requested_by_garage_id.eq.${partnerId}`)
    : q.eq('requested_by_garage_id', partnerId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const missions = data || []

  // « Commandé par » : nom du user garage à l'origine de la demande (si connu).
  const userIds = [...new Set(missions.map((m: any) => m.requested_by_user_id).filter(Boolean))]
  const nameById = new Map<string, string>()
  if (userIds.length) {
    const { data: users } = await sb.from('users').select('id, name').in('id', userIds)
    for (const u of (users || [])) nameById.set(u.id, u.name || '')
  }

  // Facture + note de crédit Odoo (résolues via la clé API partagée, best-effort).
  const billable = missions.filter((m: any) => m.odoo_quote_id || m.invoice_odoo_id)
  const docsById = billable.length ? await resolveMissionDocsBatch(billable) : new Map()

  const out = missions.map((m: any) => {
    const docs = docsById.get(m.id)
    return {
      id: m.id, mission_number: m.mission_number, status: m.status, mission_type: m.mission_type,
      vehicle_plate: m.vehicle_plate, vehicle_brand: m.vehicle_brand, vehicle_model: m.vehicle_model,
      incident_address: m.incident_address, incident_city: m.incident_city,
      received_at: m.received_at, accepted_at: m.accepted_at, completed_at: m.completed_at,
      remarks_general: m.remarks_general,
      commanded_by: (m.requested_by_user_id && nameById.get(m.requested_by_user_id)) || null,
      invoice:      docs?.invoice     ? { number: docs.invoice.number }     : null,
      credit_note:  docs?.creditNote  ? { number: docs.creditNote.number }  : null,
    }
  })

  return NextResponse.json({ missions: out, partner_id: partnerId })
}

/**
 * POST body : { type: 'DSP'|'REM', vehicle_plate, vehicle_brand, vehicle_model,
 *               incident_address, contact_phone, remarks, urgency }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'garage') return NextResponse.json({ error: 'Reserve garage' }, { status: 403 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const partnerId = await getCurrentPartnerId(userId)
  if (!partnerId) return NextResponse.json({ error: 'Aucune entite active' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const type    = String(body?.type || '').toUpperCase()
  const plate   = String(body?.vehicle_plate || '').trim().toUpperCase()
  const address = String(body?.incident_address || '').trim()
  if (!['DSP', 'REM'].includes(type)) return NextResponse.json({ error: 'type doit etre DSP ou REM' }, { status: 400 })
  if (!plate)   return NextResponse.json({ error: 'plaque requise' }, { status: 400 })
  if (!address) return NextResponse.json({ error: 'adresse intervention requise' }, { status: 400 })

  const sb = createAdminClient()

  // Recup le partner pour billed_to (Odoo) + source_key
  const { data: partner } = await sb
    .from('garage_partners')
    .select('id, name, odoo_partner_id, source_key')
    .eq('id', partnerId)
    .maybeSingle()
  if (!partner) return NextResponse.json({ error: 'Partner introuvable' }, { status: 400 })

  // Olivier 2026-06-02 : pas d encaissement chauffeur pour les missions
  // garage (facturation directe au garage via Odoo). amount_to_collect=null.
  // Le calcul tarif (prise en charge + km) se fera cote facturation via le
  // systeme source_tariffs en matchant sur (source=partner.source_key, mission_type).
  const nowIso     = new Date().toISOString()
  const externalId = `GRG-${Date.now().toString(36).toUpperCase()}`

  // Date/heure d'intervention souhaitée (défaut = maintenant). Si le garage a
  // choisi une date > 30 min dans le futur, c'est un RDV planifié (rdv_at).
  const interventionIso = body.intervention_at && !isNaN(Date.parse(body.intervention_at))
    ? new Date(body.intervention_at).toISOString()
    : nowIso
  const isFutureRdv = new Date(interventionIso).getTime() > Date.now() + 30 * 60 * 1000

  // VHU « Car Parts & Recycling » : pas de validation nécessaire → créée
  // directement en 'dispatching' (arrive dans l'onglet VHU, prête à assigner).
  const vhu = isVhuSource(partner.source_key)
  const { data: m, error } = await sb.from('incoming_missions').insert({
    external_id:             externalId,
    source:                  partner.source_key,  // ex: 'garage_abc123' (canonique catalog)
    mission_type:            type === 'DSP' ? 'depannage' : 'remorquage',
    status:                  vhu ? 'dispatching' : 'new',
    vehicle_plate:           plate,
    vehicle_brand:           body.vehicle_brand || null,
    vehicle_model:           body.vehicle_model || null,
    incident_address:        address,
    incident_lat:            body.incident_lat != null && Number.isFinite(Number(body.incident_lat)) ? Number(body.incident_lat) : null,
    incident_lng:            body.incident_lng != null && Number.isFinite(Number(body.incident_lng)) ? Number(body.incident_lng) : null,
    client_name:             partner.name,
    client_phone:            body.contact_phone || null,
    billed_to_id:            partner.odoo_partner_id || null,
    billed_to_name:          partner.name,
    amount_to_collect:       null,  // pas d encaissement chauffeur
    remarks_general:         body.remarks || null,
    requested_by_garage_id:  partnerId,
    requested_by_user_id:    userId,  // « Commandé par » côté espace garage
    photos_visible_to_garage:false,  // dispatch decide d activer
    received_at:             nowIso,
    intervention_date:       interventionIso,
    incident_at:             interventionIso,
    rdv_at:                  isFutureRdv ? interventionIso : null,
    created_at:              nowIso,
    updated_at:              nowIso,
  }).select('id, mission_number, external_id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notif dispatch : une commande garage doit alerter comme les autres sources
  // (mail/Kaze/manuel notifient déjà). Best-effort, ne bloque pas la création.
  // Olivier 2026-06-17.
  try {
    const vehicleLabel = [body.vehicle_brand, body.vehicle_model, plate].filter(Boolean).join(' ')
    await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
      title: `${type === 'DSP' ? '🔧 Dépannage' : '🚛 Remorquage'} — GARAGE`,
      body:  `${vehicleLabel || 'Nouvelle demande'} · ${partner.name}`,
      url:   `/dispatch/${m.id}`,
      tag:   `mission-${m.id}`,
      icon:  '/icons/apple-touch-icon.png',
    }, 'dispatch_new_mission')
  } catch (e: any) {
    console.error('[garage/missions] push KO (non bloquant):', e?.message)
  }

  return NextResponse.json({ mission: m })
}
