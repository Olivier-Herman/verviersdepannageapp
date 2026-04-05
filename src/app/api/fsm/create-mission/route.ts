// src/app/api/fsm/create-mission/route.ts
// Crée le ticket Helpdesk + FSM Task dans Odoo lors de la validation dispatch

import { NextResponse }       from 'next/server'
import { createClient }       from '@supabase/supabase-js'
import { createHelpdeskTicket, createFsmTask, findOrCreateFsmPartner, findOrCreateFsmVehicle } from '@/lib/odoo-fsm'

export const dynamic = 'force-dynamic'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      mission_id, supabase_id, dossier_number, source,
      client_name, client_phone, vehicle_plate, vehicle_brand, vehicle_model,
      incident_address, incident_city, destination_address, destination_name,
      description, chauffeur_id,
    } = body

    if (!mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

    const sb = adminClient()

    const HELPDESK_TEAM_ID = 12 // Interventions Verviers Dépannage

    // Récupérer la mission depuis Supabase pour avoir le type correct
    const { data: mission } = await sb.from('incoming_missions')
      .select('mission_type')
      .eq('id', mission_id)
      .maybeSingle()

    // Mapper le type d'intervention
    const missionType = (mission?.mission_type || '').toUpperCase()
    let interventionType = 'DSP'
    if (['REMORQUAGE', 'REM'].some(t => missionType.includes(t))) interventionType = 'REM_DIRECT'
    if (['DPR', 'DEPLACE'].some(t => missionType.includes(t))) interventionType = 'DPR'
    if (['REL', 'RELIVR'].some(t => missionType.includes(t))) interventionType = 'REL'

    // Récupérer le chauffeur si assigné
    let chauffeurName = ''
    if (chauffeur_id) {
      const { data: driver } = await sb.from('users').select('name').eq('id', chauffeur_id).maybeSingle()
      chauffeurName = driver?.name || ''
    }

    // Chercher ou créer le contact Odoo
    let partnerId: number | undefined
    try {
      partnerId = await findOrCreateFsmPartner({
        name:  client_name,
        phone: client_phone,
      })
    } catch (e) {
      console.warn('[FSM] Partner creation failed, continuing without:', e)
    }

    // Créer le ticket Helpdesk (dossier chapeau)
    const { ticketId, ticketUrl } = await createHelpdeskTicket({
      supabaseId:    supabase_id || mission_id,
      dossierNumber: dossier_number || '',
      source:        source || 'PRIVÉ',
      clientName:    client_name || 'Client inconnu',
      partnerId,
      description:   description || '',
      teamId:        12,
      vehiclePlate:  vehicle_plate || '',
      city:          incident_city || '',
    })

    // Chercher ou créer le véhicule dans Parc Auto
    let vehicleId: number | undefined
    if (vehicle_plate) {
      const vId = await findOrCreateFsmVehicle({
        licensePlate: vehicle_plate,
        brandName:    vehicle_brand || '',
        modelName:    vehicle_model || '',
      })
      if (vId) vehicleId = vId
    }

    // Créer la FSM Task liée au ticket
    const incidentFull = [incident_address, incident_city].filter(Boolean).join(', ')
    const { taskId, taskUrl } = await createFsmTask({
      supabaseId:          supabase_id || mission_id,
      helpdeskTicketId:    ticketId,
      interventionType:    interventionType,
      interventionContext: 'STANDARD',
      source:              source?.toUpperCase() || 'PRIVÉ',
      dossierNumber:       dossier_number || '',
      chauffeurName,
      chauffeurSupabaseId: chauffeur_id || '',
      vehicleId,
      clientName:          client_name || 'Client inconnu',
      partnerId,
      vehicleInfo:         [vehicle_plate, vehicle_brand, vehicle_model].filter(Boolean).join(' '),
      incidentAddress:     incidentFull,
      destinationAddress:  destination_address || '',
      description,
    })

    // Sauvegarder les IDs Odoo dans Supabase
    await sb.from('incoming_missions').update({
      odoo_helpdesk_id: ticketId,
      odoo_task_id:     taskId,
      odoo_ticket_url:  ticketUrl,
      odoo_task_url:    taskUrl,
    }).eq('id', mission_id)

    console.log(`[FSM] Dossier créé: ticket #${ticketId}, task #${taskId}`)
    return NextResponse.json({ ok: true, ticketId, ticketUrl, taskId, taskUrl })

  } catch (err: any) {
    console.error('[FSM] Erreur create-mission:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
