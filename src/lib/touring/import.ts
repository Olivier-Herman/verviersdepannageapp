// src/lib/touring/import.ts
//
// Import des missions Touring depuis COMEX → fiches VD Soft (source 'touring').
// Scope « parsing → acceptation » : on ne crée QUE les missions À VALIDER
// (COD_STATUT_MTR = 03) en statut VD Soft 'new'. Les 04 (acceptée) / 05 (en
// route) / 06 (sur place) sont déjà gérées côté COMEX pendant la transition ;
// 07 (terminée) est exclue. La validation dans VD Soft déclenchera l'acceptation
// COMEX (à brancher ensuite).
//
// Dédoublonnage : external_id = NUM_COMMANDE (même réf « …MA » que les mails
// Touring) → si l'email (roue de secours) a déjà créé la fiche, on ne double pas.

import { createAdminClient } from '@/lib/supabase'
import { loginComex, listComexMissions, getComexMissionDetail } from './comex'
import { mapComexToMission, comexVehiculeNonCouvert, comexVrPropose } from './map-mission'
import { mapComexVr } from './vr'

export type TouringImportMode = 'preview' | 'send'

const STATUT_A_VALIDER = '03'

// Champs de CONTENU écrasés par COMEX (maître) quand on adopte une fiche mail
// encore « à valider ». On EXCLUT tout l'opérationnel : id, status, mission_number,
// assigned_to/at, accepted_at, received_at, intervention_date, dispatch_mode, parc…
const COMEX_OVERWRITE_FIELDS = [
  'dossier_number', 'mission_type', 'incident_type', 'incident_description',
  'client_name', 'client_phone', 'client_email', 'assisted_name',
  'vehicle_plate', 'vehicle_brand', 'vehicle_model', 'vehicle_vin', 'vehicle_fuel', 'vehicle_gearbox',
  'incident_address', 'incident_city', 'incident_lat', 'incident_lng',
  'destination_name', 'destination_address', 'destination_lat', 'destination_lng',
  'billed_to_id', 'billed_to_name', 'parse_confidence', 'touring_vr',
  // Contrat + droit au véhicule de remplacement : sans ça, une fiche arrivée par
  // mail puis adoptée par COMEX n'aurait jamais l'info (elle ne passe pas par
  // l'insert). NB : vr_proposed = false est une valeur utile, pas un vide — le
  // filtre ci-dessous la laisse passer, contrairement à null (= « ? »).
  'contract_code', 'contract_label', 'vr_proposed',
]

export interface TouringImportResult {
  ok:        boolean
  mode:      TouringImportMode
  total:     number   // missions COMEX visibles
  aValider:  number   // statut 03
  created:   number
  linked:    number   // fiche mail existante ADOPTÉE (clés COMEX attachées)
  skipped:   number   // déjà en base (déjà liée COMEX)
  failed:    number
  results:   Array<{ dossier: string; plaque: string; action: 'created' | 'linked' | 'would_create' | 'would_link' | 'skipped' | 'failed'; external_id?: string; reason?: string; error?: string }>
}

