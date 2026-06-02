// src/app/facturation/page.tsx
//
// Page Facturation — liste des missions terminees par chauffeur en attente
// de validation (statut to_invoice). L'employe facturation valide chaque fiche
// avec un numero de facture Odoo ou marque "auto-facturation" (compagnie qui
// valide elle-meme).

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import FacturationClient     from './FacturationClient'

export const dynamic = 'force-dynamic'

export default async function FacturationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const modules: string[] = user.modules || []
  const role: string      = user.role || ''
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()

  // Missions a facturer (chauffeur a cloture, en attente employe)
  const { data: missions } = await supabase
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id, dossier_number, source, status,
      mission_type, incident_type, parent_mission_id,
      client_name, client_phone,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      incident_address, destination_address,
      received_at, intervention_date, completed_at,
      amount_to_collect, amount_collected, payment_method,
      special_tarif_htva,
      assigned_to,
      invoice_method, invoice_number, invoice_url,
      no_charge_at, no_charge_reason,
      odoo_quote_id, odoo_quote_url, odoo_quoted_at,
      billed_to_id, billed_to_name
    `)
    .eq('status', 'to_invoice')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('received_at', { ascending: false })
    .limit(200)

  // Pre-charger les fiches "voisines" pour les chaines REM+REL :
  // pour chaque mission to_invoice, on peut avoir un parent OU un enfant
  // qui est aussi a facturer (cas Touring). On les pousse dans le dataset.
  const allIds = new Set((missions || []).map(m => m.id))
  const parentIds = (missions || [])
    .map(m => m.parent_mission_id)
    .filter((x): x is string => !!x && !allIds.has(x))

  let siblings: any[] = []
  if (parentIds.length > 0 || allIds.size > 0) {
    const { data: extra } = await supabase
      .from('incoming_missions')
      .select(`
        id, external_id, dossier_number, source, status,
        mission_type, incident_type, parent_mission_id,
        client_name, vehicle_plate,
        received_at, completed_at,
        invoice_method, invoice_number,
        no_charge_at, no_charge_reason,
        odoo_quote_id, odoo_quote_url,
        billed_to_id, billed_to_name
      `)
      .or(
        [
          parentIds.length > 0 ? `id.in.(${parentIds.join(',')})` : '',
          allIds.size > 0      ? `parent_mission_id.in.(${[...allIds].join(',')})` : '',
        ].filter(Boolean).join(',')
      )
    siblings = extra || []
  }

  // Encaissements lies (warning "deja paye en DPR")
  const { data: payments } = allIds.size > 0
    ? await supabase
        .from('interventions')
        .select('id, mission_id, amount, payment_mode, client_name, created_at, driver_id')
        .in('mission_id', [...allIds])
    : { data: [] }

  // Resolve driver names des encaissements
  const driverIds = [...new Set((payments || []).map(p => p.driver_id).filter(Boolean))] as string[]
  const { data: drivers } = driverIds.length > 0
    ? await supabase.from('users').select('id, name').in('id', driverIds)
    : { data: [] }

  // Olivier 2026-06-01 : avances de fonds liees aux missions a facturer.
  // Permet de surligner les cartes qui demandent une attention particuliere
  // (la ligne sera ajoutee automatiquement au devis avec le PDF de la facture).
  const { data: advances } = allIds.size > 0
    ? await supabase
        .from('fund_advances')
        .select('id, mission_id, amount_htva, plate, invoice_url')
        .in('mission_id', [...allIds])
    : { data: [] }

  return (
    <FacturationClient
      missions={missions || []}
      siblings={siblings}
      payments={payments || []}
      drivers={drivers || []}
      advances={advances || []}
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
