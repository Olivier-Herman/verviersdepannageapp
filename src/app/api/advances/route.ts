// src/app/api/advances/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { addAdvanceToQuote }         from '@/lib/odoo'
import { sendAdvancePurchaseEmail }  from '@/lib/emails'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  try {
    const body = await req.json()
    const { plate, amountHtva, paymentMethod, invoiceUrl, notes, brandName, modelName } = body

    if (!plate || !amountHtva || !paymentMethod || !invoiceUrl) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
    }

    const supabase        = createAdminClient()
    const normalizedPlate = plate.replace(/[-.\s]/g, '').toUpperCase().trim()
    const htva            = parseFloat(amountHtva)

    // Résoudre l'id utilisateur depuis l'email de session
    const { data: me } = await supabase
      .from('users').select('id').eq('email', session.user.email).single()
    if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    // ── Retrouver le devis via la plaque ──────────────────
    let odooQuoteId:   number | null = null
    let odooLineId:    number | null = null
    let odooVehicleSet               = false

    const { data: vehicle } = await supabase
      .from('vehicles').select('id').eq('plate', normalizedPlate).single()

    if (vehicle) {
      const { data: intervention } = await supabase
        .from('interventions')
        .select('odoo_quote_id')
        .eq('vehicle_id', vehicle.id)
        .not('odoo_quote_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (intervention?.odoo_quote_id) {
        odooQuoteId = intervention.odoo_quote_id
        try {
          const result   = await addAdvanceToQuote(odooQuoteId!, normalizedPlate, htva)
          odooLineId     = result.lineId
          odooVehicleSet = result.vehicleSet
        } catch (odooErr) {
          console.error('[Odoo] addAdvanceToQuote:', odooErr)
        }
      }
    }

    // ── Email vers boîte achat ────────────────────────────
    const { data: setting } = await supabase
      .from('app_settings').select('value').eq('key', 'odoo_purchase_email').single()

    let purchaseEmailSent = false
    if (setting?.value) {
      const purchaseEmail = JSON.parse(setting.value) as string
      try {
        await sendAdvancePurchaseEmail({
          to:            purchaseEmail,
          plate:         normalizedPlate,
          amountHtva:    htva,
          paymentMethod: paymentMethod as string,
          invoiceUrl:    invoiceUrl as string,
          employeeName:  session.user.name ?? session.user.email ?? 'Employé',
        })
        purchaseEmailSent = true
      } catch (mailErr) {
        console.error('[Email] sendAdvancePurchaseEmail:', mailErr)
      }
    }

    // ── Sauvegarde ────────────────────────────────────────
    const { data: advance, error: insertError } = await supabase
      .from('fund_advances')
      .insert({
        user_id:             me.id,
        plate:               normalizedPlate,
        amount_htva:         htva,
        payment_method:      paymentMethod,
        invoice_url:         invoiceUrl,
        odoo_quote_id:       odooQuoteId,
        odoo_line_id:        odooLineId,
        odoo_vehicle_set:    odooVehicleSet,
        purchase_email_sent: purchaseEmailSent,
        notes:               notes ?? null,
        status:              odooLineId ? 'synced' : 'pending',
      })
      .select().single()

    if (insertError) throw insertError
    return NextResponse.json({ success: true, advance })

  } catch (err: unknown) {
    console.error('[POST /api/advances]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { searchParams } = new URL(req.url)
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '20'), 100)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'),  0)

  const { data: me } = await supabase
    .from('users').select('id, role').eq('email', session.user.email).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  let query = supabase
    .from('fund_advances')
    .select('*, users(name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (!['admin', 'superadmin'].includes(me.role)) {
    query = query.eq('user_id', me.id)
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  return NextResponse.json({ advances: data, total: count })
}
