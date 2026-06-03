// POST /api/missions/police/draft
//
// Cree une mission Police en mode "draft" (awaiting_payment=true) sans
// declencher les hooks externes (TowSoft / Helpdesk Odoo / email). La
// mission est invisible cote dispatch et n est PAS envoyee aux assurances
// tant que le paiement n est pas complet.
//
// Cas d usage : scenarios avec paiement immediat obligatoire (Mal Garee
// deplacement_paye, SNC DSP/REM client, Appel Prive DSP/REM client).
// Le chauffeur encaisse une ou plusieurs tranches depuis la fiche mission.
// Quand le solde atteint 0, il clique "Finaliser" qui POST sur la route
// /api/missions/[id]/finalize pour declencher les hooks externes.
//
// Olivier 2026-06-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 30

// Source / zone mapping (copie alleegee de towsoft/create — la version
// finalize reutilisera la route complete pour eviter la divergence)
const FOURRIERE_TYPE_TO_SOURCE: Record<string, string> = {
  mal_garee:   'police_mg',
  rodeo:       'police_rodeo',
  avp:         'police_avp',
  snc:         'police_snc',
  sc:          'sia_couvert',
  appel_prive: 'prive',
}

function zoneForType(t: string, sncScenario?: string, priveDest?: string, malGareeScen?: string): string | null {
  if (t === 'mal_garee')   return malGareeScen === 'deplacement_paye' ? null : 'L'
  if (t === 'rodeo')       return 'J'
  if (t === 'avp')         return 'J'
  if (t === 'snc' || t === 'sc') return sncScenario === 'rem_depot' ? 'Transit' : null
  if (t === 'appel_prive') return priveDest === 'depot' ? 'Transit' : null
  return null
}

