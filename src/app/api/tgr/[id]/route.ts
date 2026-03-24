// src/app/api/tgr/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendPushToUser }            from '@/lib/push'

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL!
const FROM_EMAIL = 'administration@verviersdepannage.com'

async function getAppToken(): Promise<string> {
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

async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  const token = await getAppToken()
  const message: any = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  }
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }]
  await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${(await getAppToken())}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true })
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes((session.user as any).role)
  const supabase = createAdminClient()
  const body     = await req.json()
  const { action } = body
  const missionId   = params.id

  // Récupérer la mission
  const { data: mission } = await supabase
    .from('tgr_missions')
    .select('*, partner:users!partner_id(id, name, email, odoo_partner_id)')
    .eq('id', missionId)
    .single()

  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // ── ACCEPTER ──────────────────────────────────────────────
  if (action === 'accept' && isAdmin) {
    const { data: me } = await supabase
      .from('users').select('id, name').eq('email', session.user.email!).single()

    // Créer le devis Odoo
    let odooQuoteId: number | null   = null
    let odooQuoteName: string | null = null

    try {
      const { createTGRQuote } = await import('@/lib/odoo')
      const result = await createTGRQuote({
        partnerId:    mission.partner.odoo_partner_id,
        reference:    mission.reference,
        distanceKm:   mission.distance_km ?? 0,
        pickupAddress: mission.pickup_address,
        deliveryAddress: mission.delivery_address,
        plate:        mission.plate,
        brand:        mission.brand,
        model:        mission.model,
      })
      odooQuoteId   = result.orderId
      odooQuoteName = result.orderName
    } catch (err) {
      console.error('[TGR] Odoo quote error:', err)
    }

    await supabase.from('tgr_missions').update({
      status:        'accepted',
      accepted_by:   me?.id,
      accepted_at:   new Date().toISOString(),
      odoo_quote_id: odooQuoteId,
      odoo_quote_name: odooQuoteName,
      updated_at:    new Date().toISOString(),
    }).eq('id', missionId)

    // Push + email au partenaire demandeur
    const deadlineStr = mission.deadline_date
      ? `${new Date(mission.deadline_date).toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long' })} ${mission.deadline_slot === 'before_noon' ? 'avant midi' : 'dans la journée'}`
      : 'Dès que possible'

    await sendPushToUser(mission.partner.id, {
      title: `✅ Mission TGR acceptée — ${mission.plate}`,
      body:  `Votre mission ${mission.reference} a été acceptée`,
      url:   '/services/tgr',
      tag:   `tgr-accepted-${missionId}`,
    }).catch(() => {})

    const htmlAccept = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#2e7d32;padding:20px 30px;border-radius:8px 8px 0 0;">
          <h1 style="color:white;margin:0;font-size:18px;">✅ Mission TGR acceptée</h1>
        </div>
        <div style="background:#1a1a1a;padding:24px 30px;border-radius:0 0 8px 8px;">
          <table cellpadding="8" width="100%">
            <tr><td style="color:#888;font-size:13px;">Référence</td><td style="color:white;font-size:13px;font-weight:bold;">${mission.reference}</td></tr>
            <tr><td style="color:#888;font-size:13px;">Véhicule</td><td style="color:white;font-size:13px;">${mission.plate} — ${mission.brand} ${mission.model}</td></tr>
            <tr><td style="color:#888;font-size:13px;">Pick-up</td><td style="color:white;font-size:13px;">${mission.pickup_address}</td></tr>
            <tr><td style="color:#888;font-size:13px;">Livraison</td><td style="color:white;font-size:13px;">${mission.delivery_address}</td></tr>
            <tr><td style="color:#888;font-size:13px;">Distance</td><td style="color:white;font-size:13px;">${mission.distance_km ?? '—'} km</td></tr>
            <tr><td style="color:#888;font-size:13px;">Deadline</td><td style="color:#CC2222;font-size:13px;font-weight:bold;">${deadlineStr}</td></tr>
            ${odooQuoteName ? `<tr><td style="color:#888;font-size:13px;">Devis</td><td style="color:white;font-size:13px;">${odooQuoteName}</td></tr>` : ''}
          </table>
        </div>
      </div>`

    await sendEmail(
      mission.partner.email,
      `✅ Mission TGR acceptée — ${mission.reference}`,
      htmlAccept
    ).catch(() => {})

    return NextResponse.json({ success: true, odooQuoteName })
  }

  // ── REFUSER ───────────────────────────────────────────────
  if (action === 'refuse' && isAdmin) {
    await supabase.from('tgr_missions').update({
      status:     'refused',
      refused_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', missionId)

    // Push au partenaire demandeur
    await sendPushToUser(mission.partner.id, {
      title: `❌ Mission TGR refusée — ${mission.plate}`,
      body:  `La mission ${mission.reference} a été refusée. Elle a été proposée aux autres partenaires.`,
      url:   '/services/tgr',
      tag:   `tgr-refused-${missionId}`,
    }).catch(() => {})

    // Récupérer tous les partenaires TGR sauf le demandeur
    const { data: partners } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('role', 'partner')
      .eq('active', true)
      .neq('id', mission.partner_id)

    if (partners?.length) {
      const takeUrl = `${APP_URL}/api/tgr/${missionId}/take?token=${mission.take_token}`

      const priorityLabel = mission.priority === 1
        ? 'Priorité 1 — Avant midi J+1 ouvrable'
        : mission.priority === 2
          ? 'Priorité 2 — Dans la journée J+1 ouvrable'
          : 'Priorité 3 — Dès que possible'

      const htmlRefuse = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#CC2222;padding:20px 30px;border-radius:8px 8px 0 0;">
            <h1 style="color:white;margin:0;font-size:18px;">🚗 Mission TGR disponible</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Verviers Dépannage vous propose cette mission</p>
          </div>
          <div style="background:#1a1a1a;padding:24px 30px;border-radius:0 0 8px 8px;">
            <table cellpadding="8" width="100%">
              <tr><td style="color:#888;font-size:13px;">Immatriculation</td><td style="color:white;font-size:13px;font-weight:bold;">${mission.plate}</td></tr>
              <tr><td style="color:#888;font-size:13px;">Véhicule</td><td style="color:white;font-size:13px;">${mission.brand} ${mission.model}</td></tr>
              <tr><td style="color:#888;font-size:13px;">Roulant</td><td style="color:white;font-size:13px;">${mission.is_rolling ? 'Oui' : 'Non'}</td></tr>
              <tr><td style="color:#888;font-size:13px;">Pick-up</td><td style="color:white;font-size:13px;">${mission.pickup_address}</td></tr>
              <tr><td style="color:#888;font-size:13px;">Livraison</td><td style="color:white;font-size:13px;">${mission.delivery_address}</td></tr>
              <tr><td style="color:#888;font-size:13px;">Priorité</td><td style="color:#CC2222;font-size:13px;font-weight:bold;">${priorityLabel}</td></tr>
              ${mission.remarks ? `<tr><td style="color:#888;font-size:13px;">Remarques</td><td style="color:white;font-size:13px;">${mission.remarks}</td></tr>` : ''}
            </table>
            <div style="margin-top:24px;text-align:center;">
              <a href="${takeUrl}"
                 style="background:#CC2222;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;">
                ✅ Je prends la mission
              </a>
            </div>
            <p style="color:#888;font-size:11px;margin-top:16px;text-align:center;">
              Le premier partenaire à cliquer obtient la mission.
            </p>
          </div>
        </div>`

      // Envoi à chaque partenaire avec reply-to = email du demandeur
      for (const partner of partners) {
        await sendEmail(
          partner.email,
          `🚗 Mission TGR disponible — ${mission.plate}`,
          htmlRefuse,
          mission.partner.email  // reply-to = demandeur
        ).catch(err => console.error(`[TGR refuse email ${partner.email}]`, err))
      }
    }

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}

// ── GET : prise de mission via lien email ──────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token    = req.nextUrl.searchParams.get('token')
  const supabase = createAdminClient()

  if (!token) return NextResponse.redirect(`${APP_URL}?error=token_missing`)

  const { data: mission } = await supabase
    .from('tgr_missions')
    .select('*, partner:users!partner_id(name, email)')
    .eq('id', params.id)
    .eq('take_token', token)
    .single()

  if (!mission) return NextResponse.redirect(`${APP_URL}?error=mission_not_found`)
  if (mission.status !== 'refused') {
    return NextResponse.redirect(`${APP_URL}/services/tgr?info=already_taken`)
  }

  // Identifier le partenaire via sa session ou son email dans l'URL
  // Ici on redirige vers une page de confirmation dans l'app
  return NextResponse.redirect(
    `${APP_URL}/services/tgr/take?missionId=${params.id}&token=${token}`
  )
}
