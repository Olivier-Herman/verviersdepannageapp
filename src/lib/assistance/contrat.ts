// src/lib/assistance/contrat.ts — contrat de l'assistance affiché sur la fiche (Olivier 15/11/2026, maquette
// https://claude.ai/artifact/XiqZMLRThbQQXGmf3dcre7 validée). Lu sur la plateforme de chaque assistance :
//   Touring (COMEX, dans la mission reçue) · VAB (Comet, page Contrat, à l'import) · AXA (go&assist) · Allianz (Hexalite).
//   IMA (Kaze) ne transmet pas de contrat : seul le payeur est connu.
// Chauffeur : le NOM du contrat et Couvert / Non couvert. Dispatch : tout (police, plafond, franchise, VR, consignes).
// Rangé dans incoming_missions.assistance_contrat (jsonb). Rien n'est inventé : un champ inconnu reste null.

import { createAdminClient } from '@/lib/supabase'

export interface AssistanceContrat {
  assistance: 'touring' | 'vab' | 'axa' | 'allianz' | 'ima'
  nom: string | null              // ce que voit le chauffeur
  couvert: boolean | null         // null = inconnu (pas de pastille)
  assureur?: string | null
  police?: string | null
  dossier?: string | null
  code?: string | null
  vr?: boolean | null             // droit au véhicule de remplacement (Touring)
  preautorise_ttc?: number | null
  plafond_ttc?: number | null
  franchise_ttc?: number | null
  couverture?: { depannage: boolean | null; remorquage: boolean | null; autoroute: boolean | null; paiement: string | null } | null
  consignes?: string[]            // dispatch seulement
  lu_le: string
}

const txt = (v: any) => { const s = String(v ?? '').trim(); return s && s !== 'null' && s !== 'undefined' ? s : null }
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const titre = (s: string | null) => s ? s.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_m, a, b) => a + b.toUpperCase()) : null

/** Touring : la mission COMEX porte le produit (CID_PROD / LIB_PROD) et les fins autorisées (VR). */
export async function contratTouring(d: Record<string, any>, dossier?: string | null): Promise<AssistanceContrat | null> {
  if (!d || (!d.LIB_PROD && !d.CID_PROD)) return null
  const { comexVehiculeNonCouvert, comexVrPropose } = await import('@/lib/touring/map-mission')
  const nonCouvert = comexVehiculeNonCouvert(d)
  const vr = comexVrPropose(d)
  return {
    assistance: 'touring', nom: txt(d.LIB_PROD), code: txt(d.CID_PROD), couvert: !nonCouvert, dossier: dossier || txt(d.NUM_DOSSIER) || null, vr,
    consignes: nonCouvert ? ['Véhicule pas couvert : à encaisser auprès du client, à dire avant le départ.'] : vr ? ['Véhicule de remplacement autorisé par Touring (clôture « + VR »).'] : [],
    lu_le: new Date().toISOString(),
  }
}

/** VAB : page « Contrat » de Comet lue à l'import (code produit + couverture). */
export function contratVab(detail: { contractProductCode?: string | null; contractCoverage?: any; nonCouvert?: { value: boolean; reason: string | null } | null; dossierNumber?: string | null }): AssistanceContrat | null {
  if (!detail?.contractProductCode && !detail?.contractCoverage) return null
  const c = detail.contractCoverage || null
  const consignes: string[] = []
  if (detail.nonCouvert?.value) consignes.push(`Non couvert : ${detail.nonCouvert.reason || 'voir le contrat VAB'}.`)
  else if (c?.autoroute === false) consignes.push('Autoroute non couverte par ce contrat.')
  return {
    assistance: 'vab', nom: txt(detail.contractProductCode), code: txt(detail.contractProductCode), couvert: detail.nonCouvert ? !detail.nonCouvert.value : null,
    dossier: txt(detail.dossierNumber),
    couverture: c ? { depannage: c.depannage ?? null, remorquage: c.remorquage ?? null, autoroute: c.autoroute ?? null, paiement: c.paiement ?? null } : null,
    consignes, lu_le: new Date().toISOString(),
  }
}

