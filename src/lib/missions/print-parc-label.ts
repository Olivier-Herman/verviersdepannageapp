// src/lib/missions/print-parc-label.ts
//
// Helper centralise pour imprimer une etiquette parc directement depuis VD Soft
// (sans passer par le ticket Helpdesk Odoo). Genere le ZPL via buildParcLabelZPL
// et l envoie au PC Zebra via printZPLRaw.
//
// Olivier 2026-05-26 : chantier "Etiquettes VD Soft globales" - migration
// progressive des sources parc depuis le callback Odoo vers VD Soft direct.
//   - Appel Prive REM depot : migre (Fix 5, 26/05)
//   - SNC / SC rem_depot    : migre via cet helper (Chantier 2, 26/05)
//   - Mal Garee chargement  : TODO (a migrer dans une iteration future)
//   - Rodeo                 : TODO
//   - AVP                   : TODO
//
// Note conditionnelle gere selon source/contexte :
//   - AVP : "AVP DD-MM-YYYY" (date+60j eligibilite destruction)
//   - Vehicule destine a relivraison (SNC rem_depot, Prive depot) :
//       avec adresse -> "Relivraison vers <adresse>"
//       sans         -> "En attente d info adresse de relivraison"
//   - Autres : vide

import { buildParcLabelZPL } from '@/lib/print/zpl-templates/parc-label'
import { printZPLRaw }       from '@/lib/print/zebra-raw'

export interface PrintParcLabelInput {
  missionId:        string                          // id VD Soft (UUID)
  source:           string                          // 'police_mg', 'police_snc', 'sia_couvert', 'prive', etc.
  motif:            string                          // SOURCE colonne droite (ex: 'APPEL PRIVE', 'SIABIS NON COUVERT')
  interventionDate: string                          // ISO date string pour formatter DD/MM/YY
  plate:            string | null                   // immatriculation
  brand:            string | null
  model:            string | null
  vin:              string | null
  redeliveryAddr?:  string | null                   // adresse de relivraison (REM depot)
  isAvp?:           boolean                         // si true, note = AVP date+60j
}

/**
 * Imprime l etiquette parc pour une mission VD Soft. Best-effort : ne fail pas
 * la creation de mission si l impression echoue (log uniquement).
 *
 * Construit l URL du QR vers /dispatch/{missionId} (utilisable autant par
 * dispatcher que chauffeur via redirect).
 */
export async function printVdSoftParcLabel(input: PrintParcLabelInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const dd = new Date(input.interventionDate)
    const dateStr = `${String(dd.getDate()).padStart(2, '0')}/${String(dd.getMonth()+1).padStart(2, '0')}/${String(dd.getFullYear()).slice(-2)}`

    // Note typique selon contexte
    let note = ''
    if (input.isAvp) {
      // AVP : date + 60 jours = eligibilite destruction (accord Ville)
      const eligDate = new Date(input.interventionDate)
      eligDate.setDate(eligDate.getDate() + 60)
      const pad = (n: number) => String(n).padStart(2, '0')
      note = `AVP ${pad(eligDate.getDate())}-${pad(eligDate.getMonth()+1)}-${eligDate.getFullYear()}`
    } else if (input.redeliveryAddr !== undefined) {
      // Sources avec relivraison ulterieure : SNC rem_depot, Prive depot, ...
      note = input.redeliveryAddr && input.redeliveryAddr.trim()
        ? `Relivraison vers ${input.redeliveryAddr.trim()}`
        : 'En attente d info adresse de relivraison'
    }
    // Autres sources : note vide (Mal Garee chargement, etc.)

    const zpl = buildParcLabelZPL({
      qrUrl: `${baseUrl}/dispatch/${input.missionId}`,
      motif: input.motif,
      date:  dateStr,
      note,
      brand: input.brand || '',
      model: input.model || '',
      plate: (input.plate || '').trim().toUpperCase(),
      vin:   (input.vin   || '').trim().toUpperCase(),
    })

    const res = await printZPLRaw(zpl)
    if (res.ok) {
      console.log(`[printVdSoftParcLabel] OK mission=${input.missionId} source=${input.source}`)
      return { ok: true }
    } else {
      console.error(`[printVdSoftParcLabel] FAIL mission=${input.missionId} source=${input.source}:`, res.error)
      return { ok: false, error: res.error }
    }
  } catch (e: any) {
    console.error('[printVdSoftParcLabel] Exception:', e.message)
    return { ok: false, error: e.message }
  }
}
