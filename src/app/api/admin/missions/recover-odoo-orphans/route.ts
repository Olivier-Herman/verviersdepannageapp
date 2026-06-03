// src/app/api/admin/missions/recover-odoo-orphans/route.ts
//
// POST /api/admin/missions/recover-odoo-orphans?hours=4
// Recupere les missions Odoo helpdesk creees recemment qui n ont PAS de
// mission VD Soft correspondante (cas du bug 03/06 ou /api/towsoft/create
// creait le ticket Odoo + email mais l INSERT VD Soft echouait silencieusement).
//
// Pour chaque ticket orphelin, recreer la mission VD Soft complete a partir
// des donnees Odoo helpdesk (plaque, marque, modele, motif, date, lieu,
// police, chauffeur).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }          from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Equipe Helpdesk Odoo "Mission Créée par Chauffeur" (team_id=12, vu dans
// les tickets helpdesk de Matthieu 03/06). Filtre pour ne traiter QUE les
// tickets crees par l app, pas les missions standards.
const HELPDESK_TEAM_ID = 12

// Mapping tag Odoo (motif) -> source/zone VD Soft.
const MOTIF_TO_SOURCE: Record<string, { source: string; zoneKey: string; missionType: string }> = {
  'accident':           { source: 'police_accident', zoneKey: 'K3',  missionType: 'remorquage' },
  'mal garée':          { source: 'police_mg',       zoneKey: 'L',   missionType: 'remorquage' },
  'mal garee':          { source: 'police_mg',       zoneKey: 'L',   missionType: 'remorquage' },
  'saisie':             { source: 'police_saisie',   zoneKey: 'J',   missionType: 'remorquage' },
  'saisie judiciaire':  { source: 'police_saisie',   zoneKey: 'J',   missionType: 'remorquage' },
  'rodéo':              { source: 'police_rodeo',    zoneKey: 'J',   missionType: 'remorquage' },
  'rodeo':              { source: 'police_rodeo',    zoneKey: 'J',   missionType: 'remorquage' },
  'avp':                { source: 'police_avp',      zoneKey: 'J',   missionType: 'remorquage' },
  'abandon':            { source: 'police_avp',      zoneKey: 'J',   missionType: 'remorquage' },
  'siabis non couvert': { source: 'police_snc',      zoneKey: 'K2',  missionType: 'remorquage' },
  'appel privé':        { source: 'prive',           zoneKey: 'K3',  missionType: 'remorquage' },
  'appel prive':        { source: 'prive',           zoneKey: 'K3',  missionType: 'remorquage' },
}

interface Recovery {
  ticket_id:    number
  plate:        string | null
  motif:        string | null
  ok:           boolean
  mission_id?:  string
  reason?:      string
}

function inferFromMotif(motif: string | null): { source: string; zoneKey: string; missionType: string } | null {
  if (!motif) return null
  const k = motif.toLowerCase().trim()
  // Match exact d abord
  if (MOTIF_TO_SOURCE[k]) return MOTIF_TO_SOURCE[k]
  // Match partiel ensuite
  for (const [pattern, mapping] of Object.entries(MOTIF_TO_SOURCE)) {
    if (k.includes(pattern)) return mapping
  }
  return null
}

