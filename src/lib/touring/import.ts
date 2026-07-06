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
import { mapComexToMission } from './map-mission'

export type TouringImportMode = 'preview' | 'send'

const STATUT_A_VALIDER = '03'

export interface TouringImportResult {
  ok:        boolean
  mode:      TouringImportMode
  total:     number   // missions COMEX visibles
  aValider:  number   // statut 03
  created:   number
  skipped:   number   // déjà en base (COMEX ou email)
  failed:    number
  results:   Array<{ dossier: string; plaque: string; action: 'created' | 'skipped' | 'would_create' | 'failed'; external_id?: string; reason?: string; error?: string }>
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
  let created = 0, skipped = 0, failed = 0

  for (const m of toValidate) {
    try {
      const detailRes = await getComexMissionDetail(session, { CID_DOS: m.CID_DOS, CID_SEQ_ACTION: m.CID_SEQ_ACTION })
      const detail = (detailRes?.content || detailRes || {}) as Record<string, any>

      const numCommande = String(detail.NUM_COMMANDE || '').trim()
      const externalId  = numCommande || `${m.CID_DOS}/${m.CID_SEQ_ACTION}`

      // Dédup : fiche déjà présente (COMEX précédent OU email) avec ce même ref.
      const { data: existing } = await sb.from('incoming_missions')
        .select('id, status')
        .eq('external_id', externalId)
        .maybeSingle()
      if (existing) {
        results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'skipped', external_id: externalId, reason: 'déjà en base' })
        skipped++
        continue
      }

      if (mode === 'preview') {
        results.push({ dossier: m.CID_DOS, plaque: m.NUM_PLAQUE, action: 'would_create', external_id: externalId })
        continue
      }

      const payload = mapComexToMission({ detail, status: 'new', billedToId, billedToName })
      payload.external_id  = externalId          // NUM_COMMANDE prioritaire (dédup email)
      payload.dispatch_mode = 'manual'

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

  return { ok: true, mode, total: missions.length, aValider: toValidate.length, created, skipped, failed, results }
}
