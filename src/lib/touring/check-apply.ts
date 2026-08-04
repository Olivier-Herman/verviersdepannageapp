// src/lib/touring/check-apply.ts
//
// Applique la réponse de Touring à un dossier « Check Touring ». Semi-validation :
// appelé seulement quand le superadmin clique « Appliquer ».

import { markInvoicedOK, markNoCharge, stampMissions, autoInvoiceMission, addBillingRemark } from './check-billing'

export type CheckResponseCode =
  | 'already_invoiced'      // Déjà facturé (+ n° accord)
  | 'not_covered'           // Contrat 105 non couvert
  | 'invoice_hors_comex'    // À facturer hors comex
  | 'deplacement_hors_comex'// Déplacement à facturer hors comex
  | 'other'                 // Autre (+ texte libre)

export const RESPONSE_LABELS: Record<CheckResponseCode, string> = {
  already_invoiced:       'Déjà facturé',
  not_covered:            'Contrat 105 non couvert',
  invoice_hors_comex:     'À facturer hors comex',
  deplacement_hors_comex: 'Déplacement à facturer hors comex',
  other:                  'Autre',
}

const STAMP_HORS_COMEX = 'À facturer hors comex'
const STAMP_A_VERIFIER  = 'À vérifier'

interface CheckFiche { mission_id: string; mission_type?: string | null; kind?: string }

export interface ApplyOutcome { ok: boolean; result: string }

/**
 * @param item   ligne touring_check_dossiers (avec response_code, response_note, fiches, is_combined)
 * @param actorId superadmin qui applique
 */
export async function applyCheckItem(sb: any, item: any, actorId: string | null): Promise<ApplyOutcome> {
  const code = item.response_code as CheckResponseCode
  const note = String(item.response_note || '').trim()
  const fiches: CheckFiche[] = Array.isArray(item.fiches) ? item.fiches : []
  const ids = fiches.map(f => f.mission_id).filter(Boolean)
  if (!ids.length) return { ok: false, result: 'aucune fiche' }

  switch (code) {
    case 'already_invoiced': {
      if (!note) return { ok: false, result: 'n° d\'accord manquant' }
      let n = 0
      for (const id of ids) {
        const r = await markInvoicedOK(sb, id, `Déjà facturé avec numéro d'accord ${note}`, actorId)
        if (r.ok) n++
      }
      return { ok: true, result: `${n}/${ids.length} fiche(s) → Facturation OK (accord ${note})` }
    }

    case 'not_covered': {
      let n = 0
      for (const id of ids) {
        const r = await markNoCharge(sb, id, 'Non couvert', actorId)
        if (r.ok) n++
      }
      return { ok: true, result: `${n}/${ids.length} fiche(s) → annulées (Non couvert)` }
    }

    case 'invoice_hors_comex': {
      if (item.is_combined || ids.length > 1) {
        await stampMissions(sb, ids, STAMP_HORS_COMEX)
        return { ok: true, result: `dossier combiné → tampon « ${STAMP_HORS_COMEX} » (traitement manuel)` }
      }
      const r = await autoInvoiceMission(ids[0])
      if (r.ok) return { ok: true, result: 'auto-facturation lancée' }
      // Échec (ex. pas de tarif) → tampon pour traitement manuel.
      await stampMissions(sb, ids, STAMP_HORS_COMEX)
      return { ok: true, result: `auto-facturation impossible (${r.reason}) → tampon « ${STAMP_HORS_COMEX} »` }
    }

    case 'deplacement_hors_comex': {
      const results: string[] = []
      for (const f of fiches) {
        if (f.mission_type === 'trajet_vide') {
          const r = await autoInvoiceMission(f.mission_id)
          if (r.ok) { results.push('auto-facturée'); continue }
          await stampMissions(sb, [f.mission_id], STAMP_HORS_COMEX)
          results.push(`auto KO (${r.reason}) → tampon`)
        } else {
          await stampMissions(sb, [f.mission_id], `${STAMP_A_VERIFIER} — type ≠ trajet vide`)
          results.push('type ≠ trajet vide → à vérifier')
        }
      }
      return { ok: true, result: results.join(' · ') }
    }

    case 'other': {
      await stampMissions(sb, ids, STAMP_A_VERIFIER)
      if (note) for (const id of ids) await addBillingRemark(sb, id, `Touring (Check) : ${note}`, actorId)
      return { ok: true, result: `tampon « ${STAMP_A_VERIFIER} »${note ? ' + remarque' : ''} (traitement manuel)` }
    }

    default:
      return { ok: false, result: `réponse inconnue (${code})` }
  }
}