/** Parse l adresse intervention depuis la description HTML du ticket Helpdesk. */
function extractFromDescription(html: string, label: string): string | null {
  if (!html) return null
  // Pattern : "<td>Label</td>...<td>VALUE</td>"
  const re = new RegExp(`>\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*<\\/td>[^<]*<td[^>]*>\\s*([^<]+?)\\s*<`, 'i')
  const m = html.match(re)
  return m ? m[1].trim() : null
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const hours = Math.min(parseInt(url.searchParams.get('hours') || '4', 10), 48)

  const sb = createAdminClient()

  // 1. Fetch les tickets Helpdesk recents de l equipe "Mission Créée par Chauffeur"
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
    [
      ['team_id', '=', HELPDESK_TEAM_ID],
      ['create_date', '>=', sinceIso],
    ],
  ], {
    fields: ['id', 'name', 'description', 'tag_ids', 'create_date',
             'x_studio_fiche_vehicule', 'x_studio_date_dentree',
             'x_studio_mission_towsoft', 'x_studio_id_supabase'],
    limit:  200,
  })

  if (!tickets || tickets.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Aucun ticket recent dans la team' })
  }

  // 2. Filtre ceux qui ont DEJA une mission VD Soft (via odoo_helpdesk_id OU
  // via x_studio_id_supabase si renseigne)
  const ticketIds = tickets.map(t => t.id)
  const supabaseIds = tickets
    .map(t => t.x_studio_id_supabase && t.x_studio_id_supabase !== false ? String(t.x_studio_id_supabase) : null)
    .filter(Boolean) as string[]

  const { data: existingByTicket } = await sb
    .from('incoming_missions')
    .select('odoo_helpdesk_id')
    .in('odoo_helpdesk_id', ticketIds)
  const existingTicketIds = new Set((existingByTicket || []).map(m => m.odoo_helpdesk_id))

  let existingSupabaseIds = new Set<string>()
  if (supabaseIds.length > 0) {
    const { data: existingByUuid } = await sb
      .from('incoming_missions')
      .select('id')
      .in('id', supabaseIds)
    existingSupabaseIds = new Set((existingByUuid || []).map(m => m.id))
  }

  const orphans = tickets.filter(t => {
    if (existingTicketIds.has(t.id)) return false
    if (t.x_studio_id_supabase && t.x_studio_id_supabase !== false && existingSupabaseIds.has(String(t.x_studio_id_supabase))) return false
    return true
  })

  if (orphans.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Pas d orphelin trouve' })
  }

  // 3. Resolve les tags (motif)
  const allTagIds = Array.from(new Set(orphans.flatMap(t => t.tag_ids || []))) as number[]
  const tagMap = new Map<number, string>()
  if (allTagIds.length > 0) {
    const tags = await odooRpc<any[]>('helpdesk.tag', 'read', [allTagIds], { fields: ['name'] })
    for (const tag of (tags || [])) tagMap.set(tag.id, tag.name)
  }

  // 4. Resolve les vehicules (fleet.vehicle)
  const fleetIds = orphans
    .map(t => Array.isArray(t.x_studio_fiche_vehicule) ? t.x_studio_fiche_vehicule[0] : t.x_studio_fiche_vehicule)
    .filter((x: any) => typeof x === 'number') as number[]
  const fleetMap = new Map<number, { plate: string; vin: string; brand: string; model: string }>()
  if (fleetIds.length > 0) {
    const fleets = await odooRpc<any[]>('fleet.vehicle', 'read', [fleetIds], {
      fields: ['id', 'license_plate', 'vin_sn', 'model_id'],
    })
    for (const f of (fleets || [])) {
      const modelName = Array.isArray(f.model_id) ? f.model_id[1] : ''
      const parts = String(modelName).split(/[\s\/]+/)
      fleetMap.set(f.id, {
        plate: f.license_plate || '',
        vin:   f.vin_sn || '',
        brand: parts[0] || '',
        model: parts.slice(1).join(' ') || '',
      })
    }
  }

  // 5. Pour chaque orphelin, crée la mission VD Soft
  const results: Recovery[] = []
  for (const t of orphans) {
    const motif = (t.tag_ids || []).map((id: number) => tagMap.get(id)).filter(Boolean).join(', ') || null
    const mapping = inferFromMotif(motif)

    const fleetId = Array.isArray(t.x_studio_fiche_vehicule) ? t.x_studio_fiche_vehicule[0] : t.x_studio_fiche_vehicule
    const fleet = typeof fleetId === 'number' ? fleetMap.get(fleetId) : null
    const plate = fleet?.plate || null

    // Extract from HTML description
    const desc = String(t.description || '')
    const incidentAddr = extractFromDescription(desc, 'Lieu')
    const policeZone   = extractFromDescription(desc, 'Zone de police')
    const officer      = extractFromDescription(desc, 'Policier')
    const driverName   = extractFromDescription(desc, 'Chauffeur')

    // Date intervention
    let interventionISO: string | null = null
    if (t.x_studio_date_dentree && t.create_date) {
      const dateOnly = String(t.x_studio_date_dentree).slice(0, 10)
      const timeOnly = String(t.create_date).slice(11, 19) || '12:00:00'
      interventionISO = `${dateOnly}T${timeOnly}.000Z`
    } else if (t.create_date) {
      interventionISO = String(t.create_date).replace(' ', 'T') + '.000Z'
    }

    // Resolve assigned_to par driver name si possible
    let assignedTo: string | null = null
    if (driverName) {
      const { data: driverUser } = await sb
        .from('users')
        .select('id')
        .or(`name.ilike.%${driverName}%,towsoft_name.ilike.%${driverName}%`)
        .limit(1)
        .maybeSingle()
      assignedTo = driverUser?.id || null
    }

    // INSERT
    const payload: Record<string, any> = {
      external_id:       `RECOVERED-${t.id}`,
      source:            mapping?.source || 'legacy_odoo',
      mission_type:      mapping?.missionType || 'remorquage',
      status:            'parked',
      parc_zone_key:     mapping?.zoneKey || 'A',  // fallback
      vehicle_plate:     plate ? String(plate).replace(/[-.\s]/g, '').toUpperCase() : null,
      vehicle_brand:     fleet?.brand || null,
      vehicle_model:     fleet?.model || null,
      vehicle_vin:       fleet?.vin || null,
      incident_address:  incidentAddr || null,
      police_zone:       policeZone || null,
      officer_name:      officer || null,
      saisie_motif_code: mapping?.source === 'police_saisie' ? 'saisie' : null,
      saisie_motif_label: mapping?.source === 'police_saisie' ? 'Saisie' : null,
      intervention_date: interventionISO,
      received_at:       interventionISO || new Date().toISOString(),
      parked_at:         interventionISO || new Date().toISOString(),
      assigned_to:       assignedTo,
      assigned_at:       interventionISO || new Date().toISOString(),
      odoo_helpdesk_id:  t.id,
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    }

    const { data: created, error: insertErr } = await sb
      .from('incoming_missions')
      .insert(payload)
      .select('id, mission_number')
      .single()

    if (insertErr) {
      results.push({ ticket_id: t.id, plate, motif, ok: false, reason: insertErr.message })
    } else {
      results.push({ ticket_id: t.id, plate, motif, ok: true, mission_id: created?.id })
      // Lier l UUID Supabase au ticket Odoo pour la prochaine fois
      try {
        await odooRpc('helpdesk.ticket', 'write', [[t.id], {
          x_studio_id_supabase: created.id,
        }])
      } catch {}
    }
  }

  const ok = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return NextResponse.json({
    ok: true,
    processed: orphans.length,
    recovered: ok,
    failed,
    results,
  })
}
