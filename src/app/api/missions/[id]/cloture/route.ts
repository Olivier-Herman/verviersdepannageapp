// src/app/api/missions/[id]/cloture/route.ts
//
// FLUX 2 — clôture unifiée « Action » (Olivier 2026-08-11).
//
//   GET  → contexte de la page Action : issues valides, VR proposé, données de
//          repli (VIN/km), codes de fin autorisés pour un déplacement pour rien.
//   POST → enregistre le tronc commun sur la fiche PUIS lance la transformation
//          propre à l'assistance. Le chauffeur ne voit jamais cette partie.
//
// Ce qui n'est PAS ici : la clôture VD Soft elle-même (statut → completed →
// to_invoice). Elle reste dans /api/missions/driver-action, inchangée — on ne
// touche pas à ce qui marche pour toute la flotte. Cet endpoint prépare la fiche
// et parle à l'assistance ; le chauffeur termine ensuite sur l'écran habituel.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { flux2Enabled, flux2AssistanceOf } from '@/lib/cloture/gating'
import { availableOutcomes, outcomeIsRem, DPR_END_CODES, OUTCOMES, type Outcome } from '@/lib/cloture/outcomes'
import { parseComexKeys, transformTouring } from '@/lib/cloture/transform/touring'
import { loginComex, getComexProviders } from '@/lib/touring/comex'
import { findMotif } from '@/lib/cloture/motifs'
import { enqueueClose, isRetryable } from '@/lib/cloture/queue'
import { runVabOnSite, runVabTowClose } from '@/lib/cloture/transform/vab'
import { branchOf, needsMotif }  from '@/lib/cloture/outcomes'

export const dynamic     = 'force-dynamic'
// 300 s (5 min, plafond Vercel Pro) : la réponse au chauffeur part en quelques
// secondes, mais le pilotage VAB headless lancé en waitUntil dure 60-90 s et
// serait TUÉ par un plafond à 60 s. Olivier 2026-08-11.
export const maxDuration = 300

const MISSION_COLS = 'id, source, source_format, raw_content, external_id, mission_type, status, loaded_at, vr_proposed, assigned_to, ' +
  'vehicle_vin, vehicle_mileage, incident_description, vehicle_brand, vehicle_model, panne_motif'

