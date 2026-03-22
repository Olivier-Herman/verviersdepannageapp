import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { syncInterventionToOdoo } from '@/lib/odoo'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { interventionId } = await req.json()
  if (!interventionId) return NextResponse.json({ error: 'interventionId manquant' }, { status: 400 })

  const supabase = createAdminClient()

  // Charger l'intervention complète
  const { data: intervention, error } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', interventionId)
    .single()

  if (error || !intervention) {
    return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })
  }

  if (intervention.synced_to_odoo) {
    return NextResponse.json({
      message: 'Déjà synchronisé',
      odoo_order_id: intervention.odoo_invoice_id,
    })
  }

  if (!intervention.plate) {
    return NextResponse.json({ error: 'Immatriculation manquante' }, { status: 400 })
  }

  try {
    const result = await syncInterventionToOdoo({
      reference: intervention.reference,
      plate: intervention.plate,
      brandText: intervention.brand_text || 'Autre',
      modelText: intervention.model_text || 'Autre',
      vinSn: intervention.vin || undefined,
      clientName: intervention.client_name || undefined,
      clientPhone: intervention.client_phone || undefined,
      clientEmail: intervention.client_email || undefined,
      clientVat: intervention.client_vat || undefined,
      clientAddress: intervention.client_address || undefined,
      amount: parseFloat(intervention.amount || '0'),
      motifText: intervention.motif_text || intervention.motif_id || 'Intervention',
      paymentMode: intervention.payment_mode || undefined,
    })

    // Mettre à jour Supabase
    await supabase
      .from('interventions')
      .update({
        odoo_invoice_id: result.orderId,
        odoo_partner_id: result.partnerId,
        synced_to_odoo: true,
        synced_at: new Date().toISOString(),
      })
      .eq('id', interventionId)

    return NextResponse.json({
      success: true,
      odoo_order_id: result.orderId,
      odoo_order_name: result.orderName,
      odoo_vehicle_id: result.vehicleId,
      odoo_partner_id: result.partnerId,
    })

  } catch (err: any) {
    console.error('[Odoo sync error]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
