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
import { branchOf, needsMotif }  from '@/lib/cloture/outcomes'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MISSION_COLS = 'id, source, source_format, raw_content, mission_type, status, loaded_at, vr_proposed, ' +
  'vehicle_vin, vehicle_mileage, incident_description, vehicle_brand, vehicle_model'

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

  return NextResponse.json({
    hasPrefill,
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

  await sb.from('incoming_missions').update(patch).eq('id', (m as any).id)

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
    if (!keys) return NextResponse.json({ error: 'Clés Touring absentes de la fiche' }, { status: 400 })
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
  // VAB / Kaze : leurs transformations viendront ici, gatées par leur propre flag.

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
      : queued
        ? `Clôture (flux 2) — ${OUTCOMES[outcome].label}${motifKey ? ` · ${motifKey}` : ''} — ⏳ ${assistance ?? 'assistance'} injoignable : mise en file, rattrapage automatique`
        : skipAssistance
        ? `Clôture (flux 2) — ${OUTCOMES[outcome].label}${motifKey ? ` · ${motifKey}` : ''} — ⚠️ NON clôturée chez ${assistance ?? "l'assistance"} (plateforme injoignable) : à clôturer par le dispatch`
        : `Clôture (flux 2) — ${OUTCOMES[outcome].label}${motifKey ? ` · ${motifKey}` : ''}`,
    metadata: {
      outcome, motifKey, assistance, result, skipAssistance, queued,
      // Tronc commun consigné en entier : ce que l'assistance du jour n'exige pas
      // reste lisible pour le dispatch (signature refusée, clé restée au client…).
      vin5, vinMismatch,
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