async function loadContext(missionId: string, email: string) {
  const sb = createAdminClient()
  const { data: actor } = await sb.from('users')
    .select('id, name, role, roles').eq('email', email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions').select(MISSION_COLS).eq('id', missionId).maybeSingle()
  return { sb, actor, m }
}

// ── GET : de quoi peindre la page Action ──────────────────────────────────────
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sb, actor, m } = await loadContext(params.id, session.user.email)
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!(await flux2Enabled(actor as any, m as any))) {
    return NextResponse.json({ error: 'Flux 2 non activé pour cette mission' }, { status: 403 })
  }

  // Sous-requête : garages proposés par Touring pour CE motif. Les codes panne
  // pilotent la liste → on les résout ici, côté serveur (le client n'en voit aucun).
  const url = new URL(req.url)
  if (url.searchParams.get('garages')) {
    const branch = url.searchParams.get('branch') as any
    const motif  = branch ? findMotif(branch, String(url.searchParams.get('motifKey') || '')) : undefined
    if (!motif) return NextResponse.json({ providers: [] })
    const keys = parseComexKeys((m as any).raw_content)
    if (!keys) return NextResponse.json({ providers: [] })
    try {
      const session = await loginComex('user')
      const providers = await getComexProviders(session, keys, motif.touring)
      return NextResponse.json({ providers })
    } catch { return NextResponse.json({ providers: [] }) }
  }

  // Codes deja encodes sur une jambe precedente (DSP -> REM). Un REM envoye
  // DIRECTEMENT par Touring n'en a aucun : dans ce cas la livraison doit demander
  // le motif, sinon on clotûrerait en « cause inconnue ». Olivier 2026-08-11.
  const { data: prev } = await sb.from('mission_logs')
    .select('metadata').eq('mission_id', (m as any).id).eq('action', 'touring_closed')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const pm: any = (prev as any)?.metadata
  const hasPrefill = !!(pm?.cause && pm?.desc && pm?.result)

  // Codes de fin réellement autorisés par l'assistance sur CE dossier (déjà présents
  // dans le detail COMEX stocké). On n'affiche pas une issue que Touring refusera :
  // mieux vaut ne pas la proposer que de la faire échouer sous le pouce du chauffeur.
  // Ex. réel : une jambe REM autorise 00/07 mais PAS 05 → « Mise en parc » masquée.
  let allowedFins: string[] = []
  try {
    const raw = JSON.parse((m as any).raw_content || '{}')
    allowedFins = String(raw?.LST_CODE_END_MIS || '').split(';').map((x: string) => x.trim()).filter(Boolean)
  } catch { /* raw_content non JSON → on n'impose rien */ }

  // ⚠️ Le code 05 (Fin Remorquage + Transfert = mise en parc) n'apparaît dans la
  // liste QU'APRÈS la « Fin Technique Dépôt » (Olivier 2026-08-11). Or c'est
  // justement ce que notre clôture arme elle-même (endTech FL_TECH_END_MIS:1).
  // Le filtrer sur son absence reviendrait à masquer une issue parfaitement
  // valide : on l'exempte.
  const UNLOCKED_LATER = new Set(['05'])
  const outcomes = availableOutcomes(m as any)
    .filter(o => allowedFins.length === 0 || o.fin === null
      || allowedFins.includes(o.fin) || UNLOCKED_LATER.has(o.fin))
  const dprCodes = allowedFins.length === 0
    ? DPR_END_CODES
    : DPR_END_CODES.filter(d => allowedFins.includes(d.code))

  // Motif déjà choisi sur la 1re jambe (transformation en remorquage) : à la
  // livraison, on le REPROPOSE sélectionné au lieu de refaire choisir. Vu en test
  // le 12/08 : sur une mission sans codes Touring, l'écran de livraison repartait
  // d'une liste vierge alors que le chauffeur avait déjà répondu. Il peut toujours
  // en changer. Olivier 2026-08-12.
  const priorMotif = String((m as any).panne_motif || '')
  const priorMotifKey = priorMotif && findMotif('remorquage', priorMotif) ? priorMotif : null

  return NextResponse.json({
    hasPrefill,
    priorMotifKey,
    allowedFins,
    assistance: flux2AssistanceOf(m as any),
    outcomes:   outcomes
      .filter(o => o.key !== 'dpr' || dprCodes.length > 0)
      .map(o => ({ key: o.key, label: o.label, icon: o.icon, group: o.group })),
    dprCodes,
    fallback:   { vin: (m as any).vehicle_vin || '', km: (m as any).vehicle_mileage ?? '' },
    description: (m as any).incident_description || '',
  })
}