export async function runTouringImport(opts: { mode: TouringImportMode }): Promise<TouringImportResult> {
  const mode = opts.mode
  const sb = createAdminClient()

  const session  = await loginComex('dispatch')
  const missions = await listComexMissions(session)
  const toValidate = missions.filter(m => m.COD_STATUT_MTR === STATUT_A_VALIDER)

  // billed_to par défaut de la source touring (catalog).
  const { data: cat } = await sb.from('mission_source_catalog')
    .select('default_billed_to_id, default_billed_to_name').eq('key', 'touring').maybeSingle()
  const billedToId   = (cat as any)?.default_billed_to_id || null
  const billedToName = (cat as any)?.default_billed_to_name || null

  const results: TouringImportResult['results'] = []
  let created = 0, linked = 0, skipped = 0, failed = 0

  for (const m of toValidate) {
    try {
      const detailRes = await getComexMissionDetail(session, { CID_DOS: m.CID_DOS, CID_SEQ_ACTION: m.CID_SEQ_ACTION })
      const detail = (detailRes?.content || detailRes || {}) as Record<string, any>
      // On garantit la présence des clés COMEX dans le payload stocké (raw_content)
      // pour que la validation puisse déclencher l'accept (acceptTouringBg les lit).
      const comexRaw = JSON.stringify({ ...detail, CID_DOS: m.CID_DOS, CID_SEQ_ACTION: m.CID_SEQ_ACTION })

      const numCommande = String(detail.NUM_COMMANDE || '').trim()
      const externalId  = numCommande || `${m.CID_DOS}/${m.CID_SEQ_ACTION}`

      // Dédup : fiche déjà présente (import COMEX précédent OU mail Touring).
      const { data: existing } = await sb.from('incoming_missions')
        .select('id, status, source_format, source')
        .eq('external_id', externalId)
        .maybeSingle()
      if (existing) {
        // Déjà liée à COMEX → rien à faire.
        if ((existing as any).source_format === 'comex') {
          results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'skipped', external_id: externalId, reason: 'déjà liée COMEX' })
          skipped++
          continue
        }
        // Fiche créée par le MAIL → COMEX EST MAÎTRE. On la lie à COMEX et, si elle
        // est encore « à valider » (new/dispatching), on écrase ses champs de CONTENU
        // par les données COMEX structurées (plus fiables que le parsing IA). Si elle
        // est plus avancée (assignée/en cours), on n'attache QUE les clés COMEX
        // (source_format + raw_content) pour ne pas perturber l'opérationnel.
        if (mode === 'preview') {
          results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'would_link', external_id: externalId, reason: 'fiche mail → COMEX maître' })
          continue
        }
        // 1) LIEN COMEX ESSENTIEL (isolé) : source_format + raw_content. C'est ce qui
        //    permet à « Valider » de déclencher l'accept COMEX. On le fait en premier
        //    et seul, pour qu'il persiste quoi qu'il arrive ensuite.
        const { error: linkErr } = await sb.from('incoming_missions')
          .update({ source_format: 'comex', raw_content: comexRaw, updated_at: new Date().toISOString() })
          .eq('id', (existing as any).id)
        if (linkErr) {
          results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'failed', external_id: externalId, error: linkErr.message })
          failed++
          continue
        }
        // 2) COMEX MAÎTRE (contenu) si encore à valider — best effort, n'empêche pas
        //    le lien ci-dessus. Écrase les champs de contenu par les données COMEX.
        const earlyStatus = ['new', 'dispatching'].includes(String((existing as any).status))
        if (earlyStatus) {
          const mapped = mapComexToMission({ detail, status: 'new', billedToId, billedToName })
          const contentUpd: Record<string, any> = {}
          for (const f of COMEX_OVERWRITE_FIELDS) {
            const v = (mapped as any)[f]
            if (v !== undefined && v !== null && v !== '') contentUpd[f] = v   // COMEX gagne là où il a une valeur
          }
          // Touring annonce « véhicule pas couvert » → la fiche est un Siabis non
          // couvert, même si elle est arrivée par mail en tant que dossier Touring.
          // Volontairement conditionné à source === 'touring' : si un dispatcher
          // l'a déjà reclassée à la main, on ne repasse pas derrière lui.
          if (comexVehiculeNonCouvert(detail) && String((existing as any).source) === 'touring') {
            contentUpd.source = 'police_snc'
          }
          if (Object.keys(contentUpd).length > 0) {
            const { error: cErr } = await sb.from('incoming_missions').update(contentUpd).eq('id', (existing as any).id)
            if (cErr) console.warn('[touring import] overwrite contenu KO (lien COMEX OK):', cErr.message)
          }
        }
        results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'linked', external_id: externalId, reason: earlyStatus ? 'fiche mail pilotée par COMEX' : 'clés COMEX attachées' })
        linked++
        continue
      }

      // ── Étape 1 — Chaînage par COMMANDE (dossier 2026BE/BX) ───────────────
      // L'action (…MA) ci-dessus est inconnue en base. Mais 2026BE/BX = n° de
      // COMMANDE (constant tout le cycle) tandis que …MA = n° d'ACTION (change à
      // chaque étape DSP→REM→Transfert). Si une fiche ACTIVE du MÊME dossier
      // existe déjà (le chauffeur bosse dessus), cette nouvelle action = SUCCESSION
      // du cycle, PAS un nouveau dossier. On ADOPTE l'action courante sur la fiche
      // active (raw_content → séquence LIVE) au lieu de créer une fiche orpheline à
      // fusionner à la main → supprime le doublon ET route les pointages vers
      // l'action vivante (fin des COMEX 500 sur une séquence clôturée). Garde
      // anti-recul : on n'avance que vers une action plus récente (jamais de
      // flip-flop). VR = système à part (n'apparaît pas dans ce loop « 03 à
      // valider »). Olivier 2026-08-09 — cf project_touring_lifecycle_chainage.
      if (m.CID_DOS) {
        const { data: lineage } = await sb.from('incoming_missions')
          .select('id, status, mission_number, raw_content')
          .eq('dossier_number', m.CID_DOS)
          .not('status', 'in', '(cancelled,completed,to_invoice,invoiced,ignored,deleted)')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (lineage) {
          const lin = lineage as any
          let curSeq = -1
          try { curSeq = parseInt(String(JSON.parse(lin.raw_content || '{}').CID_SEQ_ACTION || ''), 10) } catch { /* raw_content non-JSON */ }
          const newSeq = parseInt(String(m.CID_SEQ_ACTION), 10)
          // Fiche déjà sur cette action (ou une plus récente) → rien à faire.
          if (!(Number.isFinite(newSeq) && (curSeq < 0 || newSeq > curSeq))) {
            results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'skipped', external_id: externalId, reason: `commande déjà sur action ${curSeq} (≥ ${newSeq})` })
            skipped++
            continue
          }
          if (mode === 'preview') {
            results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'would_link', external_id: externalId, reason: `action ${m.CID_SEQ_ACTION} → commande active (fiche #${lin.mission_number})` })
            continue
          }
          // On rafraîchit AUSSI les drapeaux VR depuis l'action courante : la
          // demande de VR vit sur l'action REM (pas sur l'action DSP d'origine).
          // Sans ça, la fiche active garderait touring_vr={vr:0} et ne deviendrait
          // jamais candidate au scan VR → notif chauffeur perdue (étape 2).
          const adoptPayload: Record<string, any> = {
            source_format: 'comex', raw_content: comexRaw,
            touring_vr: mapComexVr(detail), updated_at: new Date().toISOString(),
          }
          const vrProp = comexVrPropose(detail)
          if (vrProp !== null) adoptPayload.vr_proposed = vrProp
          const { error: adoptErr } = await sb.from('incoming_missions')
            .update(adoptPayload)
            .eq('id', lin.id)
          if (adoptErr) {
            results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'failed', external_id: externalId, error: adoptErr.message })
            failed++
          } else {
            results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'linked', external_id: externalId, reason: `action ${m.CID_SEQ_ACTION} rattachée à la commande (fiche #${lin.mission_number}, séq ${curSeq}→${newSeq})` })
            linked++
          }
          continue
        }
      }

      if (mode === 'preview') {
        results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'would_create', external_id: externalId })
        continue
      }

      const payload = mapComexToMission({ detail, status: 'new', billedToId, billedToName })
      payload.external_id  = externalId          // NUM_COMMANDE prioritaire (dédup email)
      payload.dispatch_mode = 'manual'
      payload.raw_content   = comexRaw           // clés COMEX garanties pour l'accept

      const { error } = await sb.from('incoming_missions').insert(payload)
      if (error) {
        results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'failed', external_id: externalId, error: error.message })
        failed++
      } else {
        results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'created', external_id: externalId })
        created++
      }
    } catch (e: any) {
      results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'failed', error: e?.message || 'erreur' })
      failed++
    }
  }

  return { ok: true, mode, total: missions.length, aValider: toValidate.length, created, linked, skipped, failed, results }
}
