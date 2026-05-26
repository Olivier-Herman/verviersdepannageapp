// src/app/api/towsoft/create/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPoliceEmail, buildPoliceEmailHtml } from '@/lib/emails'
import { printVdSoftParcLabel } from '@/lib/missions/print-parc-label'

export const maxDuration = 60

const TYPE_CONFIG: Record<string, { label: string; parc: string; motif: string }> = {
  accident:    { label: '🚨 Police Accident',    parc: 'K3', motif: 'ACCIDENT' },
  saisie:      { label: '⚖️ Saisie',             parc: 'J',  motif: 'SAISIE' },
  rodeo:       { label: '🏎️ Rodéo',              parc: 'J',  motif: 'RODEO' },
  mal_garee:   { label: '🚫 Mal Garée',          parc: 'L - Fourrière - Zone L Mal Garée', motif: 'MAL GARÉE' },
  snc:         { label: '🛣️ Siabis Non Couvert', parc: 'K2', motif: 'SIABIS NON COUVERT' },
  sc:          { label: '🛣️ Siabis Couvert',     parc: 'K2', motif: 'SIABIS COUVERT' },
  appel_prive: { label: '📞 Appel Privé',        parc: 'K3', motif: 'APPEL PRIVE' },
  avp:         { label: '🔲 AVP',                parc: 'J',  motif: 'ABANDON' },
}