// ── POST : tronc commun + transformation assistance ──────────────────────────
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sb, actor, m } = await loadContext(params.id, session.user.email)
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!(await flux2Enabled(actor as any, m as any))) {
    return NextResponse.json({ error: 'Flux 2 non activé pour cette mission' }, { status: 403 })
  }

  const body     = await req.json().catch(() => ({}))
  const outcome  = String(body?.outcome || '') as Outcome
  if (!OUTCOMES[outcome]) return NextResponse.json({ error: 'Issue inconnue' }, { status: 400 })

  const branch   = branchOf(outcome)
  const motifKey = body?.motifKey ? String(body.motifKey) : null
  if (needsMotif(outcome) && branch && (!motifKey || !findMotif(branch, motifKey))) {
    return NextResponse.json({ error: 'Motif absent ou hors branche' }, { status: 400 })
  }
  // Livraison : soit on reprend les codes de la 1re jambe, soit le chauffeur a
  // choisi un motif (REM natif Touring). Jamais de clôture en « cause inconnue ».
  if (outcome === 'delivered' && motifKey && !findMotif('remorquage', motifKey)) {
    return NextResponse.json({ error: 'Motif hors branche' }, { status: 400 })
  }

  // ── Tronc commun (collecté pour TOUTES les assistances, même si celle du jour
  //    n'en demande qu'une partie — c'est de l'info précieuse pour le dispatch).
  const common = body?.common || {}
  const km  = common.km === '' || common.km == null ? null : Number(common.km)

  // ── CHÂSSIS : le chauffeur saisit les 5 DERNIERS chiffres — c'est une
  // VÉRIFICATION terrain (comme le CheckVin VAB), PAS un numéro de châssis.
  //   • ne jamais écraser le VIN complet de la fiche avec ce fragment ;
  //   • ne jamais l'envoyer à l'assistance : COMEX rejette tout ce qui ne fait pas
  //     17 caractères et le remplace par 17×'X' — on lui enverrait un faux châssis.
  // On envoie donc le VIN COMPLET (fiche ou OCR), et on se sert des 5 chiffres pour
  // détecter un désaccord, qui est signalé au dispatch. Olivier 2026-08-11.
  const vin5      = String(common.vin || '').trim().toUpperCase()
  const ficheVin  = String((m as any).vehicle_vin || '').trim().toUpperCase()
  const isFullVin = (v: string) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v)
  let vin: string | null = null
  let vinMismatch = false
  if (isFullVin(vin5))          vin = vin5              // le chauffeur a saisi le VIN entier
  else if (isFullVin(ficheVin)) {
    vin = ficheVin
    if (vin5.length >= 3 && !ficheVin.endsWith(vin5)) vinMismatch = true
  }

  // Chaque information va dans SA colonne — comme le fait déjà driver-action, qui
  // éclate `closing_data` (payload, pas colonne) en champs réels de la fiche.
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  // On n'écrit le châssis QUE s'il est complet et que la fiche n'en a pas.
  if (vin && isFullVin(vin) && !isFullVin(ficheVin)) patch.vehicle_vin = vin
  if (km != null && Number.isFinite(km)) patch.vehicle_mileage = km
  if (common.vehicleLocation)            patch.vehicle_location  = String(common.vehicleLocation)
  if (common.keyRecovered != null)       patch.key_recovered     = !!common.keyRecovered
  if (common.keyLocation)                patch.key_location      = String(common.keyLocation)
  if (common.remark)                     patch.closing_notes     = String(common.remark)
  if (common.signaturePng)               patch.client_signature  = String(common.signaturePng)

  // Motif de panne : donnée VD Soft, quelle que soit l'assistance. Pour Touring et
  // VAB il alimente aussi leurs codes ; pour Kaze, Allianz et le privé il n'existe
  // aucun référentiel externe — il documente la fiche et s'arrête là.
  // ⚠️ `delivered` n'a pas de branche (les codes viennent en principe de la 1re
  // jambe), MAIS quand il n'y a rien à reprendre le chauffeur choisit un motif —
  // et il faut l'enregistrer. Sans ça, une livraison sans jambe précédente
  // (ANWB, Kaze, REM natif) perdait le motif : vu en vrai le 12/08 sur MTTX03.
  const motifBranch = branch || (outcome === 'delivered' ? 'remorquage' : null)
  const chosenMotif = motifBranch && motifKey ? findMotif(motifBranch, motifKey) : undefined
  if (chosenMotif) {
    patch.panne_motif       = chosenMotif.key
    patch.panne_motif_label = chosenMotif.label
  } else if (outcome === 'dpr' && body?.dprCode) {
    const d = DPR_END_CODES.find(x => x.code === String(body.dprCode))
    patch.panne_motif       = `dpr_${body.dprCode}`
    patch.panne_motif_label = d?.label || 'Déplacement pour rien'
  }

  // Transformation en remorquage : la fiche suit (type + destination), comme le
  // fait déjà le flux actuel après une clôture +REM.
  const dest = body?.destination
  if (outcomeIsRem(outcome)) {
    patch.mission_type = 'remorquage'
    if (dest?.address) {
      patch.destination_address = dest.address
      if (Number.isFinite(dest.lat)) patch.destination_lat = dest.lat
      if (Number.isFinite(dest.lng)) patch.destination_lng = dest.lng
    }
  }

  // ── SIABIS : le cycle est connu → le scénario tarifaire aussi ─────────────
  // Le bouton de paiement ne doit apparaître qu'une fois le cycle COMPLET connu
  // (Olivier 2026-08-13) : un dépannage confirmé, ou un remorquage dont on tient
  // l'adresse de destination. C'est exactement ce que dit l'issue choisie ici —
  // on la traduit en scénario, et le montant se calcule dans la foulée (le PATCH
  // fiche recalcule amount_to_collect sur ces champs).
  //   • dépannage confirmé (ou remorquage annulé, le client repart) → dsp
  //   • remorquage avec destination : rem_direct si COUVERT, rem_client sinon
  //   • mise en parc : le client règle au bureau                    → rem_depot
  //
  // ⚠️ Le remorquage a DEUX scénarios, et on posait `rem_client` dans les deux
  // cas. Or `rem_direct` est celui du Siabis COUVERT (formule assistance) et
  // `rem_client` celui du non couvert (dépôt → intervention → destination →
  // dépôt). Résultat : sur un couvert, Olivier devait corriger le scénario à la
  // main pour pouvoir facturer — vu le 16/08 sur 2HDJ908. Olivier.
  const siabisSrc = (m as any).source === 'police_snc' || (m as any).source === 'sia_couvert'
  if (siabisSrc) {
    const couvert = (m as any).source === 'sia_couvert'
    if (outcome === 'dsp' || outcome === 'rem2dsp')            patch.snc_scenario = 'dsp'
    else if (outcomeIsRem(outcome) && patch.destination_address) patch.snc_scenario = couvert ? 'rem_direct' : 'rem_client'
    else if (outcome === 'park')                                patch.snc_scenario = 'rem_depot'
  }

  await sb.from('incoming_missions').update(patch).eq('id', (m as any).id)

  // Le scénario vient de changer → le montant à réclamer doit suivre TOUT DE
  // SUITE (le recalcul vit dans la route PATCH de la fiche, pas dans un trigger).
  if (siabisSrc && patch.snc_scenario) {
    try {
      const { computeSncAmountToCollect } = await import('@/lib/snc/amount')
      const { data: fresh } = await sb.from('incoming_missions')
        .select('source, snc_scenario, snc_requires_balisage, amount_to_collect_manual, incident_lat, incident_lng, destination_lat, destination_lng, intervention_date, received_at, extra_addresses, billed_to_id, billed_to_name')
        .eq('id', (m as any).id).maybeSingle()
      const f: any = fresh || {}
      if (f.source === 'police_snc' && f.amount_to_collect_manual !== true) {
        if (f.snc_scenario === 'rem_depot') {
          await sb.from('incoming_missions').update({ amount_to_collect: null }).eq('id', (m as any).id)
        } else {
          const amt = await computeSncAmountToCollect(f, f.snc_scenario)
          if (amt != null && amt > 0) await sb.from('incoming_missions').update({ amount_to_collect: amt }).eq('id', (m as any).id)
        }
      }
    } catch (e: any) {
      console.warn('[cloture] recalcul montant Siabis KO (non bloquant):', e?.message)
    }
  }

  // ── Transformation propre à l'assistance ───────────────────────────────────
  // ÉCHAPPATOIRE : quand la plateforme de l'assistance est en panne (COMEX
  // injoignable, session refusée…), on ne piège pas le chauffeur sur la route.
  // Il continue sa clôture VD Soft ; le dispatch clôturera chez l'assistance
  // quand elle sera revenue. Le tronc commun est déjà enregistré ci-dessus.
  // Olivier 2026-08-11 (panne COMEX pendant le 1er test de Franck).
  const skipAssistance = body?.skipAssistance === true
  const assistance = flux2AssistanceOf(m as any)
  let result: any = { ok: true, skipped: true }

  let prefill: { cause: string; desc: string; result: string } | null = null
  if (outcome === 'delivered') {
    const { data: last } = await sb.from('mission_logs')
      .select('metadata').eq('mission_id', (m as any).id).eq('action', 'touring_closed')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const md: any = (last as any)?.metadata
    if (md?.cause && md?.desc && md?.result) prefill = { cause: md.cause, desc: md.desc, result: md.result }
  }

  let queued = false

  if (skipAssistance) {
    result = { ok: true, skipped: 'assistance', finCode: null, codes: null }
  } else if (assistance === 'touring') {
    const keys = parseComexKeys((m as any).raw_content)
    // ⚠️ Une mission Touring reçue par MAIL n'a pas de dossier COMEX : il n'y a
    // rien à clôturer chez eux. Ce n'était pas un incident, mais on renvoyait une
    // erreur — le chauffeur voyait un bandeau rouge « Clés Touring absentes de la
    // fiche » au moment de terminer. Notre plomberie ne le regarde pas, et il n'y
    // a rien à faire. Vu par Franck le 14/08 sur 1UXZ479. Olivier : « il ne faut
    // pas qu'il y ait ça. »
    if (!keys) {
      await sb.from('mission_logs').insert({
        mission_id: (m as any).id, actor_id: (actor as any)?.id ?? null,
        action: 'assistance_close_na',
        notes: 'Touring : pas de dossier COMEX sur cette mission (reçue par mail) — rien à clôturer chez eux',
        metadata: { assistance: 'touring', outcome },
      }).then(() => {}, () => {})
      result = { ok: true, skipped: 'sans_dossier', finCode: null, codes: null }
    } else {
    const input = {
      outcome, motifKey, prefill,
      dprCode: body?.dprCode ?? null,
      vin, km,
      toCidIntv: body?.toCidIntv ?? null,
      manualAddress: body?.manualAddress ?? null,
      comment: body?.comment ?? null,
    }
    result = await transformTouring(keys, input)

    // ── UNE APPLICATION TIERCE NE BLOQUE JAMAIS LE CHAUFFEUR (Olivier 2026-08-11).
    // Panne / session refusée / timeout → on MÉMORISE la clôture et on laisse le
    // chauffeur terminer sa mission. Le cron `assistance-close-retry` la rejouera
    // dès que la plateforme répond. Un refus MÉTIER (code de fin non autorisé sur
    // ce dossier) n'est pas mis en file : le rejouer ne changerait rien.
    if (!result.ok && isRetryable(result.error)) {
      await enqueueClose({
        missionId: (m as any).id, assistance: 'touring', input,
        rawContent: (m as any).raw_content, actorId: (actor as any)?.id, error: result.error,
      })
      queued = true
      result = { ...result, ok: true, queued: true }
    }
    }
  }
  // ── VAB : brique ON-SITE → ÉCRAN DE CODE (pilotage Chromium headless) ──────
  // 60-90 s de run : on la lance en TÂCHE DE FOND et on répond tout de suite au
  // chauffeur. Il a terminé sa mission ; ce qui se passe chez VAB ne le regarde pas.
  // Mission vélo (« Fiets ») = pas de compteur → km/VIN vides, le closer saute
  // ces étapes. Le verrou du compte partagé est géré dans runVabOnSite.
  else if (assistance === 'vab') {
    // Deux moments, deux séquences chez VAB (Olivier 2026-08-12) :
    //   • le véhicule est ARRIVÉ (livré, ou déposé dans notre parc) → c'est la
    //     clôture du REMORQUAGE qu'ils attendent — ce que faisait l'ancien bouton
    //     flottant, retiré : ça doit être automatique et invisible ;
    //   • sinon (dépannage sur place, transformation) → la brique ON-SITE, qui
    //     amène la mission jusqu'à l'écran de code.
    const isTow = String((m as any).mission_type || '').toLowerCase().includes('remorquage')
    const arrived = outcome === 'delivered' || outcome === 'park'
    const vabTask = (isTow && arrived
      ? runVabTowClose({
          missionId:       (m as any).id,
          externalId:      (m as any).external_id,
          vehicleLocation: common.vehicleLocation ?? null,
          keyLocation:     common.keyLocation ?? null,
          keyRecovered:    common.keyRecovered ?? null,
          signature:       common.signature ?? null,
          actorId:         (actor as any)?.id ?? null,
        })
      : runVabOnSite({
          missionId:     (m as any).id,
          externalId:    (m as any).external_id,
          km:            km ?? null,
          vinLastDigits: vin5 || null,
          actorId:       (actor as any)?.id ?? null,
        })
    ).catch(() => {})
    try { const { waitUntil } = await import('@vercel/functions'); waitUntil(vabTask) } catch { /* hors Vercel */ }
    result = { ok: true, queuedVab: true, vabStep: isTow && arrived ? 'tow_close' : 'on_site' }
  }
  // ── TOUTE AUTRE ASSISTANCE : aucun appel externe ──────────────────────────
  // C'est le cas par DÉFAUT, pas une liste à maintenir (Olivier 2026-08-12) :
  // « les chauffeurs voient les mêmes écrans partout, et ça alimente notre fiche ».
  // Kaze, Mondial/Allianz, ANWB, privé, police… passent par les mêmes écrans, et
  // le flux 2 se contente d'enregistrer le motif de panne et le tronc commun.
  // Leur clôture réelle, quand elle existe, se joue AILLEURS et ne doit pas être
  // doublée :
  //   • Kaze est synchronisé par `driver-action` (advanceKazeMissionForAction) ;
  //   • AXA go&assist également, par le hook `closeAxaBg` ;
  //   • Mondial / Allianz se clôture à la FACTURATION via Hexalite ;
  //   • ANWB, privé, police… n'ont pas de plateforme : la fiche VD Soft suffit.
  else {
    result = { ok: true, skipped: 'aucune plateforme à appeler', internalOnly: true }
  }

  // La clôture de l'ACTION DE SUIVI (même dossier, seq 200 → 201) se préremplit
  // depuis le dernier log `touring_closed`. Sans cette trace au format attendu, le
  // chauffeur devrait ré-encoder les codes sur la 2e jambe. Olivier 2026-08-07.
  if (result.ok && assistance === 'touring' && result.codes) {
    await sb.from('mission_logs').insert({
      mission_id: (m as any).id,
      actor_id:   (actor as any)?.id,
      action:     'touring_closed',
      notes:      `Clôture Touring (flux 2) — code ${result.finCode} (codes ${result.codes.cause}/${result.codes.desc}/${result.codes.result})`,
      metadata: {
        finCode: result.finCode, cause: result.codes.cause, desc: result.codes.desc, result: result.codes.result,
        toCidIntv: body?.toCidIntv || null, km, vin,
        statusBefore: result.statusBefore, statusAfter: result.statusAfter, flux2: true,
      },
    }).then(() => {}, () => {})
  }

  if (vinMismatch) {
    await sb.from('mission_logs').insert({
      mission_id: (m as any).id, actor_id: (actor as any)?.id, action: 'vin_mismatch',
      notes: `⚠️ Châssis : le chauffeur a relevé « …${vin5} » mais le dossier porte ${ficheVin}. Vérifier qu'il s'agit du bon véhicule.`,
      metadata: { vin5, ficheVin },
    }).then(() => {}, () => {})
  }

  await sb.from('mission_logs').insert({
    mission_id: (m as any).id,
    actor_id:   (actor as any)?.id,
    action:     result.ok ? 'flux2_closed' : 'flux2_close_failed',
    notes: !result.ok
      ? `Échec clôture (flux 2) — ${result.error || 'erreur inconnue'}`
      : (result as any).internalOnly
        ? `Clôture (flux 2) — ${OUTCOMES[outcome].label}${patch.panne_motif_label ? ` · ${patch.panne_motif_label}` : ''} — panne enregistrée dans VD Soft (${assistance} se clôture par son propre canal)`
      : queued
        ? `Clôture (flux 2) — ${OUTCOMES[outcome].label}${motifKey ? ` · ${motifKey}` : ''} — ⏳ ${assistance ?? 'assistance'} injoignable : mise en file, rattrapage automatique`
        : skipAssistance
        ? `Clôture (flux 2) — ${OUTCOMES[outcome].label}${motifKey ? ` · ${motifKey}` : ''} — ⚠️ NON clôturée chez ${assistance ?? "l'assistance"} (plateforme injoignable) : à clôturer par le dispatch`
        : `Clôture (flux 2) — ${OUTCOMES[outcome].label}${motifKey ? ` · ${motifKey}` : ''}`,
    metadata: {
      outcome, motifKey, assistance, result, skipAssistance, queued,
      // Tronc commun consigné en entier : ce que l'assistance du jour n'exige pas
      // reste lisible pour le dispatch (signature refusée, clé restée au client…).
      vin5, vinMismatch, diag: body?.diag ?? null,
      common: {
        signature: common.signature ?? null,        // 'signed' | 'refus' | 'absent'
        keyRecovered: common.keyRecovered ?? null,
        keyLocation: common.keyLocation ?? null,
        vehicleLocation: common.vehicleLocation ?? null,
        vin, km, remark: common.remark ?? null,
      },
    },
  }).then(() => {}, () => {})

  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
