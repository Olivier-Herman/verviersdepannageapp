// src/app/api/advances/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { findOrCreateVehicle, createAdvanceOrder, attachFileToOrder } from '@/lib/odoo'
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

    // Résoudre l'utilisateur
    const { data: me } = await supabase
      .from('users').select('id, name').eq('email', session.user.email).single()
    if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

    // ── Créer véhicule dans Odoo si nécessaire ────────────
    try {
      await findOrCreateVehicle({
        licensePlate: normalizedPlate,
        brandName:    brandName || 'Inconnu',
        modelName:    modelName || 'Inconnu',
      })
    } catch (vErr) {
      console.error('[Odoo] findOrCreateVehicle:', vErr)
    }

    // ── Créer devis brouillon Odoo ────────────────────────
    let odooOrderId:   number | null = null
    let odooOrderName: string | null = null
    let odooVehicleSet               = false

    try {
      const result   = await createAdvanceOrder(normalizedPlate, htva)
      odooOrderId    = result.orderId
      odooOrderName  = result.orderName
      odooVehicleSet = result.vehicleSet
    } catch (odooErr) {
      console.error('[Odoo] createAdvanceOrder:', odooErr)
    }

    // ── Attacher la facture dans le chatter du devis ──────
    if (odooOrderId) {
      try {
        // Télécharger le fichier depuis Supabase Storage
        const fileRes = await fetch(invoiceUrl)
        if (fileRes.ok) {
          const fileBuffer  = await fileRes.arrayBuffer()
          const base64Data  = Buffer.from(fileBuffer).toString('base64')
          const contentType = fileRes.headers.get('content-type') ?? 'image/jpeg'
          const filename    = `facture-avance-${normalizedPlate}-${Date.now()}.jpg`
          await attachFileToOrder(odooOrderId, base64Data, filename, contentType)
        }
      } catch (attachErr) {
        console.error('[Odoo] attachFileToOrder:', attachErr)
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
          paymentMethod,
          invoiceUrl,
          employeeName:  session.user.name ?? me.name ?? 'Employé',
          orderName:     odooOrderName ?? undefined,
        })
        purchaseEmailSent = true
      } catch (mailErr) {
        console.error('[Email] sendAdvancePurchaseEmail:', mailErr)
      }
    }

    // ── Mouvement caisse si espèces ───────────────────────
    if (paymentMethod === 'cash') {
      try {
        await supabase.from('cash_register').insert({
          driver_id: me.id,
          amount:    htva,
          type:      'remise',
          notes:     `Avance de fonds — ${normalizedPlate}${odooOrderName ? ` — ${odooOrderName}` : ''}`,
        })
      } catch (cashErr) {
        console.error('[Caisse] cash_register insert:', cashErr)
      }
    }

    // ── Sauvegarde Supabase ───────────────────────────────
    const { data: advance, error: insertError } = await supabase
      .from('fund_advances')
      .insert({
        user_id:             me.id,
        plate:               normalizedPlate,
        amount_htva:         htva,
        payment_method:      paymentMethod,
        invoice_url:         invoiceUrl,
        odoo_quote_id:       odooOrderId,
        odoo_line_id:        null,
        odoo_vehicle_set:    odooVehicleSet,
        purchase_email_sent: purchaseEmailSent,
        notes:               notes ?? null,
        status:              odooOrderId ? 'synced' : 'pending',
      })
      .select().single()

    if (insertError) throw insertError

    return NextResponse.json({ success: true, advance, orderName: odooOrderName })

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
