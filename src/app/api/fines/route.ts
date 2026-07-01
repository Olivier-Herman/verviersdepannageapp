// POST /api/fines       : cree une amende + envoie email achats + log
// GET  /api/fines        : liste paginated avec filtres (driver, plate, date range)
//
// Olivier 2026-06-01. Reserve facturation / admin / superadmin.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendFinePurchaseEmail }     from '@/lib/emails'
import { suggestDriverForFine }      from '@/lib/fines/suggest-driver'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface CreateFineBody {
  photo_url:        string
  infraction_date:  string             // ISO 8601
  plate:            string
  amount:           number
  infraction_place?: string
  infraction_type?:  string
  infraction_ref?:   string
  identification_code?: string
  driver_id?:        string | null     // si user a choisi manuellement
  mission_id?:       string | null
  notes?:            string
  /** Si true, override le match auto avec driver_id (sinon on relance le matching). */
  override_match?:   boolean
}

function hasAccessRole(user: any): boolean {
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  return ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!hasAccessRole(user)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as CreateFineBody
  if (!body.photo_url)        return NextResponse.json({ error: 'photo_url requise' }, { status: 400 })
  if (!body.infraction_date)  return NextResponse.json({ error: 'infraction_date requise' }, { status: 400 })
  if (!body.plate)            return NextResponse.json({ error: 'plate requise' }, { status: 400 })
  if (!Number.isFinite(body.amount) || body.amount <= 0) {
    return NextResponse.json({ error: 'amount > 0 requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const normalizedPlate = body.plate.replace(/[-.\s]/g, '').toUpperCase().trim()
  const infractionDate  = new Date(body.infraction_date)
  if (Number.isNaN(infractionDate.getTime())) {
    return NextResponse.json({ error: 'infraction_date invalide (ISO 8601 attendu)' }, { status: 400 })
  }

  // Anti-doublon : un même n° de PV ne peut être enregistré deux fois.
  const refN = String(body.infraction_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (refN) {
    const { data: refs } = await sb.from('fines').select('infraction_ref').not('infraction_ref', 'is', null)
    const dup = (refs || []).some((r: any) => String(r.infraction_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === refN)
    if (dup) return NextResponse.json({ error: `Ce n° de PV (${body.infraction_ref}) est déjà enregistré.` }, { status: 409 })
  }

  // Match chauffeur : si override + driver_id explicite, on prend ca. Sinon on
  // (re)lance le matching auto pour stocker la confidence + mission_id.
  let driverId    = body.driver_id || null
  let missionId   = body.mission_id || null
  let matchMethod: 'manual' | 'auto' | 'none' = 'none'
  let matchConfidence: string | null = null

  if (body.override_match && driverId) {
    matchMethod = 'manual'
  } else {
    const suggestion = await suggestDriverForFine(normalizedPlate, infractionDate)
    if (driverId && driverId !== suggestion.driver_id) {
      // L user a choisi un chauffeur different de la suggestion auto -> manual
      matchMethod = 'manual'
      missionId   = body.mission_id || null
    } else if (suggestion.driver_id) {
      driverId        = suggestion.driver_id
      missionId       = suggestion.mission_id
      matchMethod     = 'auto'
      matchConfidence = suggestion.confidence
    }
  }

  // Resolve l user createur
  const { data: me } = await sb
    .from('users').select('id, name').eq('email', session.user.email).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // Resolve nom chauffeur si on a un driver_id (pour log et email)
  let driverName: string | null = null
  if (driverId) {
    const { data: d } = await sb.from('users').select('name').eq('id', driverId).maybeSingle()
    driverName = d?.name || null
  }

  // Resolve mission_ref pour email
  let missionRef: string | undefined
  if (missionId) {
    const { data: m } = await sb
      .from('incoming_missions')
      .select('mission_number, external_id, dossier_number')
      .eq('id', missionId)
      .maybeSingle()
    if (m) {
      missionRef = m.mission_number != null ? `#${m.mission_number}` : (m.external_id || m.dossier_number || undefined)
    }
  }

  // Email achats — meme adresse que les avances
  let emailSent = false
  let emailSentAt: string | null = null
  try {
    const { data: setting } = await sb
      .from('app_settings').select('value').eq('key', 'odoo_purchase_email').maybeSingle()
    if (setting?.value) {
      const purchaseEmail = JSON.parse(setting.value) as string
      await sendFinePurchaseEmail({
        to:               purchaseEmail,
        plate:            normalizedPlate,
        amount:           body.amount,
        infractionDate:   body.infraction_date,
        infractionPlace:  body.infraction_place,
        infractionType:   body.infraction_type,
        infractionRef:    body.infraction_ref,
        photoUrl:         body.photo_url,
        driverName:       driverName || undefined,
        missionRef,
        employeeName:     session.user.name ?? me.name ?? 'Admin',
        notes:            body.notes,
      })
      emailSent = true
      emailSentAt = new Date().toISOString()
    }
  } catch (mailErr: any) {
    console.error('[fines POST] sendFinePurchaseEmail:', mailErr?.message)
  }

  // Insert dans fines
  const { data: fine, error: insErr } = await sb
    .from('fines')
    .insert({
      photo_url:               body.photo_url,
      infraction_date:         infractionDate.toISOString(),
      infraction_place:        body.infraction_place || null,
      infraction_type:         body.infraction_type  || null,
      infraction_ref:          body.infraction_ref   || null,
      identification_code:     body.identification_code || null,
      amount:                  body.amount,
      plate:                   normalizedPlate,
      driver_id:               driverId,
      driver_match_method:     matchMethod,
      driver_match_confidence: matchConfidence,
      mission_id:              missionId,
      status:                  emailSent ? 'sent_to_purchase' : 'pending',
      notes:                   body.notes || null,
      purchase_email_sent:     emailSent,
      purchase_email_sent_at:  emailSentAt,
      created_by:              me.id,
    })
    .select()
    .single()

  if (insErr) {
    console.error('[fines POST] insert:', insErr.message)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // Log activite
  try {
    await sb.from('activity_logs').insert({
      user_id:     me.id,
      action:      'fine_created',
      entity_type: 'fine',
      entity_id:   fine.id,
      details: {
        plate:                   normalizedPlate,
        amount:                  body.amount,
        infraction_date:         infractionDate.toISOString(),
        infraction_type:         body.infraction_type,
        driver_id:               driverId,
        driver_name:             driverName,
        driver_match_method:     matchMethod,
        driver_match_confidence: matchConfidence,
        mission_id:              missionId,
        purchase_email_sent:     emailSent,
      },
    })
  } catch (logErr: any) {
    console.error('[fines POST] activity_logs:', logErr?.message)
  }

  return NextResponse.json({ ok: true, fine })
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!hasAccessRole(user)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const sb = createAdminClient()
  const { searchParams } = new URL(req.url)
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '50'), 200)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'),  0)
  const driverFilter = searchParams.get('driver_id')
  const plateFilter  = searchParams.get('plate')
  const statusFilter = searchParams.get('status')
  const fromDate     = searchParams.get('from')
  const toDate       = searchParams.get('to')

  let query = sb
    .from('fines')
    .select(`
      *,
      driver:users!fines_driver_id_fkey(id, name, email),
      created_by_user:users!fines_created_by_fkey(id, name),
      mission:incoming_missions!fines_mission_id_fkey(id, mission_number, external_id, dossier_number)
    `, { count: 'exact' })
    .order('infraction_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (driverFilter) query = query.eq('driver_id', driverFilter)
  if (plateFilter)  query = query.ilike('plate', plateFilter.replace(/[-.\s]/g, '').toUpperCase())
  if (statusFilter) query = query.eq('status', statusFilter)
  if (fromDate)     query = query.gte('infraction_date', fromDate)
  if (toDate)       query = query.lte('infraction_date', toDate)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ fines: data, total: count })
}
