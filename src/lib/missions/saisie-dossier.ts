// src/lib/missions/saisie-dossier.ts
//
// Logique métier des DOSSIERS DE FACTURATION SAISIE (table saisie_dossiers).
// Machine à états + génération d'état de frais (numérotation EF séquentielle,
// snapshot des lignes, avancement du pipeline). Utilisé par les routes
// /api/fourriere/saisies*. Olivier 2026-08-09.

import { computeSaisieBilling, type SaisieRecipient } from '@/lib/missions/saisie-billing'
import { renderEtatFraisPdf } from '@/lib/missions/saisie-etat-frais-pdf'

// ── Machine à états (pipeline) ───────────────────────────────────────────────
export const SAISIE_STATES = [
  'en_parc', 'a_facturer', 'ef_envoye', 'accepte', 'refuse',
  'justinvoice', 'facture', 'gardiennage_recurrent', 'clos',
] as const
export type SaisieState = typeof SAISIE_STATES[number]

// Destinataires connus (adresses réelles pour le PDF).
export function resolveDestinataire(recipient: SaisieRecipient, mission?: any): { name: string; lines: string[] } {
  if (recipient === 'parquet')
    return { name: 'Parquet', lines: ['Quai d\'Arona 4', '4500 Huy'] }
  if (recipient === 'domaine')
    return { name: 'SPF Finances — Domaine', lines: ['Recette des domaines'] }
  // client : personne sur place / propriétaire
  const name = mission?.billed_to_name || mission?.client_name || 'Client'
  const lines = [mission?.incident_address, mission?.incident_city].filter(Boolean)
  return { name, lines: lines.length ? lines : ['—'] }
}

const belgianToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())

// Franchise km SAISIE : on ne facture les km qu'AU-DELÀ de 30 km ALLER-RETOUR.
// « On les compte au-dessus de 30 kms aller-retour » — Olivier 2026-08-09.
export const SAISIE_FREE_KM = 30

/** Numéro EF suivant : 1er = EF-AAAA-NNNN ; suivants = même n° suffixé -B, -C… */
function suffixed(base: string, seqIndex: number): string {
  if (seqIndex <= 0) return base
  return `${base}-${String.fromCharCode(65 + seqIndex)}`  // -B, -C, -D…
}

export interface GenerateEfResult {
  pdf: Buffer
  numero: string
  totalHtva: number
  totalTvac: number
  efRowId: string
}

/**
 * Génère un état de frais pour un dossier :
 *  - calcule les lignes (dépannage la 1re fois, puis gardiennage depuis billed_to_date)
 *  - attribue/réutilise le numéro EF
 *  - persiste une ligne saisie_etats_frais + avance le dossier
 *  - renvoie le PDF prêt à afficher/envoyer
 */
export async function generateEtatFrais(
  sb: any,
  dossierId: string,
  opts: { billingTo?: string; recipient?: SaisieRecipient; chargedKmBeyond?: number; roundTripKm?: number } = {},
  userId?: string | null,
): Promise<GenerateEfResult> {
  const { data: d, error } = await sb.from('saisie_dossiers').select('*').eq('id', dossierId).maybeSingle()
  if (error || !d) throw new Error('Dossier introuvable')

  const mission = d.mission_id
    ? (await sb.from('incoming_missions')
        .select('client_name, billed_to_name, incident_address, incident_city, vehicle_class')
        .eq('id', d.mission_id).maybeSingle()).data
    : null

  const recipient = (opts.recipient || d.recipient || 'parquet') as SaisieRecipient
  const billingTo = (opts.billingTo || belgianToday()).slice(0, 10)
  const billingFrom = d.billed_to_date || d.parked_at
  const includeDepannage = !d.depannage_billed
  // km facturés = au-delà de 30 km aller-retour (franchise). Priorité à une
  // valeur déjà calculée (chargedKmBeyond), sinon on dérive des km aller-retour.
  const km = opts.chargedKmBeyond != null ? opts.chargedKmBeyond
           : opts.roundTripKm != null ? Math.max(0, opts.roundTripKm - SAISIE_FREE_KM)
           : 0

  const billing = await computeSaisieBilling({
    parkedAt: d.parked_at,
    billingTo,
    billingFrom,
    recipient,
    includeDepannage,
    vehicleClass: mission?.vehicle_class || 'car',
    chargedKmBeyond: km,
    leveeSaisieDate: d.levee_date || null,
  })

  // Numérotation : 1er EF → attribue le n° au dossier. Suivants → suffixe.
  const { count } = await sb.from('saisie_etats_frais').select('id', { count: 'exact', head: true }).eq('dossier_id', dossierId)
  const existing = count || 0
  let base = d.ef_number
  if (!base) {
    const year = Number(billingTo.slice(0, 4))
    const { data: num, error: rpcErr } = await sb.rpc('next_saisie_ef_number', { p_year: year })
    if (rpcErr || !num) throw new Error('Numérotation EF échouée : ' + (rpcErr?.message || ''))
    base = num as string
    await sb.from('saisie_dossiers').update({ ef_number: base }).eq('id', dossierId)
  }
  const numero = suffixed(base, existing)

  const { data: efRow, error: insErr } = await sb.from('saisie_etats_frais').insert({
    dossier_id: dossierId, numero, recipient,
    period_from: billingFrom, period_to: billingTo,
    include_depannage: includeDepannage,
    total_htva: billing.totalHtva, total_tvac: billing.totalTvac,
    lines_json: billing.lines, created_by: userId || null,
  }).select('id').single()
  if (insErr) throw new Error('Insert état de frais échoué : ' + insErr.message)

  // Avancement du dossier : marque le dépannage facturé, la date de coupe, l'état.
  const nextState = ['en_parc', 'a_facturer'].includes(d.state) ? 'ef_envoye' : d.state
  await sb.from('saisie_dossiers').update({
    depannage_billed: d.depannage_billed || includeDepannage,
    billed_to_date: billingTo,
    recipient,
    state: nextState,
    last_ef_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', dossierId)

  const pdf = await renderEtatFraisPdf({
    numero,
    dateEmission: billingTo,
    recipient,
    destinataire: resolveDestinataire(recipient, mission),
    vehicle: { plate: d.vehicle_plate, brand: d.vehicle_brand, model: d.vehicle_model },
    dossierRef: d.dossier_ref,
    parkedAt: d.parked_at,
    billingTo,
    leveeSaisieDate: d.levee_date || null,
    billing,
  })

  return { pdf, numero, totalHtva: billing.totalHtva, totalTvac: billing.totalTvac, efRowId: efRow.id }
}
