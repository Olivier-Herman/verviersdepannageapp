// src/app/api/towsoft/create/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPoliceEmail, buildPoliceEmailHtml } from '@/lib/emails'
import { printVdSoftParcLabel } from '@/lib/missions/print-parc-label'
import { plateOrVinTail }       from '@/lib/plate'
import { FOURRIERE_TYPE_TO_SOURCE, PREFIX_BY_TYPE, zoneForType } from '@/lib/missions/police-mapping'
import { getDefaultParcZone } from '@/lib/missions/parc-default'

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
    policeZone, officerName, officerPartnerId,
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
    // Saisie : motif obligatoire + label snapshot (demande Franck 2026-06-01).
    saisieMotifCode,
    saisieMotifLabel,
  } = body

  if (!type || !date || !time || !location) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const user = session.user as any

  const { data: dbUser } = await supabase
    .from('users')
    .select('id, towsoft_name, name')
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

  // Olivier 2026-06-30 : INTERRUPTEUR création TowSoft. Quand désactivé, on
  // continue de créer la mission VD Soft + le ticket Odoo (dossier_number), mais
  // on NE pousse PAS la fiche dans TowSoft : la queue est marquée 'skipped' et le
  // dispatch GitHub Action (= push TowSoft) est sauté. La LECTURE TowSoft
  // (recherche/historique) reste inchangée. Réversible en 1 clic (/admin/dispatch).
  const { data: tsSetting } = await supabase
    .from('app_settings').select('value').eq('key', 'towsoft_create').maybeSingle()
  const towsoftEnabled = (tsSetting?.value as any)?.enabled !== false   // défaut = activé

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
      status:        towsoftEnabled ? 'pending' : 'skipped',
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
  // Olivier 2026-06-03 (W10) : mappings extraits dans @/lib/missions/police-mapping
  // pour eviter le drift avec /api/missions/police/draft.

  // Id de la mission VD Soft creee — necessaire pour renvoyer au client (formulaire
  // chauffeur) afin de construire un lien encaissement precomplete sur les sources
  // avec paiement direct (prive / snc / mal_garee). Olivier 2026-05-26.
  let vdMissionId: string | null = null

  if (!isAssistance && FOURRIERE_TYPE_TO_SOURCE[type]) {
    const vdSource = FOURRIERE_TYPE_TO_SOURCE[type]
    // Olivier 2026-06-22 « catalog strict » : zoneForType décide si la mission
    // va au parc (selon le scénario) ; quand oui, la zone vient du parc par
    // défaut de la source (Administration → Sources de mission).
    const vdZoneRaw = zoneForType(type, sncScenario, appelPriveDestination, malGareeScenario)
    const vdZone    = vdZoneRaw ? (await getDefaultParcZone(vdSource, supabase) || vdZoneRaw) : null
    const nowIso    = new Date().toISOString()

    // Heure d'intervention. Olivier 2026-06-29 (fix +2h) : PoliceClient calcule
    // déjà intervention_at côté navigateur (fuseau Belgique correct) → on l'utilise
    // en priorité. Sinon fallback : on interprète date/time en heure Europe/Brussels
    // (PAS en UTC — le serveur Vercel tourne en UTC, donc `new Date('...T...')`
    // sans offset décalait de +2h en été). Approximation DST par le mois.
    let interventionISO = nowIso
    if (typeof body.intervention_at === 'string' && body.intervention_at) {
      interventionISO = body.intervention_at
    } else {
      try {
        const [dd, mm, yyyy] = (date || '').split('-')
        const [hh, mn] = (time || '00:00').split(':')
        if (dd && mm && yyyy) {
          const month = parseInt(mm, 10)
          const offMin = (month >= 4 && month <= 10) ? 120 : 60   // BE : +2 été, +1 hiver
          const offH = String(Math.floor(offMin / 60)).padStart(2, '0')
          const offM = String(offMin % 60).padStart(2, '0')
          interventionISO = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mn}:00+${offH}:${offM}`).toISOString()
        }
      } catch {}
    }

    const fullName = [ownerFirstName, ownerLastName].filter(Boolean).join(' ') || null

    // Prefix external_id et dossier_number selon le type :
    //   mal_garee -> MG-XXX
    //   rodeo     -> RODEO-XXX
    //   avp       -> AVP-XXX
    //   snc       -> SNC-XXX
    // W10 : prefix vient du mapping centralise
    const prefix = PREFIX_BY_TYPE[type] || 'POLICE'

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
        // Olivier 2026-06-16 : le chauffeur qui crée la fiche police EST celui
        // qui fait l'intervention → on l'assigne d'office (sinon la mission
        // restait sans chauffeur assigné). Seul PoliceClient (app chauffeur)
        // appelle cet endpoint, donc pas de risque d'auto-assigner un dispatcher.
        assigned_to:        dbUser.id || null,
        assigned_at:        nowIso,
        parc_zone_key:      vdZone,
        // Olivier 2026-06-03 (audit J-2 W11) : fallback plaque vide -> 5
        // derniers chars du VIN (evite "PAS DE PLAQUE" generique).
        vehicle_plate:      plateOrVinTail(plate, vin) || null,
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
        // Saisie : motif obligatoire + label snapshot (demande Franck 2026-06-01)
        saisie_motif_code:     type === 'saisie' ? (saisieMotifCode  || null) : null,
        saisie_motif_label:    type === 'saisie' ? (saisieMotifLabel || null) : null,
        // Police zone + officier (Olivier 2026-06-02) : affichage sur etiquette
        // pour Police Saisie. Pour les autres types police on les garde aussi
        // pour traçabilité.
        police_zone:           policeZone   || null,
        officer_name:          officerName  || null,
        officer_partner_id:    officerPartnerId ?? null,
        // Persiste odoo_ticket_id pour reconstruire URL QR /v/[ticketId] plus tard.
        // Olivier 2026-05-27 : evite double-source (towsoft_queue + reverse lookup).
        odoo_ticket_id:     odooTicketId || null,
        created_at:         nowIso,
        updated_at:         nowIso,
      })
      .select('id, mission_number')
      .single()

    if (vdErr) {
      // Olivier 2026-06-03 : VD Soft = source de verite. Si INSERT plante,
      // on doit :
      //   1. Supprimer le ticket Odoo orphelin (qui vient d etre cree)
      //   2. Retourner une erreur 500 au chauffeur pour qu il retente
      // Ainsi pas d etat incoherent : soit la mission est partout, soit nulle part.
      console.error('[towsoft/create] INSERT incoming_missions ECHEC BLOQUANT:', vdErr.message)
      if (odooTicketId) {
        try {
          const { odooRpc } = await import('@/lib/odoo')
          await odooRpc('helpdesk.ticket', 'unlink', [[odooTicketId]])
          console.log(`[towsoft/create] Cleanup ticket Odoo orphelin ${odooTicketId}`)
        } catch (e: any) {
          console.warn(`[towsoft/create] Cleanup ticket Odoo ${odooTicketId} ECHEC:`, e?.message)
        }
      }
      return NextResponse.json({
        ok:    false,
        error: `Echec creation mission VD Soft : ${vdErr.message}. La mission n a pas ete creee, reessaie.`,
      }, { status: 500 })
    } else {
      console.log('[towsoft/create] VD Soft mission cree:', vdData?.id, '#' + vdData?.mission_number, 'source:', vdSource, 'zone:', vdZone)
      vdMissionId = vdData?.id || null

      // Impression etiquette parc depuis VD Soft (chantier "Etiquettes VD Soft
      // globales", Olivier 2026-05-26). Migration complete 2026-06-02 :
      // toutes les missions qui partent en parc (computedStatus='parked')
      // impriment maintenant via VD Soft. La double impression cote Odoo
      // doit etre desactivee dans une iteration future via le module Helpdesk.
      const shouldPrintFromVdSoft = vdMissionId && computedStatus === 'parked'
      if (shouldPrintFromVdSoft && vdMissionId) {
        const isSncDepot           = isSnc && sncScenario === 'rem_depot'
        const isMalGareeChargement = type === 'mal_garee' && malGareeScenario === 'chargement'
        const isAvp                = type === 'avp'
        const isRodeo              = type === 'rodeo'
        const isAccident           = type === 'accident'
        const isSaisie             = type === 'saisie'

        // Motif affiche sur l etiquette (colonne droite)
        const motifLabel =
          isAppelPrive           ? 'APPEL PRIVE'
          : isMalGareeChargement ? 'MAL GAREE'
          : isRodeo              ? 'RODEO'
          : isAvp                ? 'AVP'
          : isAccident           ? 'ACCIDENT'
          : isSaisie             ? (saisieMotifLabel || 'SAISIE').toUpperCase()
          : type === 'sc'        ? 'SIABIS COUVERT'
          :                        'SIABIS NON COUVERT'

        // Adresse de relivraison : uniquement pour les sources concernees
        // (Appel Prive depot + SNC/SC rem_depot). Pour les autres, undefined
        // → la note ne tombera pas sur "En attente d info adresse de relivraison".
        const wantsRedelivery = (isAppelPrive && appelPriveDestination === 'depot') || isSncDepot
        const redeliveryAddr = wantsRedelivery
          ? ((body.destination || body.redelivery_address || '').trim() || null)
          : undefined

        // Note specifique selon source (Olivier 2026-06-02) :
        //   - Mal Garee chargement : "Blocage par police" / "Pas de blocage"
        //   - Rodeo                : "Restitution a partir du J+3 ..."
        //   - Police Accident      : note vide
        //   - Police Saisie        : "Zone de police + nom policier"
        //   - AVP                  : laisse vide ici, isAvp gere la note date+60j
        let noteOverride: string | undefined = undefined
        if (isMalGareeChargement) {
          noteOverride = policeBlocked ? 'Blocage par police' : 'Pas de blocage'
        } else if (isRodeo) {
          const j3 = new Date(interventionISO)
          j3.setDate(j3.getDate() + 3)
          const pad = (n: number) => String(n).padStart(2, '0')
          const j3Str = `${pad(j3.getDate())}/${pad(j3.getMonth()+1)}/${String(j3.getFullYear()).slice(-2)}`
          noteOverride = `Restitution a partir du ${j3Str} avec LEVEE DE SAISIE uniquement`
        } else if (isAccident) {
          noteOverride = ''
        } else if (isSaisie) {
          const parts = [policeZone, officerName].filter(s => s && String(s).trim()).join(' - ')
          noteOverride = parts || ''
        }

        await printVdSoftParcLabel({
          missionId:        vdMissionId,
          missionNumber:    vdData?.mission_number ?? null,
          odooTicketId:     odooTicketId ?? null,
          source:           vdSource,
          motif:            motifLabel,
          interventionDate: interventionISO,
          plate:            plate || null,
          brand:            brand || null,
          model:            model || null,
          vin:              vin   || null,
          redeliveryAddr,
          isAvp,
          noteOverride,
        })
      }
    }
  }

  // Numéro de dossier final pour TowSoft : si dossier explicite fourni on le garde,
  // sinon "Encodage automatique <ticketOdoo>" pour faire le lien depuis TowSoft vers Odoo.
  const towsoftDossierNumber = dossierNumber
    || (odooTicketId ? `Encodage automatique ${odooTicketId}` : 'Encodage automatique')

  // 2. GH dispatch (push TowSoft) + email en parallèle (le ticket Odoo est déjà créé).
  //    Le push TowSoft n'est déclenché que si l'interrupteur est ACTIVÉ.
  const parallelTasks: Promise<any>[] = []
  if (towsoftEnabled) {
    parallelTasks.push(fetch(
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
    }))
  } else {
    console.log('[TowSoft] Interrupteur OFF — création fiche TowSoft sautée (queue skipped, mission VD Soft créée).')
  }

  parallelTasks.push(
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
  )

  await Promise.allSettled(parallelTasks)

  return NextResponse.json({
    ok:         true,
    queueId:    queueEntry.id,
    missionId:  vdMissionId,  // id de la mission VD Soft (null si type sans parc, ex: accident)
    message:    'Mission en cours de création',
  })
}