const PREFIX_BY_TYPE: Record<string, string> = {
  mal_garee:   'MG',
  rodeo:       'RODEO',
  avp:         'AVP',
  snc:         'SNC',
  sc:          'SC',
  appel_prive: 'PRIVE',
  accident:    'POLICE',
  saisie:      'POLICE',
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    type, date, time, plate, vin, brand, model, location, destination,
    ownerFirstName, ownerLastName, ownerPhone,
    remarks, photoUrls,
    policeBlocked,
    sncRequiresBalisage, sncScenario,
    incidentLat, incidentLng, destinationLat, destinationLng,
    amountToCollect,
    appelPriveType, appelPriveDestination,
    malGareeScenario,
    saisieMotifCode, saisieMotifLabel,
  } = body

  if (!type || !date || !time || !location) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const user     = session.user as any

  if (!FOURRIERE_TYPE_TO_SOURCE[type]) {
    return NextResponse.json({ error: 'Type non draftable' }, { status: 400 })
  }

  // Verif que le scenario justifie bien le mode draft (paiement immediat)
  const isMalGareeDeplacementPaye = type === 'mal_garee' && malGareeScenario === 'deplacement_paye'
  const isSnc                     = type === 'snc' || type === 'sc'
  const isAppelPrive              = type === 'appel_prive'
  const needsImmediatePayment =
    isMalGareeDeplacementPaye ||
    (isAppelPrive && (appelPriveType === 'DSP' || (appelPriveType === 'REM' && appelPriveDestination === 'client'))) ||
    (isSnc && (sncScenario === 'dsp' || sncScenario === 'rem_client'))

  if (!needsImmediatePayment) {
    return NextResponse.json({ error: 'Mode draft reserve aux missions a paiement immediat' }, { status: 400 })
  }

  const vdSource = FOURRIERE_TYPE_TO_SOURCE[type]
  const vdZone   = zoneForType(type, sncScenario, appelPriveDestination, malGareeScenario)
  const nowIso   = new Date().toISOString()

  // Olivier 2026-06-03 : si le caller fournit intervention_at deja calcule
  // (PoliceClient le fait cote browser pour respecter le fuseau Belgique),
  // on l utilise directement. Sinon, fallback sur reconstruction depuis
  // date/time — MAIS attention : `new Date('...T...')` cote Node.js (Vercel
  // UTC) interprete le string SANS timezone comme UTC, ce qui decale de
  // 2h en ete (perdait la majoration nuit pour les missions creees a 6h54 BE
  // alors qu en realite c etait dans la plage 0h-7h).
  let interventionISO = nowIso
  if (typeof body.intervention_at === 'string' && body.intervention_at) {
    interventionISO = body.intervention_at
  } else {
    try {
      const [dd, mm, yyyy] = (date || '').split('-')
      const [hh, mn]       = (time || '00:00').split(':')
      if (dd && mm && yyyy) {
        // Fallback : interprete en heure Europe/Brussels (UTC+1 hiver / UTC+2 ete)
        // en construisant explicitement avec offset. Approximation simple :
        // on devine l offset selon le mois (jan/feb/dec/oct fin = +1, autres = +2).
        const offsetMinutes = (() => {
          const month = parseInt(mm, 10)
          // DST en BE : dernier dimanche de mars → dernier dimanche d octobre = UTC+2
          // Approximation : avril-octobre inclusif = +2, sinon +1.
          return (month >= 4 && month <= 10) ? -120 : -60
        })()
        const localStr = `${yyyy}-${mm}-${dd}T${hh}:${mn}:00`
        const sign = offsetMinutes >= 0 ? '+' : '-'
        const absMin = Math.abs(offsetMinutes)
        const offH = String(Math.floor(absMin / 60)).padStart(2, '0')
        const offM = String(absMin % 60).padStart(2, '0')
        interventionISO = new Date(`${localStr}${sign}${offH}:${offM}`).toISOString()
      }
    } catch {}
  }

  const fullName = [ownerFirstName, ownerLastName].filter(Boolean).join(' ') || null
  const prefix   = PREFIX_BY_TYPE[type] || 'POLICE'

  // mission_type
  const sncMissionType   = isSnc        ? (sncScenario === 'dsp' ? 'depannage' : 'remorquage') : null
  const priveMissionType = isAppelPrive ? (String(appelPriveType || '').toUpperCase() === 'DSP' ? 'depannage' : 'remorquage') : null
  const missionType =
    isSnc                     ? sncMissionType :
    isAppelPrive              ? priveMissionType :
    isMalGareeDeplacementPaye ? 'trajet_vide'   :
    'remorquage'

  // Status : on garde la logique normale pour que la fiche mission soit
  // exploitable (statut visuel, photos, etc). Seul awaiting_payment=true
  // bloque les actions normales et masque cote dispatch.
  const computedStatus =
    isSnc                     ? (sncScenario === 'rem_depot' ? 'parked' : 'in_progress') :
    isAppelPrive              ? (appelPriveDestination === 'depot' ? 'parked' : 'in_progress') :
    isMalGareeDeplacementPaye ? 'in_progress' :
    'parked'

  // Olivier 2026-06-02 : si le chauffeur cree une mission a paiement immediat,
  // c est qu il est DEJA sur place (sinon il n encaisserait pas). On set
  // on_site_at=now pour que la timeline reflete la realite et que le statut
  // affiche soit "Sur place" plutot que "En route".
  const onSiteAt = nowIso

  // Montant a encaisser
  const amount =
    isAppelPrive && amountToCollect != null && amountToCollect !== ''
      ? Number(amountToCollect)
      : isMalGareeDeplacementPaye
        ? 125
        : null

  // External id temporaire (sera reutilise tel quel au finalize)
  const externalId = `${prefix}-DRAFT-${Date.now().toString(36)}`

  const { data, error } = await supabase
    .from('incoming_missions')
    .insert({
      external_id:         externalId,
      source:              vdSource,
      mission_type:        missionType,
      status:              computedStatus,
      awaiting_payment:    true,
      draft_params:        body,                 // snapshot complet pour finalize
      parc_zone_key:       vdZone,
      vehicle_plate:       ((plate || '').trim().toUpperCase()) || null,
      vehicle_vin:         ((vin   || '').trim().toUpperCase()) || null,
      vehicle_brand:       brand || null,
      vehicle_model:       model || null,
      client_name:         fullName,
      client_phone:        ownerPhone || null,
      amount_to_collect:   amount,
      incident_address:    location,
      incident_lat:        typeof incidentLat === 'number' ? incidentLat : null,
      incident_lng:        typeof incidentLng === 'number' ? incidentLng : null,
      destination_address: destination || null,
      destination_lat:     typeof destinationLat === 'number' ? destinationLat : null,
      destination_lng:     typeof destinationLng === 'number' ? destinationLng : null,
      intervention_date:   interventionISO,
      on_site_at:          onSiteAt,
      driver_photos:       Array.isArray(photoUrls) && photoUrls.length > 0 ? photoUrls : null,
      remarks_general:     remarks || null,
      police_blocked:      Boolean(policeBlocked),
      snc_requires_balisage: isSnc ? Boolean(sncRequiresBalisage) : false,
      snc_scenario:        isSnc ? (sncScenario || null) : null,
      saisie_motif_code:   type === 'saisie' ? (saisieMotifCode  || null) : null,
      saisie_motif_label:  type === 'saisie' ? (saisieMotifLabel || null) : null,
      // Auto-assign au chauffeur courant pour qu il retrouve la mission
      // tout de suite dans /mission (sans passer par dispatch)
      assigned_to:         user.id || null,
      assigned_at:         nowIso,
      created_at:          nowIso,
      updated_at:          nowIso,
    })
    .select('id, mission_number, amount_to_collect')
    .single()

  if (error) {
    console.error('[missions/police/draft] INSERT echec:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok:               true,
    missionId:        data.id,
    missionNumber:    data.mission_number,
    amountToCollect:  data.amount_to_collect,
  })
}
