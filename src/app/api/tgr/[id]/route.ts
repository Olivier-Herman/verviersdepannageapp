// src/app/api/tgr/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendPushToUser }            from '@/lib/push'
import { createTGRQuote }            from '@/lib/odoo'

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL    || 'https://app.verviersdepannage.com'
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
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

async function sendMail(params: {
  to:       string
  subject:  string
  html:     string
  replyTo?: string
}) {
  const token   = await getAppToken()
  const message: any = {
    subject: params.subject,
    body:    { contentType: 'HTML', content: params.html },
    toRecipients: [{ emailAddress: { address: params.to } }],
  }
  if (params.replyTo) message.replyTo = [{ emailAddress: { address: params.replyTo } }]
  await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message, saveToSentItems: true }),
  })
}

function emailWrapper(title: string, color: string, rows: [string, string][], extra?: string): string {
  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;color:#888;font-size:13px;width:130px;vertical-align:top;">${label}</td>
      <td style="padding:8px 0;color:white;font-size:13px;">${value}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:#0F0F0F;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
    <!-- Header -->
    <tr><td style="background:${color};padding:20px 30px;border-radius:8px 8px 0 0;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:16px;">
            <img src="${APP_URL}/logo.jpg" alt="Verviers Dépannage" height="40" style="display:block;" />
          </td>
          <td style="border-left:1px solid rgba(255,255,255,0.3);padding-left:16px;">
            <img src="${APP_URL}/logo-touring.png" alt="Touring" height="28" style="display:block;" />
          </td>
        </tr>
      </table>
      <h1 style="color:white;margin:12px 0 0;font-size:18px;font-weight:bold;">${title}</h1>
    </td></tr>
    <!-- Body -->
    <tr><td style="background:#1A1A1A;padding:24px 30px;border-radius:0 0 8px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${rowsHtml}
      </table>
      ${extra || ''}
    </td></tr>
    <!-- Footer -->
    <tr><td style="padding:20px 30px;text-align:center;border-top:1px solid #2a2a2a;">
      <p style="color:#888;font-size:12px;margin:0 0 6px;line-height:1.8;">
        <strong style="color:white;">Verviers Dépannage SA</strong><br>
        Lefin 12, 4860 Pepinster (Belgique) · TVA : BE0460.759.205<br>
        <a href="tel:+3287351820" style="color:#888;text-decoration:none;">+32(0)87/35.18.20</a> ·
        <a href="mailto:info@verviersdepannage.com" style="color:#888;text-decoration:none;">info@verviersdepannage.com</a>
      </p>
      <p style="color:#444;font-size:11px;margin:8px 0 0;">
        Powered by <a href="https://hoos.cloud" style="color:#666;text-decoration:none;font-weight:bold;">HOOS</a>
      </p>
    </td></tr>
  </table>
</body></html>`
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes((session.user as any).role)
  if (!isAdmin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const supabase   = createAdminClient()
  const body       = await req.json()
  const { action, plannedDate, plannedSlot } = body
  const missionId  = params.id

  const { data: mission } = await supabase
    .from('tgr_missions')
    .select('*, partner:users!partner_id(id, name, email, odoo_partner_id)')
    .eq('id', missionId)
    .single()

  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.status !== 'pending') {
    return NextResponse.json({ error: 'Mission déjà traitée' }, { status: 409 })
  }

  const { data: me } = await supabase
    .from('users').select('id, name').eq('email', session.user.email!).single()

  // ── ACCEPTER ──────────────────────────────────────────────
  if (action === 'accept') {
    let odooQuoteId:   number | null = null
    let odooQuoteName: string | null = null
    let odooError:     string | null = null

    const partnerId = mission.partner?.odoo_partner_id
    if (!partnerId) {
      odooError = `Partenaire Odoo non configuré pour ${mission.partner?.name} — configurez l'ID Odoo dans Admin → Utilisateurs`
      console.error('[TGR Accept]', odooError)
    } else {
      try {
        const result = await createTGRQuote({
          partnerId,
          reference:       mission.reference,
          distanceKm:      mission.distance_km ?? 1,
          pickupAddress:   mission.pickup_address,
          deliveryAddress: mission.delivery_address,
          plate:           mission.plate,
          brand:           mission.brand,
          model:           mission.model,
        })
        odooQuoteId   = result.orderId
        odooQuoteName = result.orderName
        // Confirmer le devis automatiquement
        try {
          await import('@/lib/odoo').then(({ default: _, ...m }) => {
            const rpcFn = (m as any).rpc || null
            // On utilise l'API Odoo directement
          })
          const confirmRes = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', method: 'call', id: Date.now(),
              params: {
                service: 'object', method: 'execute_kw',
                args: [process.env.ODOO_DB, parseInt(process.env.ODOO_UID||'8'), process.env.ODOO_API_KEY,
                  'sale.order', 'action_confirm', [[odooQuoteId]]
                ]
              }
            })
          })
          console.log('[TGR] Devis confirmé:', odooQuoteId)
        } catch(e: any) {
          console.error('[TGR] Erreur confirmation devis:', e.message)
        }
      } catch (err: any) {
        odooError = err.message
        console.error('[TGR Accept Odoo]', err.message)
      }
    }

    // Montant estimé HTVA
    let odooEstimatedAmount: number | null = null
    if (mission.distance_km) {
      try {
        const priceRes = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'call', id: Date.now(),
            params: {
              service: 'object', method: 'execute_kw',
              args: [process.env.ODOO_DB, parseInt(process.env.ODOO_UID||'8'), process.env.ODOO_API_KEY,
                'product.product', 'search_read',
                [[['default_code', '=', 'TGRTouring']]],
                { fields: ['list_price'], limit: 1 }
              ]
            }
          })
        })
        const priceData = await priceRes.json()
        if (priceData.result?.[0]?.list_price) {
          odooEstimatedAmount = priceData.result[0].list_price * mission.distance_km
        }
      } catch(e) { /* pas critique */ }
    }

    // Date de prise en charge prévue
    const plannedDateStr = plannedDate || mission.deadline_date
    const plannedSlotStr = plannedSlot || mission.deadline_slot

    const slotLabel = plannedSlotStr === 'before_noon' ? 'avant midi' :
                      plannedSlotStr === 'during_day'  ? 'dans la journée' : ''

    const plannedLabel = plannedDateStr
      ? `${new Date(plannedDateStr).toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} ${slotLabel}`
      : 'Dès que possible'

    await supabase.from('tgr_missions').update({
      status:           'accepted',
      accepted_by:      me?.id,
      accepted_at:      new Date().toISOString(),
      deadline_date:    plannedDateStr || mission.deadline_date,
      deadline_slot:    plannedSlotStr || mission.deadline_slot,
      odoo_quote_id:    odooQuoteId,
      odoo_quote_name:  odooQuoteName,
      updated_at:       new Date().toISOString(),
    }).eq('id', missionId)

    // Push au partenaire
    await sendPushToUser(mission.partner.id, {
      title: `✅ Mission TGR acceptée — ${mission.plate}`,
      body:  `${mission.reference} · Prise en charge : ${plannedLabel}`,
      url:   '/services/tgr',
      tag:   `tgr-accepted-${missionId}`,
    }).catch(() => {})

    // Email au partenaire
    const rows: [string, string][] = [
      ['Référence',     mission.reference],
      ['Véhicule',      `${mission.plate} — ${mission.brand} ${mission.model}`],
      ['État',          mission.is_rolling ? '🟢 Roulant' : '🔴 Non roulant'],
      ['Pick-up',       mission.pickup_address],
      ['Livraison',     mission.delivery_address],
    ]
    if (mission.distance_km) rows.push(['Distance', `${mission.distance_km} km`])
    rows.push(['Prise en charge', `<strong style="color:#4ade80;">${plannedLabel}</strong>`])
    if (odooQuoteName) rows.push(['Notre référence', `<strong style="color:white;">${odooQuoteName}</strong>`])
    if (odooError) rows.push(['⚠️ Référence', `<span style="color:#f87171;">Non générée — ${odooError}</span>`])
    // Montant estimé HTVA = distance × prix produit (récupéré depuis Odoo)
    if (mission.distance_km && odooEstimatedAmount) {
      rows.push(['Montant estimé HTVA', `<strong style="color:#4ade80;">${odooEstimatedAmount.toFixed(2)} €</strong>`])
    }

    const html = emailWrapper(
      '✅ Mission TGR acceptée',
      '#166534',
      rows,
      `<div style="margin-top:20px;padding:16px;background:#0F2415;border-radius:8px;border:1px solid #166534;">
        <p style="color:#86efac;font-size:13px;margin:0;">
          Votre mission a été acceptée par Verviers Dépannage. Nous prendrons en charge le véhicule le 
          <strong>${plannedLabel}</strong>.
        </p>
      </div>`
    )

    await sendMail({
      to:      mission.partner.email,
      subject: `✅ Mission TGR acceptée — ${mission.reference} — ${plannedLabel}`,
      html,
    }).catch(err => console.error('[TGR accept email]', err))

    return NextResponse.json({
      success:       true,
      odooQuoteName,
      odooError,
      plannedLabel,
    })
  }

  // ── REFUSER ───────────────────────────────────────────────
  if (action === 'refuse') {
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
      const takeUrl      = `${APP_URL}/services/tgr/take?missionId=${missionId}&token=${mission.take_token}`
      const priorityLabel = mission.priority === 1
        ? '🔴 Priorité 1 — Avant midi J+1 ouvrable'
        : mission.priority === 2
          ? '🟠 Priorité 2 — Dans la journée J+1 ouvrable'
          : '🟢 Priorité 3 — Dès que possible'

      const rows: [string, string][] = [
        ['Immatriculation', `<strong style="color:white;font-family:monospace;">${mission.plate}</strong>`],
        ['Véhicule',        `${mission.brand} ${mission.model}`],
        ['État',            mission.is_rolling ? '🟢 Roulant' : '🔴 Non roulant'],
        ['Pick-up',         mission.pickup_address],
        ['Livraison',       mission.delivery_address],
        ['Priorité',        priorityLabel],
      ]
      if (mission.remarks) rows.push(['Remarques', mission.remarks])

      const btnHtml = `
        <div style="margin-top:24px;text-align:center;">
          <a href="${takeUrl}"
             style="background:#CC2222;color:white;padding:14px 32px;border-radius:8px;
                    text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;">
            ✅ Je prends la mission
          </a>
          <p style="color:#555;font-size:11px;margin-top:12px;">
            Premier arrivé, premier servi. En répondant à ce mail vous contacterez directement le demandeur.
          </p>
        </div>`

      const html = emailWrapper('🚗 Mission TGR disponible', '#CC2222', rows, btnHtml)

      for (const partner of partners) {
        await sendMail({
          to:       partner.email,
          subject:  `🚗 Mission TGR disponible — ${mission.plate} — ${mission.brand} ${mission.model}`,
          html,
          replyTo:  mission.partner.email,
        }).catch(err => console.error(`[TGR refuse email ${partner.email}]`, err))
      }
    }

    // Mail 3b — informer le demandeur
    const priorityLabelDemandeur = mission.priority === 1
      ? '🔴 Priorité 1 — Avant midi J+1 ouvrable'
      : mission.priority === 2
        ? '🟠 Priorité 2 — Dans la journée J+1 ouvrable'
        : '🟢 Priorité 3 — Dès que possible'

    const rowsDemandeur: [string, string][] = [
      ['Référence',  `<span style="font-family:monospace;font-weight:bold;">${mission.reference}</span>`],
      ['Véhicule',   `${mission.plate} — ${mission.brand} ${mission.model}`],
      ['Pick-up',    mission.pickup_address],
      ['Livraison',  mission.delivery_address],
      ['Priorité',   priorityLabelDemandeur],
    ]

    const htmlDemandeur = emailWrapper(
      '❌ Mission TGR — Réponse à votre demande',
      '#7f1d1d',
      rowsDemandeur,
      `<div style="margin-top:20px;padding:16px;background:#1c0a0a;border-radius:8px;border:1px solid #7f1d1d;">
        <p style="color:#fca5a5;font-size:14px;margin:0 0 10px;font-weight:bold;">
          Nous sommes désolés, nous ne pouvons pas assurer une livraison dans les délais indiqués.
        </p>
        <p style="color:#fca5a5;font-size:14px;margin:0;">
          Votre demande a été transmise aux autres partenaires TGR, vous serez contacté dès qu'un partenaire l'accepte.
        </p>
      </div>`
    )

    await sendMail({
      to:      mission.partner.email,
      subject: `❌ Mission TGR — Réponse à votre demande — ${mission.reference}`,
      html:    htmlDemandeur,
    }).catch(err => console.error('[TGR refuse demandeur email]', err))

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}

// ── GET : redirect vers page prise de mission ──────────────
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(`${APP_URL}?error=token_missing`)

  const supabase = createAdminClient()
  const { data: mission } = await supabase
    .from('tgr_missions')
    .select('status, take_token')
    .eq('id', params.id)
    .eq('take_token', token)
    .single()

  if (!mission) return NextResponse.redirect(`${APP_URL}?error=mission_not_found`)
  if (mission.status !== 'refused') {
    return NextResponse.redirect(`${APP_URL}/services/tgr?info=already_taken`)
  }

  return NextResponse.redirect(
    `${APP_URL}/services/tgr/take?missionId=${params.id}&token=${token}`
  )
}
