import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { createAdminClient } from '@/lib/supabase'
import { upsertPartner, createInvoice } from '@/lib/odoo'

// POST /api/odoo/sync-intervention — synchronise une intervention vers Odoo
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { interventionId } = await req.json()
  if (!interventionId) return NextResponse.json({ error: 'interventionId manquant' }, { status: 400 })

  const supabase = createAdminClient()

  // Charger l'intervention
  const { data: intervention, error } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', interventionId)
    .single()

  if (error || !intervention) {
    return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })
  }

  if (intervention.synced_to_odoo) {
    return NextResponse.json({ message: 'Déjà synchronisé', odoo_invoice_id: intervention.odoo_invoice_id })
  }

  try {
    // 1. Créer/récupérer le partenaire Odoo
    const partnerId = await upsertPartner({
      name: intervention.client_name || 'Client inconnu',
      vat: intervention.client_vat || undefined,
      street: intervention.client_address || undefined,
      phone: intervention.client_phone || undefined,
      email: intervention.client_email || undefined
    })

    // 2. Créer la facture Odoo
    const invoiceId = await createInvoice({
      partnerId,
      amount: intervention.amount || 0,
      description: `${intervention.motif_text || intervention.motif_id} — ${intervention.plate || 'Véhicule inconnu'} (${intervention.location_address || ''})`,
      reference: intervention.reference,
      paymentMode: intervention.payment_mode || undefined
    })

    // 3. Mettre à jour Supabase
    await supabase
      .from('interventions')
      .update({
        odoo_invoice_id: invoiceId,
        odoo_partner_id: partnerId,
        synced_to_odoo: true,
        synced_at: new Date().toISOString()
      })
      .eq('id', interventionId)

    return NextResponse.json({ success: true, odoo_invoice_id: invoiceId, odoo_partner_id: partnerId })

  } catch (err: any) {
    console.error('Odoo sync error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
