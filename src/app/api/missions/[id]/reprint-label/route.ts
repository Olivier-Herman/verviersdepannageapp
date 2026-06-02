// src/app/api/missions/[id]/reprint-label/route.ts
//
// POST /api/missions/[id]/reprint-label
//
// Reimprime l etiquette parc d une mission existante (Olivier 2026-05-27).
// Utilise par le bouton "🖨 Imprimer etiquette" sur la fiche dispatch.
//
// Compose le ZPL via le template VD Soft (buildParcLabelZPL) avec les vraies
// donnees de la mission, puis envoie au PC Zebra via printZPLRaw.
//
// Acces : admin / superadmin OU module fourriere active (Olivier 2026-05-28 :
// le dispatcher seul n a pas le droit, il faut avoir le module fourriere).

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { printVdSoftParcLabel }    from '@/lib/missions/print-parc-label'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const roles:   string[] = Array.isArray(user.roles)   ? user.roles   : [user.role].filter(Boolean)
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isAdmin       = roles.some(r => ['admin', 'superadmin'].includes(r))
  const hasFourriere  = modules.includes('fourriere')
  if (!isAdmin && !hasFourriere) {
    return NextResponse.json({ error: 'Forbidden — module fourriere requis' }, { status: 403 })
  }

  // Accepte UUID OR mission_number numerique (Olivier 2026-05-27).
  const idIsNumeric = /^\d+$/.test(params.id)
  const sb = createAdminClient()
  const baseQuery = sb
    .from('incoming_missions')
    .select(`
      id, mission_number, source, mission_type, intervention_date, received_at,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      destination_address, redelivery_address, snc_scenario,
      saisie_motif_code, saisie_motif_label,
      police_blocked, police_zone, officer_name,
      odoo_ticket_id
    `)
  const { data: mission, error } = idIsNumeric
    ? await baseQuery.eq('mission_number', Number(params.id)).maybeSingle()
    : await baseQuery.eq('id', params.id).maybeSingle()

  if (error || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  // Mapping source -> motif label affiche sur l etiquette
  const MOTIF_LABELS: Record<string, string> = {
    'police_mg':       'MAL GAREE',
    'police_rodeo':    'RODEO',
    'police_avp':      'AVP',
    'police_accident': 'ACCIDENT',
    'police_saisie':   'SAISIE',
    'police_snc':      'SIABIS NON COUVERT',
    'sia_couvert':     'SIABIS COUVERT',
    'prive':           'APPEL PRIVE',
  }
  // Olivier 2026-06-01 (demande Franck) : pour Police-Saisie, on remplace le
  // mot "SAISIE" par le motif specifique choisi a la creation (defaut assurance,
  // alcool, etc.). Si pas de motif (anciennes missions ou champ vide), fallback
  // sur "SAISIE".
  let motif = MOTIF_LABELS[mission.source] || String(mission.source || '').toUpperCase()
  if (mission.source === 'police_saisie' && (mission as any).saisie_motif_label) {
    motif = String((mission as any).saisie_motif_label).toUpperCase()
  }

  // Olivier 2026-06-01 : detection elargie de la relivraison.
  // Une mission est "a relivrer" si :
  //   - source = prive / police_snc rem_depot / sia_couvert (cas historiques)
  //   - OU mission_type contient REL (REM+REL ou REL) — cas converti via
  //     "Gerer la mise en parc" sur des sources comme police_accident
  // Dans tous ces cas, le motif etiquette devient "RELIVRAISON" pour signaler
  // au chauffeur qui imprime que ce vehicule est en attente de relivraison
  // (peu importe la source d origine).
  const mtNorm = String(mission.mission_type || '').toUpperCase()
  const isRemRelType = mtNorm.includes('REL')
  const isRedelivery =
    isRemRelType ||
    (mission.source === 'prive') ||
    (mission.source === 'police_snc' && mission.snc_scenario === 'rem_depot') ||
    (mission.source === 'sia_couvert')
  const redeliveryAddr = isRedelivery
    ? (mission.redelivery_address || mission.destination_address || null)
    : null
  // Si c est une relivraison, on substitute le motif par RELIVRAISON pour
  // que le chauffeur sache immediatement quoi en faire.
  if (isRedelivery) {
    motif = 'RELIVRAISON'
  }

  // AVP : note speciale (date + 60j eligibilite destruction)
  const isAvp = mission.source === 'police_avp'

  // Olivier 2026-06-02 : notes specifiques par source (s applique uniquement
  // si pas une relivraison — sinon le motif RELIVRAISON et l adresse priment).
  //   - Mal Garee     : "Blocage par police" / "Pas de blocage"
  //   - Rodeo         : "Restitution a partir du J+3 avec LEVEE DE SAISIE uniquement"
  //   - Accident      : note vide
  //   - Police Saisie : "Zone de police + nom policier"
  //   - AVP           : isAvp gere la note "AVP date+60j"
  let noteOverride: string | undefined = undefined
  if (!isRedelivery) {
    if (mission.source === 'police_mg') {
      noteOverride = (mission as any).police_blocked ? 'Blocage par police' : 'Pas de blocage'
    } else if (mission.source === 'police_rodeo') {
      const baseDate = new Date(mission.intervention_date || mission.received_at)
      baseDate.setDate(baseDate.getDate() + 3)
      const pad = (n: number) => String(n).padStart(2, '0')
      const j3Str = `${pad(baseDate.getDate())}/${pad(baseDate.getMonth()+1)}/${String(baseDate.getFullYear()).slice(-2)}`
      noteOverride = `Restitution a partir du ${j3Str} avec LEVEE DE SAISIE uniquement`
    } else if (mission.source === 'police_accident') {
      noteOverride = ''
    } else if (mission.source === 'police_saisie') {
      const zone = (mission as any).police_zone || ''
      const officer = (mission as any).officer_name || ''
      const parts = [zone, officer].filter(s => s && String(s).trim()).join(' - ')
      noteOverride = parts || ''
    }
  }

  const result = await printVdSoftParcLabel({
    missionId:        mission.id,
    missionNumber:    mission.mission_number ?? null,
    odooTicketId:     mission.odoo_ticket_id ?? null,
    source:           mission.source,
    motif,
    interventionDate: mission.intervention_date || mission.received_at,
    plate:            mission.vehicle_plate,
    brand:            mission.vehicle_brand,
    model:            mission.vehicle_model,
    vin:              mission.vehicle_vin,
    redeliveryAddr,
    isAvp,
    noteOverride,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Impression echec' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
