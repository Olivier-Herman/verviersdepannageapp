// src/app/api/admin/towsoft-migration/print-zone/route.ts
//
// POST /api/admin/towsoft-migration/print-zone
// Body: { zone: string, only_unprinted?: boolean }
//
// Olivier 2026-06-04 : impression batch des etiquettes parc pour toutes les
// missions VD Soft creees a partir des fiches scannees dans une zone donnee.
//
// Utile en fin de zone : l operateur clique "Imprimer toutes les etiquettes
// de la zone X" -> impression sequentielle (PC zebra fait la queue).
//
// only_unprinted = true (defaut) : skip missions ou label_printed_at IS NOT NULL
// only_unprinted = false : reimprime tout (utile si imprimante a fait des bourrages)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { printVdSoftParcLabel } from '@/lib/missions/print-parc-label'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Body {
  zone:           string
  only_unprinted?: boolean
}

// Mapping source -> motif lisible sur l etiquette (col droite)
function sourceToMotif(source: string): string {
  switch (source) {
    case 'police_mg':       return 'MAL GAREE'
    case 'police_accident': return 'ACCIDENT'
    case 'police_saisie':   return 'SAISIE'
    case 'police_rodeo':    return 'RODEO'
    case 'police_avp':      return 'AVP'
    case 'police_snc':      return 'SIABIS NON COUVERT'
    case 'sia_couvert':     return 'SIABIS COUVERT'
    case 'prive':           return 'APPEL PRIVE'
    case 'legacy_towsoft_migration': return 'LEGACY TOWSOFT'
    default: return source.replace(/_/g, ' ').toUpperCase()
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as Body
  const zone = String(body.zone || '').trim()
  const onlyUnprinted = body.only_unprinted !== false  // defaut true

  if (!zone) return NextResponse.json({ error: 'zone requise' }, { status: 400 })

  const sb = createAdminClient()

  // Charge missions importees liees a cette zone (via towsoft_migration_source)
  let query = sb
    .from('incoming_missions')
    .select('id, mission_number, source, intervention_date, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, odoo_helpdesk_id, label_printed_at')
    .eq('parc_zone_key', zone)
    .not('external_id', 'is', null)
    .like('external_id', 'TS-%')

  if (onlyUnprinted) {
    query = query.is('label_printed_at', null)
  }

  const { data: missions, error: selErr } = await query.limit(500)

  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 })
  if (!missions || missions.length === 0) {
    return NextResponse.json({
      ok: true,
      printed: 0,
      message: onlyUnprinted
        ? `Aucune etiquette a imprimer en zone ${zone} (toutes deja imprimees).`
        : `Aucune mission TowSoft migree en zone ${zone}.`,
    })
  }

  let printed = 0
  let failed  = 0
  const errors: Array<{ mission_id: string; error: string }> = []

  // Sequentiel pour ne pas saturer le PC Zebra (queue server-side)
  for (const m of missions) {
    try {
      const res = await printVdSoftParcLabel({
        missionId:        m.id,
        missionNumber:    m.mission_number,
        odooTicketId:     m.odoo_helpdesk_id,
        source:           m.source,
        motif:            sourceToMotif(m.source),
        interventionDate: m.intervention_date || new Date().toISOString(),
        plate:            m.vehicle_plate,
        brand:            m.vehicle_brand,
        model:            m.vehicle_model,
        vin:              m.vehicle_vin,
        // Pas de noteOverride ni isAvp ni redeliveryAddr : migration legacy = note vide
      })
      if (res.ok) {
        await sb.from('incoming_missions')
          .update({ label_printed_at: new Date().toISOString() })
          .eq('id', m.id)
        printed++
      } else {
        failed++
        errors.push({ mission_id: m.id, error: res.error || 'unknown' })
      }
    } catch (e: any) {
      failed++
      errors.push({ mission_id: m.id, error: e?.message || 'exception' })
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    zone,
    total:   missions.length,
    printed,
    failed,
    errors:  errors.slice(0, 10),
    message: `${printed}/${missions.length} etiquettes imprimees pour zone ${zone}`,
  })
}