/** AXA : go&assist donne l'assureur, la police et les montants autorisés. */
export function contratAxa(m: any): AssistanceContrat | null {
  if (!m?.policy && !m?.quotation) return null
  const q = m.quotation || {}
  const plafond = num(q.coverLimitAmountInclTax?.value), preaut = num(q.preAuthorizedAmountInclTax?.value ?? q.acceptedCoveredAmountInclTax?.value)
  const franchise = num(q.excessAmountInclTax?.value)
  const consignes: string[] = []
  if (plafond) consignes.push(`Plafond ${plafond.toFixed(2).replace('.', ',')} € TVAC : au-delà, accord d'AXA à demander avant.`)
  if (franchise) consignes.push(`Franchise de ${franchise.toFixed(2).replace('.', ',')} € à charge du client.`)
  return {
    assistance: 'axa', nom: titre(txt(m.policy?.partnerName)) || txt(m.policy?.policyType) || null, assureur: titre(txt(m.policy?.partnerName)),
    police: txt(m.policy?.policyNumber), dossier: txt(m.case?.caseId), couvert: preaut != null || plafond != null ? (preaut ?? plafond ?? 0) > 0 : null,
    preautorise_ttc: preaut, plafond_ttc: plafond, franchise_ttc: franchise, consignes, lu_le: new Date().toISOString(),
  }
}

/** Allianz : Hexalite donne le produit et la police de l'affectation. */
export function contratAllianz(a: any): AssistanceContrat | null {
  if (!a?.productName && !a?.policyNumber) return null
  return { assistance: 'allianz', nom: txt(a.productName), police: txt(a.policyNumber), dossier: txt(a.assignmentNumber), couvert: true, consignes: [], lu_le: new Date().toISOString() }
}

/** IMA (Kaze) : pas de contrat transmis ; le payeur seulement. */
export function contratIma(m: { billed_to_name?: string | null }): AssistanceContrat {
  return { assistance: 'ima', nom: null, couvert: null, assureur: txt(m.billed_to_name), consignes: ['IMA ne transmet pas le contrat.'], lu_le: new Date().toISOString() }
}

export async function enregistrerContrat(sb: any, missionId: string, c: AssistanceContrat | null): Promise<void> {
  if (!c) return
  await sb.from('incoming_missions').update({ assistance_contrat: c }).eq('id', missionId)
}

/**
 * Complète le contrat des fiches ouvertes qui n'en ont pas encore (tâche planifiée). Touring : lu dans la mission
 * reçue ; AXA et Allianz : une lecture de leur plateforme ; IMA : le payeur. VAB : à l'import seulement (page Comet).
 */
export async function completerContrats(max = 40): Promise<{ vus: number; remplis: number; erreurs: string[] }> {
  const sb = createAdminClient()
  const { data: ms } = await sb.from('incoming_missions')
    .select('id, source, raw_content, dossier_number, external_id, axa_mission_order_id, kaze_job_id, billed_to_name')
    .is('assistance_contrat', null).eq('dossier_leg', false)
    .in('status', ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering', 'parked'])
    .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order('created_at', { ascending: false }).limit(300)
  let remplis = 0, vus = 0
  const erreurs: string[] = []
  for (const m of (ms || []) as any[]) {
    if (vus >= max) break
    const src = String(m.source || '').toLowerCase()
    let c: AssistanceContrat | null = null
    try {
      if (src === 'touring' || src === 'sia_couvert' || src === 'police_snc') {
        let d: any = null; try { d = JSON.parse(m.raw_content || 'null') } catch { d = null }
        if (d && (d.LIB_PROD || d.CID_PROD)) { vus++; c = await contratTouring(d, m.dossier_number) }
      } else if (m.axa_mission_order_id) {
        vus++
        const { getMission } = await import('@/lib/axa/goassist')
        c = contratAxa(await getMission(m.axa_mission_order_id))
      } else if (src === 'mondial' && /^\d{8,20}$/.test(String(m.external_id || ''))) {
        vus++
        const { fetchAllianzAssignmentByNumber } = await import('@/lib/allianz/intake')
        c = contratAllianz(await fetchAllianzAssignmentByNumber(m.external_id))
      } else if (m.kaze_job_id || ['kaze', 'ethias', 'vivium', 'pv_assistance', 'ima', 'p&v'].includes(src)) {
        c = contratIma(m)
      }
      if (c) { await enregistrerContrat(sb, m.id, c); remplis++ }
    } catch (e: any) { erreurs.push(`${m.id.slice(0, 8)} ${src} : ${String(e?.message || e).slice(0, 120)}`) }
  }
  return { vus, remplis, erreurs }
}