const ASSISTANCE_COMPANY: Record<string, { label: string; towsoftClient: string; odooPartner: string; tagId: number; dsp: string; rem: string }> = {
  touring: { label: 'Touring',  towsoftClient: 'Touring SA',                         odooPartner: 'Touring',        tagId: 27, dsp: 'TOURING - DEPANNAGE',                   rem: 'TOUREM TOURING - REMORQUAGE' },
  vab:     { label: 'VAB',      towsoftClient: 'VAB NV',                              odooPartner: 'VAB',            tagId: 28, dsp: 'VAB - DEPANNAGE SURPLACE (APD 07/2024)', rem: 'VAB - REMORQUAGE (APD 07/2024)' },
  ima:     { label: 'IMA',      towsoftClient: 'IMA BENELUX',                         odooPartner: 'Ima Benelux',    tagId: 29, dsp: 'IMA BENELUX - DEPANNAGE SURPLACE',        rem: 'IMA BENELUX - REMORQUAGE' },
  mondial: { label: 'Mondial',  towsoftClient: 'AWP Automatique Dispatch',            odooPartner: 'AWP P&C S.A.',   tagId: 30, dsp: 'MONDIAL - DSP',                           rem: 'MONDIAL - REMORQUAGE' },
  ipa:     { label: 'IPA',      towsoftClient: 'Inter Partner Assistance (007928)',   odooPartner: 'Inter Partner Assistance, Dossier 01 ou 34', tagId: 31, dsp: 'IPA - DEPANNAGE SURPLACE', rem: 'IPA - REMORQUAGE' },
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    type, company, interventionType,
    date, time, plate, vin, brand, model,
    location, destination, dossierNumber,
    policeZone, officerName,
    ownerFirstName, ownerLastName, ownerPhone,
    remarks, photoUrls,
    policeBlocked,
    policeLeveeSaisieOk,
    policeLeveeSaisieDocUrl,
    // SNC (Siabis Non Couvert) + SC (Siabis Couvert)
    sncRequiresBalisage,
    sncScenario,         // 'dsp' | 'rem_client' | 'rem_depot'
    scAssistanceName,    // SC uniquement : nom assistance qui paye
    // Coordonnees GPS (pour SNC/SC : calcul tarif via Google Distance Matrix)
    incidentLat, incidentLng,
    destinationLat, destinationLng,
    // Appel Prive : montant TVAC saisi par le dispatcher/chauffeur (forfait
    // negocie au tel). Si vide -> tarif fallback police_accident applique a
    // la facturation. Stocke direct dans incoming_missions.amount_to_collect.
    amountToCollect,
    // Appel Prive : type d intervention DSP ou REM (cote chauffeur). Mappe sur
    // mission_type canonique 'depannage' / 'remorquage' a l insertion.
    appelPriveType,
    // Appel Prive REM : destination 'client' (livraison directe, pas de parc,
    // pas d etiquette) ou 'depot' (Transit + impression etiquette). DSP :
    // implicitement 'client'. Olivier 2026-05-26.
    appelPriveDestination,
    // Mal Garee scenario : 'chargement' (defaut, parc) ou 'deplacement_paye'
    // (client arrive avant chargement, paye 125 EUR TVAC pour le deplacement).
    malGareeScenario,
  } = body

  if (!type || !date || !time || !location) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const user = session.user as any

  const { data: dbUser } = await supabase
    .from('users')
    .select('towsoft_name, name')
    .eq('email', user.email)
    .maybeSingle()

  if (!dbUser?.towsoft_name) {
    return NextResponse.json({ error: "Profil TowSoft non configuré. Contactez l'administrateur." }, { status: 400 })
  }

  const isAssistance = type === 'assistance'
  const assistanceConfig = isAssistance ? ASSISTANCE_COMPANY[company] : null
  const config = isAssistance ? null : TYPE_CONFIG[type]

  if (!isAssistance && !config) return NextResponse.json({ error: 'Type invalide' }, { status: 400 })
  if (isAssistance && !assistanceConfig) return NextResponse.json({ error: 'Compagnie invalide' }, { status: 400 })

  const typeLabel = isAssistance
    ? `🤝 ${assistanceConfig!.label} — ${interventionType?.toUpperCase()}`
    : config!.label
  const parcValue = isAssistance
    ? (interventionType === 'rem_parc' ? 'K - Relivraison - Zone K' : '')
    : config!.parc
  const motifValue = isAssistance
    ? (interventionType === 'rem_parc' ? 'A Relivrer' : '')
    : config!.motif

  // Sauvegarder dans la queue
  const { data: queueEntry, error: queueError } = await supabase
    .from('towsoft_queue')
    .insert({
      mission_type:  type,
      date, time, plate, vin, brand, model,
      location,
      police_zone:   policeZone,
      officer_name:  officerName,
      owner_first:   ownerFirstName,
      owner_last:    ownerLastName,
      owner_phone:   ownerPhone,
      remarks,
      driver_name:   dbUser.towsoft_name,
      parc:          parcValue,
      motif:         motifValue,
      status:        'pending',
    })
    .select('id')
    .single()

  if (queueError) {
    console.error('[TowSoft] Queue error:', queueError)
    return NextResponse.json({ error: 'Erreur création queue' }, { status: 500 })
  }

  // Remarques pour le champ #remarques de TowSoft (texte brut, pas de liens cliquables là-bas)
  // Les photos sont publiées séparément en note de chat sur la fiche mission après création
  // (le chat TowSoft auto-linkifie les URLs, contrairement au champ remarques).
  const remarksClean = [
    type === 'appel_prive' ? '!!! APPEL PRIVE !!!' : '',
    remarks,
  ].filter(Boolean).join(' --- ')

  // remarksWithPhotos reste utilisé pour l'email + la description Odoo qui rendent le HTML
  const remarksWithPhotos = [
    remarksClean,
    photoUrls?.length ? `Photos: ${photoUrls.join(' | ')}` : '',
  ].filter(Boolean).join(' --- ')

  // Description Odoo
  const odooDescription = buildPoliceEmailHtml({
    type: type, typeLabel, chauffeurName: dbUser.name,
    date, time, location,
    policeZone:     policeZone || '',
    officerName:    officerName || '',
    plate:          plate || '',
    vin:            vin || '',
    brand:          brand || '',
    model:          model || '',
    ownerFirstName: ownerFirstName || '',
    ownerLastName:  ownerLastName || '',
    ownerPhone:     ownerPhone || '',
    remarks:        remarksWithPhotos || '',
    photoUrls:      photoUrls || [],
    parc:           parcValue,
  })

  // Tags Odoo selon type
  const odoTags: number[] = []
  if (isAssistance) {
    odoTags.push(assistanceConfig!.tagId) // tag compagnie
    odoTags.push(interventionType === 'rem_parc' ? 19 : 26) // REL ou Assistance
  } else {
    // TODO Olivier : confirmer le tag Odoo pour 'rodeo' (mis a 5 = saisie pour
    // l instant, a ajuster si un tag dedie existe ou si on en cree un nouveau).
    const POLICE_TAGS: Record<string, number> = { accident: 6, saisie: 5, rodeo: 5, snc: 15, mal_garee: 1, appel_prive: 25, avp: 10 }
    if (POLICE_TAGS[type]) odoTags.push(POLICE_TAGS[type])
  }

  // 1. Helpdesk Odoo créé EN PREMIER pour récupérer son ID. On l'intègre ensuite dans
  // le numéro de dossier TowSoft afin que la fiche TowSoft pointe vers son ticket Odoo.
  // Appel Prive : VD Soft = source de verite (cf. [[project-helpdesk-ticket-obsolete]]).
  // On saute la creation du ticket Helpdesk Odoo pour ce type.
  let odooTicketId: number | null = null
  if (type === 'appel_prive') {
    console.log('[TowSoft] appel_prive: skip ticket Helpdesk Odoo (VD Soft source verite)')
  } else {
  try {
    const { createHelpdeskTicket } = await import('@/lib/odoo-fsm')
    const result = await createHelpdeskTicket({
      supabaseId:        queueEntry.id,
      dossierNumber:     dossierNumber || queueEntry.id,
      source:            isAssistance ? `ASSISTANCE_${(company || '').toUpperCase()}` : type.toUpperCase(),
      clientName:        [ownerFirstName, ownerLastName].filter(Boolean).join(' ') || 'Inconnu',
      odooPartner:       isAssistance ? 'Assistance Dépannage' : undefined,
      vehiclePlate:      plate || '',
      vehicleBrand:      brand || '',
      vehicleModel:      model || '',
      vehicleVin:        vin || '',
      city:              location || '',
      dateIntervention:  date || '',
      missionType:       isAssistance ? (interventionType === 'rem_parc' ? 'rem_parc' : 'dsp') : type,
      tagIds:            odoTags,
      description:       odooDescription,
      teamId:            12,
      // Missions police créées par chauffeur : ticket directement à l'étape "Résolu" (id 4).
      // Missions assistance : étape par défaut (workflow normal continue côté dispatch).
      stageId:           isAssistance ? undefined : 4,
      noteEtiquette:     type === 'avp' ? (() => {
        // AVP note = "AVP " + (date d enlevement + 60 jours)
        // Apres cette date, le vehicule est eligible a la destruction (accord Ville).
        const parts = (date || '').split('-')
        if (parts.length === 3) {
          const d = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]))
          d.setDate(d.getDate() + 60)  // exactement +60 jours
          const pad = (n: number) => String(n).padStart(2,'0')
          return 'AVP ' + pad(d.getDate()) + '-' + pad(d.getMonth()+1) + '-' + d.getFullYear()
        }
        return 'AVP'
      })() : undefined,
    })
    odooTicketId = result.ticketId
    console.log('[TowSoft] Helpdesk Odoo créé:', odooTicketId)
    await supabase.from('towsoft_queue').update({ odoo_ticket_id: odooTicketId }).eq('id', queueEntry.id)
  } catch (e) {
    console.error('[TowSoft] Helpdesk Odoo échec:', e)
  }
  }

  // 1bis. INSERT incoming_missions pour les missions fourriere (parc VD Soft).
  // Mapping des types police -> source VD Soft + zone parc cible. Etendu au fur
  // et a mesure du chantier fourriere police (Mal Garees + Rodeos pour l instant).
  const FOURRIERE_TYPE_TO_SOURCE: Record<string, string> = {
    mal_garee:   'police_mg',
    rodeo:       'police_rodeo',
    avp:         'police_avp',
    snc:         'police_snc',
    sc:          'sia_couvert',
    appel_prive: 'prive',
  }
  // Zone parc cible. Pour SNC/SC : depend du scenario (Transit si rem_depot, sinon
  // pas de zone car le vehicule ne reste pas chez nous).
  // Appel Prive :
  //   - DSP / REM 'client' -> pas de zone (intervention immediate, facturation directe)
  //   - REM 'depot'        -> Transit (mise en parc, etiquette imprimee)
  // Mal Garee :
  //   - chargement (defaut) -> zone L (parc standard)
  //   - deplacement_paye    -> pas de zone (client arrive avant chargement, paye, on repart)
  function zoneForType(t: string, sncScenarioVal?: string, priveDest?: string, malGareeScen?: string): string | null {
    if (t === 'mal_garee') return malGareeScen === 'deplacement_paye' ? null : 'L'
    if (t === 'rodeo')     return 'J'
    if (t === 'avp')       return 'J'
    if (t === 'snc' || t === 'sc') return sncScenarioVal === 'rem_depot' ? 'Transit' : null
    if (t === 'appel_prive') return priveDest === 'depot' ? 'Transit' : null
    return null
  }

  // Id de la mission VD Soft creee — necessaire pour renvoyer au client (formulaire
  // chauffeur) afin de construire un lien encaissement precomplete sur les sources
  // avec paiement direct (prive / snc / mal_garee). Olivier 2026-05-26.
  let vdMissionId: string | null = null

  if (!isAssistance && FOURRIERE_TYPE_TO_SOURCE[type]) {
    const vdSource = FOURRIERE_TYPE_TO_SOURCE[type]
    const vdZone   = zoneForType(type, sncScenario, appelPriveDestination, malGareeScenario)
    const nowIso   = new Date().toISOString()

    // Combine date (DD-MM-YYYY) + time (HH:MM) en ISO pour intervention_date.
    let interventionISO = nowIso
    try {
      const [dd, mm, yyyy] = (date || '').split('-')
      const [hh, mn] = (time || '00:00').split(':')
      if (dd && mm && yyyy) {
        interventionISO = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mn}:00`).toISOString()
      }
    } catch {}

    const fullName = [ownerFirstName, ownerLastName].filter(Boolean).join(' ') || null

    // Prefix external_id et dossier_number selon le type :
    //   mal_garee -> MG-XXX
    //   rodeo     -> RODEO-XXX
    //   avp       -> AVP-XXX
    //   snc       -> SNC-XXX
    const prefixByType: Record<string, string> = {
      mal_garee:   'MG',
      rodeo:       'RODEO',
      avp:         'AVP',
      snc:         'SNC',
      sc:          'SC',
      appel_prive: 'PRIVE',
    }
    const prefix = prefixByType[type] || 'POLICE'

    // AVP : police_blocked = true par defaut (vérif police obligatoire avant
    // restitution, car le proprio doit toujours passer par la police pour
    // valider la recuperation, qui nous informe ensuite).
    const isAvp = type === 'avp'
    const isSnc = type === 'snc' || type === 'sc'
    const isAppelPrive = type === 'appel_prive'

    // SNC : mission_type depend du scenario
    //   - dsp        -> depannage
    //   - rem_client -> remorquage (livraison directe)
    //   - rem_depot  -> remorquage (mise en parc Transit)
    const sncMissionType = isSnc
      ? (sncScenario === 'dsp' ? 'depannage' : 'remorquage')
      : null

    // Appel Prive : DSP -> depannage, REM -> remorquage. Defaut remorquage
    // si pas precise (compat retro avec les anciens clients qui n envoient
    // pas le champ).
    const priveMissionType = isAppelPrive
      ? (String(appelPriveType || '').toUpperCase() === 'DSP' ? 'depannage' : 'remorquage')
      : null

    // Status par type :
    //   - SNC rem_depot -> parked (en zone Transit)
    //   - SNC dsp/rem_client -> in_progress (mission immediate, paiement chauffeur)
    //   - Appel Prive REM 'depot' -> parked (en zone Transit, etiquette imprimee)
    //   - Appel Prive DSP / REM 'client' -> in_progress (intervention immediate)
    //   - Mal Garee 'deplacement_paye' -> in_progress (client paye direct, pas de parc)
    //   - police fourriere classique (mal_garee chargement / rodeo / avp) -> parked
    const isMalGareeDeplacementPaye = type === 'mal_garee' && malGareeScenario === 'deplacement_paye'
    const computedStatus = isSnc
      ? (sncScenario === 'rem_depot' ? 'parked' : 'in_progress')
      : isAppelPrive
        ? (appelPriveDestination === 'depot' ? 'parked' : 'in_progress')
        : isMalGareeDeplacementPaye
          ? 'in_progress'
          : 'parked'

    const { data: vdData, error: vdErr } = await supabase
      .from('incoming_missions')
      .insert({
        external_id:        `${prefix}-${queueEntry.id.slice(0, 8)}`,
        dossier_number:     odooTicketId ? `${prefix}-${odooTicketId}` : null,
        source:             vdSource,
        // mission_type : Mal Garee deplacement_paye = trajet_vide (DPR) car pas
        // de chargement effectif. Sinon SNC/Prive selon logique dediee, defaut remorquage.
        mission_type:       isSnc
                              ? sncMissionType
                              : isAppelPrive
                                ? priveMissionType
                                : isMalGareeDeplacementPaye
                                  ? 'trajet_vide'
                                  : 'remorquage',
        status:             computedStatus,
        parc_zone_key:      vdZone,
        vehicle_plate:      ((plate || '').trim().toUpperCase()) || null,
        vehicle_vin:        ((vin || '').trim().toUpperCase()) || null,
        vehicle_brand:      brand || null,
        vehicle_model:      model || null,
        client_name:        fullName,
        client_phone:       ownerPhone || null,
        // SC : billed_to = assistance (paye), pas le client
        billed_to_name:     (type === 'sc' && scAssistanceName) ? String(scAssistanceName).trim() : null,
        // Appel Prive : forfait TVAC saisi par dispatcher/chauffeur. Si vide,
        // la facturation appliquera le fallback tarif police_accident.
        // Mal Garee deplacement_paye : forfait fixe 125 EUR TVAC (Olivier 2026-05-26).
        amount_to_collect:  isAppelPrive && amountToCollect != null && amountToCollect !== ''
                              ? Number(amountToCollect)
                              : isMalGareeDeplacementPaye
                                ? 125
                                : null,
        incident_address:   location,
        incident_city:      null,
        incident_lat:       typeof incidentLat === 'number' ? incidentLat : null,
        incident_lng:       typeof incidentLng === 'number' ? incidentLng : null,
        destination_address: destination || null,
        destination_lat:    typeof destinationLat === 'number' ? destinationLat : null,
        destination_lng:    typeof destinationLng === 'number' ? destinationLng : null,
        received_at:        nowIso,
        intervention_date:  interventionISO,
        driver_photos:      Array.isArray(photoUrls) && photoUrls.length > 0 ? photoUrls : null,
        remarks_general:    remarks || null,
        police_blocked:     isAvp ? true : Boolean(policeBlocked),
        police_levee_saisie_ok:       Boolean(policeLeveeSaisieOk),
        police_levee_saisie_doc_url:  policeLeveeSaisieDocUrl || null,
        // SNC-specifiques
        snc_requires_balisage: isSnc ? Boolean(sncRequiresBalisage) : false,
        snc_scenario:          isSnc ? (sncScenario || null) : null,
        odoo_task_id:       null,
        created_at:         nowIso,
        updated_at:         nowIso,
      })
      .select('id')
      .single()

    if (vdErr) {
      console.error('[towsoft/create] INSERT incoming_missions echec (non bloquant):', vdErr.message)
    } else {
      console.log('[towsoft/create] VD Soft mission cree:', vdData?.id, 'source:', vdSource, 'zone:', vdZone)
      vdMissionId = vdData?.id || null

      // Impression etiquette parc depuis VD Soft (chantier "Etiquettes VD Soft
      // globales", Olivier 2026-05-26). Sources migrees :
      //   - Appel Prive REM 'depot' : pas de ticket Helpdesk donc seul VD Soft imprime
      //   - SNC / SC 'rem_depot'    : double impression (callback Odoo + VD Soft) pour
      //     transition. A desactiver cote callback quand format valide en parallele.
      //
      // TODO Mal Garee chargement / Rodeo / AVP : impressions toujours via callback
      // Helpdesk Odoo. A migrer dans une iteration future.
      const isSncDepot = isSnc && sncScenario === 'rem_depot'
      const shouldPrintFromVdSoft = vdMissionId && (
        (isAppelPrive && appelPriveDestination === 'depot') ||
        isSncDepot
      )
      if (shouldPrintFromVdSoft && vdMissionId) {
        // Adresse de relivraison : pour Appel Prive le chauffeur peut la saisir
        // dans PoliceClient.tsx (Fix 11). Pour SNC depot, le dispatcher la
        // definira via le bouton "Relivrer" plus tard. Si non saisie maintenant,
        // l etiquette indique "En attente d info adresse de relivraison".
        const redeliveryAddr = (body.destination || body.redelivery_address || '').trim() || null
        const motifLabel = isAppelPrive
          ? 'APPEL PRIVE'
          : (type === 'sc' ? 'SIABIS COUVERT' : 'SIABIS NON COUVERT')
        await printVdSoftParcLabel({
          missionId:        vdMissionId,
          source:           vdSource,
          motif:            motifLabel,
          interventionDate: interventionISO,
          plate:            plate || null,
          brand:            brand || null,
          model:            model || null,
          vin:              vin   || null,
          redeliveryAddr,
        })
      }
    }
  }

  // Numéro de dossier final pour TowSoft : si dossier explicite fourni on le garde,
  // sinon "Encodage automatique <ticketOdoo>" pour faire le lien depuis TowSoft vers Odoo.
  const towsoftDossierNumber = dossierNumber
    || (odooTicketId ? `Encodage automatique ${odooTicketId}` : 'Encodage automatique')

  // 2. GH dispatch + email en parallèle (le ticket Odoo est déjà créé)
  await Promise.allSettled([
    fetch(
      `https://api.github.com/repos/Olivier-Herman/verviersdepannageapp/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          event_type: 'create-towsoft-mission',
          client_payload: {
            queue_id: queueEntry.id,
            data: JSON.stringify({
              mission_type:      type,
              company:           company || '',
              intervention_type: interventionType || '',
              date, time, plate, vin, brand, model,
              location,
              destination:       destination || '',
              dossier_number:    towsoftDossierNumber,
              officer_name:      officerName || '',
              owner_first:       ownerFirstName || '',
              owner_last:        ownerLastName || '',
              owner_phone:       ownerPhone || '',
              remarks:           remarksClean || '',
              photo_urls:        photoUrls || [],
              driver_name:       dbUser.towsoft_name,
              parc:              parcValue,
              motif:             motifValue,
            }),
          },
        }),
      }
    ).then(r => {
      if (!r.ok) r.text().then(e => console.error('[TowSoft] GitHub dispatch error:', e))
      else console.log('[TowSoft] GitHub Action déclenchée pour queue:', queueEntry.id)
    }),

    sendPoliceEmail({
      type, typeLabel, chauffeurName: dbUser.name,
      date, time, location,
      policeZone:     policeZone || '',
      officerName:    officerName || '',
      plate:          plate || '',
      vin:            vin || '',
      brand:          brand || '',
      model:          model || '',
      ownerFirstName: ownerFirstName || '',
      ownerLastName:  ownerLastName || '',
      ownerPhone:     ownerPhone || '',
      remarks:        remarksWithPhotos || '',
      photoUrls:      photoUrls || [],
      parc:           parcValue,
    }).then(() => console.log('[TowSoft] Email envoyé'))
     .catch(e => console.error('[TowSoft] Email échec:', e)),
  ])

  return NextResponse.json({
    ok:         true,
    queueId:    queueEntry.id,
    missionId:  vdMissionId,  // id de la mission VD Soft (null si type sans parc, ex: accident)
    message:    'Mission en cours de création',
  })
}
