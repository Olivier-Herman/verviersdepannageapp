// src/app/api/tgr/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { getRouteDistance, calculateTGRDeadline } from '@/lib/googlemaps'
import { sendPushToUsers }           from '@/lib/push'
import { randomUUID }                from 'crypto'

// ── POST : soumettre une nouvelle mission TGR ──────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const body     = await req.json()
  const {
    reference, plate, brand, model, isRolling,
    pickupAddress, deliveryAddress, priority, remarks,
  } = body

  if (!plate || !brand || !model || !pickupAddress || !deliveryAddress || !priority) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  const { data: me } = await supabase
    .from('users').select('id, name, email').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // Calcul deadline
  const deadline = calculateTGRDeadline(priority as 1 | 2 | 3)

  // Calcul distance Google Maps
  let distanceKm: number | null = null
  try {
    const dist = await getRouteDistance(pickupAddress, deliveryAddress)
    distanceKm = dist.distanceKm
  } catch (err) {
    console.error('[TGR] Distance calc error:', err)
  }

  // Référence = dossier ou plaque
  const missionRef = (reference?.trim() || plate.replace(/[-.\s]/g, '').toUpperCase()).trim()

  // Token unique pour "Je prends la mission"
  const takeToken = randomUUID()

  const { data: mission, error } = await supabase
    .from('tgr_missions')
    .insert({
      partner_id:       me.id,
      reference:        missionRef,
      plate:            plate.replace(/[-.\s]/g, '').toUpperCase().trim(),
      brand,
      model,
      is_rolling:       isRolling ?? true,
      pickup_address:   pickupAddress,
      delivery_address: deliveryAddress,
      priority,
      deadline_date:    deadline.date,
      deadline_slot:    deadline.slot,
      remarks:          remarks || null,
      distance_km:      distanceKm,
      take_token:       takeToken,
      status:           'pending',
    })
    .select().single()

  if (error) {
    console.error('[TGR POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Notifications push aux dispatchers configurés
  const { data: notifyUsers } = await supabase
    .from('users')
    .select('id')
    .eq('tgr_push_notify', true)
    .eq('active', true)

  if (notifyUsers?.length) {
    await sendPushToUsers(notifyUsers.map(u => u.id), {
      title: `🚗 Nouvelle mission TGR — ${plate}`,
      body:  `${brand} ${model} · ${pickupAddress.split(',')[0]} → ${deliveryAddress.split(',')[0]}`,
      url:   '/admin/tgr',
      tag:   `tgr-${mission.id}`,
    }).catch(err => console.error('[Push TGR]', err))
  }

  // Email info@verviersdepannage.com
  const { data: infoEmailSetting } = await supabase
    .from('app_settings').select('value').eq('key', 'tgr_info_email').single()

  if (infoEmailSetting?.value) {
    const infoEmail = JSON.parse(infoEmailSetting.value) as string
    await sendTGRNewMissionEmail({
      to:          infoEmail,
      mission,
      partnerName: me.name,
      deadline:    deadline.label,
      distanceKm,
    }).catch(err => console.error('[Email TGR new]', err))
  }

  return NextResponse.json({ success: true, mission })
}

// ── GET : liste des missions TGR ───────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase  = createAdminClient()
  const isAdmin   = ['admin', 'superadmin', 'dispatcher'].includes((session.user as any).role)

  const { data: me } = await supabase
    .from('users').select('id, role').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  let query = supabase
    .from('tgr_missions')
    .select('*, partner:users!partner_id(name, email), acceptedBy:users!accepted_by(name)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (!isAdmin) {
    query = query.eq('partner_id', me.id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// ── Helper email nouvelle mission ──────────────────────────
async function sendTGRNewMissionEmail(params: {
  to:          string
  mission:     any
  partnerName: string
  deadline:    string
  distanceKm:  number | null
}) {
  const { to, mission, partnerName, deadline, distanceKm } = params

  const getAppToken = async () => {
    const res = await fetch(
      `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     process.env.AZURE_AD_CLIENT_ID!,
          client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
          grant_type:    'client_credentials',
          scope:         'https://graph.microsoft.com/.default',
        })
      }
    )
    const data = await res.json()
    return data.access_token
  }

  const FROM_EMAIL = 'administration@verviersdepannage.com'
  const subject    = `🚗 Nouvelle mission TGR — ${mission.plate} — ${partnerName}`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#CC2222;padding:20px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:white;margin:0;font-size:18px;">Nouvelle mission TGR</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Demandeur : ${partnerName}</p>
      </div>
      <div style="background:#1a1a1a;padding:24px 30px;border-radius:0 0 8px 8px;">
        <table cellpadding="8" width="100%" style="font-family:Arial,sans-serif;">
          <tr><td style="color:#888;font-size:13px;">Référence</td><td style="color:white;font-size:13px;font-weight:bold;">${mission.reference}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Immatriculation</td><td style="color:white;font-size:13px;">${mission.plate}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Véhicule</td><td style="color:white;font-size:13px;">${mission.brand} ${mission.model}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Roulant</td><td style="color:white;font-size:13px;">${mission.is_rolling ? 'Oui' : 'Non'}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Pick-up</td><td style="color:white;font-size:13px;">${mission.pickup_address}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Livraison</td><td style="color:white;font-size:13px;">${mission.delivery_address}</td></tr>
          ${distanceKm ? `<tr><td style="color:#888;font-size:13px;">Distance</td><td style="color:white;font-size:13px;">${distanceKm} km</td></tr>` : ''}
          <tr><td style="color:#888;font-size:13px;">Deadline</td><td style="color:#CC2222;font-size:13px;font-weight:bold;">${deadline}</td></tr>
          ${mission.remarks ? `<tr><td style="color:#888;font-size:13px;">Remarques</td><td style="color:white;font-size:13px;">${mission.remarks}</td></tr>` : ''}
        </table>
        <div style="margin-top:20px;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/admin/tgr"
             style="background:#CC2222;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;">
            Gérer la mission →
          </a>
        </div>
      </div>
    </div>`

  const token = await getAppToken()
  await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    })
  })
}
