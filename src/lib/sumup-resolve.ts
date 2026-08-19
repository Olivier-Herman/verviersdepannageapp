// ============================================================
// VERVIERS DÉPANNAGE — Résolution des références SumUp
// ============================================================
//
// Ce qui remonte de SumUp comme référence n'est pas de même nature que chez
// Paynovate. Relevé sur les versements de juin à août 2026 :
//
//   ~45 %  jeton VD Soft          VDMSVZ1H53   ← posé par l'app, infaillible
//   ~30 %  plaque                 2DPU256, 1tcf492, acat161
//   ~20 %  rien du tout           « Montant personnalisé » (libellé par défaut)
//    ~5 %  numéro de facture      2026/08/347  (écran comptoir)
//
// Le jeton VD Soft est le cas qui n'existe pas chez Paynovate, et c'est le
// meilleur : l'app l'a écrit elle-même dans `interventions.payment_reference`
// au moment de lancer le paiement. On remonte donc jeton → encaissement →
// mission → facture, sans la moindre heuristique. Vérifié sur 10 versements :
// 10 factures retrouvées, 10 exactes.
//
// Tout le reste retombe sur la cascade Paynovate (`resolveReference`), qui sait
// déjà lire un numéro de facture, une plaque, une faute de frappe. Inutile de
// la réécrire : elle interroge les mêmes missions et les mêmes factures.

import { odooRpc }           from '@/lib/odoo'
import { createAdminClient } from '@/lib/supabase'
import {
  resolveReference,
  readManualOverride,
  normalizePlate,
  proposeByAmount,
  signedTotal,
  type Resolution,
} from '@/lib/paynovate-resolve'

/**
 * Le jeton posé par VD Soft au lancement d'un paiement SumUp :
 * `VD` + horodatage en base 36 (cf. `startSumup` dans l'écran encaissement).
 * Volontairement permissif — c'est la base de données qui tranche.
 */
const VD_TOKEN = /^VD[A-Z0-9]{6,10}$/i

export const isVdToken = (ref: string) => VD_TOKEN.test(String(ref || '').trim())

/**
 * Un code de transaction SumUp (« TAAA4LQGKXE ») — pas une référence saisie.
 * Il sert de clé de rattachement quand le terminal n'a rien enregistré.
 */
const isTxCode = (ref: string) => /^T[A-Z0-9]{8,}$/.test(String(ref || '').trim())

/**
 * La plaque cachée dans une référence en toutes lettres.
 *
 * Un paiement en ligne affiche sa description, pas sa référence :
 * « Intervention véhicule FZ949PT ». L'écran comptoir, lui, envoie
 * « BMW Serie 3 1ABC234 ». Dans les deux cas la plaque est là, il suffit de
 * la sortir du texte — sinon la référence entière ne ressemble à rien et
 * l'encaissement finit à trancher à la main pour rien.
 *
 * On n'accepte QUE le cas non ambigu : un seul mot ressemble à une plaque.
 */
export function plateInsideText(raw: string): string | null {
  const chunks = String(raw || '').split(/[\s,;/]+/).filter(Boolean)
  if (chunks.length < 2) return null                   // un seul mot : déjà traité en amont
  const plates = [...new Set(chunks.map(normalizePlate).filter((p): p is string => !!p))]
  return plates.length === 1 ? plates[0] : null
}

export interface TokenHit {
  token:       string
  invoiceId:   number | null
  plate:       string | null
  missionNo:   string | null
  /** Pourquoi il n'y a pas de facture, quand il n'y en a pas. */
  gap:         string | null
}

/**
 * Jetons VD Soft → facture Odoo, en trois requêtes pour tout le lot.
 *
 * Résolus en bloc et non un par un : un versement porte jusqu'à huit
 * transactions, et la file en compte une dizaine. Un aller-retour Supabase par
 * jeton, c'était une centaine d'appels pour afficher un écran.
 */
export async function loadTokenIndex(tokens: string[]): Promise<Map<string, TokenHit>> {
  const out = new Map<string, TokenHit>()
  const wanted = [...new Set(tokens.map(t => String(t || '').trim()).filter(isVdToken))]
  if (!wanted.length) return out

  const sb = createAdminClient()

  const { data: encaissements } = await sb
    .from('interventions')
    .select('id, payment_reference, mission_id, plate')
    .in('payment_reference', wanted)
    .order('id', { ascending: true })       // tri déterministe

  if (!encaissements?.length) return out

  const missionIds = [...new Set(encaissements.map(e => e.mission_id).filter(Boolean))] as string[]
  const missions = new Map<string, any>()
  if (missionIds.length) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, mission_number, vehicle_plate, invoice_odoo_id, invoice_number')
      .in('id', missionIds)
      .order('id', { ascending: true })
    for (const m of data || []) missions.set(String(m.id), m)
  }

  for (const e of encaissements) {
    const token = String(e.payment_reference)
    const m     = e.mission_id ? missions.get(String(e.mission_id)) : null
    const plate = String(m?.vehicle_plate || e.plate || '') || null

    if (!e.mission_id) {
      out.set(token, { token, invoiceId: null, plate, missionNo: null,
        gap: 'encaissement chauffeur sans dossier lié — aucune facture à rapprocher' })
      continue
    }
    if (!m) {
      out.set(token, { token, invoiceId: null, plate, missionNo: null,
        gap: 'la mission liée à cet encaissement est introuvable' })
      continue
    }
    if (!m.invoice_odoo_id) {
      out.set(token, { token, invoiceId: null, plate, missionNo: m.mission_number ?? null,
        gap: `mission ${m.mission_number} retrouvée, mais aucune facture ne lui est rattachée` })
      continue
    }
    out.set(token, {
      token,
      invoiceId: Number(m.invoice_odoo_id),
      plate,
      missionNo: m.mission_number ?? null,
      gap:       null,
    })
  }
  return out
}

/** Les factures d'un lot d'ids, mises en forme comme les candidates du résolveur. */
export async function readInvoices(ids: number[]) {
  if (!ids.length) return new Map<number, any>()
  const rows = await odooRpc<any[]>('account.move', 'search_read', [[['id', 'in', ids]]], {
    fields: ['id', 'name', 'partner_id', 'amount_total', 'invoice_date', 'payment_state', 'state', 'move_type'],
    limit: ids.length + 10,
  })
  return new Map(rows.map(r => [Number(r.id), r]))
}

/**
 * Retrouve la ou les factures payées par une transaction SumUp.
 *
 * Ordre : rattachement humain → jeton VD Soft → cascade Paynovate.
 * Le rattachement humain passe devant tout le reste, sinon une correction
 * faite dans l'écran serait écrasée au calcul suivant.
 *
 * @param invoiceCache factures déjà lues pour ce lot (évite un appel par jeton)
 */
export async function resolveSumupReference(
  ref: string,
  amount: number,
  when: string | null,
  tokens: Map<string, TokenHit>,
  invoiceCache: Map<number, any>,
  linkKey?: string,
): Promise<Resolution> {
  const raw = String(ref || '').trim()

  // Le rattachement humain passe avant tout le reste. Sa clé n'est pas
  // forcément la référence : sans référence, c'est le code de la transaction.
  const key = String(linkKey || raw).trim()
  if (key) {
    const manual = await readManualOverride(key, amount, 'sumup')
    if (manual) return manual
  }

  // Rien n'a été saisi au terminal, ou on retombe sur le code de transaction
  // après un détachement : la cascade ne peut rien en tirer, mais les factures
  // du même montant restent une piste utile à cliquer.
  if (!raw || isTxCode(raw)) {
    return {
      confidence: 'aucun', invoiceIds: [],
      candidates: await proposeByAmount(amount, when),
      explanation: 'Aucune référence saisie sur le terminal — SumUp n\'a enregistré que « Montant personnalisé »',
    }
  }

  const hit = tokens.get(raw)
  if (hit) {
    if (hit.invoiceId) {
      const inv = invoiceCache.get(hit.invoiceId) ?? (await readInvoices([hit.invoiceId])).get(hit.invoiceId)
      if (inv) {
        const shaped = {
          id: Number(inv.id),
          name: String(inv.name),
          partner: Array.isArray(inv.partner_id) ? inv.partner_id[1] : '',
          amount: signedTotal(inv),
          move_type: inv.move_type ?? null,
          date: inv.invoice_date || '',
          payment_state: inv.payment_state ?? null,
          state: inv.state ?? null,
        }
        return {
          confidence: 'exact',
          invoiceIds: [shaped.id],
          candidates: [shaped],
          explanation: `Paiement lancé depuis VD Soft${hit.plate ? ` sur ${hit.plate}` : ''}${hit.missionNo ? ` (dossier ${hit.missionNo})` : ''} — facture ${shaped.name}`,
        }
      }
    }
    // Jeton reconnu mais pas de facture au bout : on le DIT, plutôt que de
    // laisser la cascade proposer des factures du même montant au hasard.
    // La plaque reste exploitable, elle, donc on tente quand même la cascade.
    if (hit.plate) {
      const byPlate = await resolveReference(hit.plate, amount, when, 'sumup')
      if (byPlate.invoiceIds.length) {
        return { ...byPlate, explanation: `${hit.gap} — retrouvée par la plaque ${hit.plate} : ${byPlate.explanation}` }
      }
      return { ...byPlate, confidence: 'aucun', invoiceIds: [], explanation: `Paiement VD Soft : ${hit.gap}` }
    }
    return { confidence: 'aucun', invoiceIds: [], candidates: [], explanation: `Paiement VD Soft : ${hit.gap}` }
  }

  // Jeton VD Soft inconnu de la base : l'encaissement n'a jamais été enregistré
  // côté VD Soft (app fermée avant la fin ?). La cascade n'y pourra rien.
  if (isVdToken(raw)) {
    const fallback = await resolveReference(raw, amount, when, 'sumup')
    const lead = `Référence VD Soft « ${raw} » sans encaissement enregistré dans l'app`
    return {
      ...fallback,
      confidence: fallback.manual ? fallback.confidence : 'propose',
      invoiceIds: fallback.manual ? fallback.invoiceIds : [],
      // On conserve les propositions trouvées par montant : c'est tout ce qui
      // reste pour retrouver la facture, autant les montrer.
      explanation: fallback.candidates.length
        ? `${lead} — voici les factures du même montant, à confirmer`
        : `${lead} — à rattacher à la main`,
    }
  }

  const direct = await resolveReference(raw, amount, when, 'sumup')
  if (direct.invoiceIds.length || direct.candidates.length) return direct

  // Dernière chance : la référence est une phrase, la plaque est dedans.
  const plate = plateInsideText(raw)
  if (plate) {
    const byPlate = await resolveReference(plate, amount, when, 'sumup')
    if (byPlate.invoiceIds.length || byPlate.candidates.length) {
      return { ...byPlate, explanation: `« ${raw} » → plaque ${plate} : ${byPlate.explanation}` }
    }
  }
  return direct
}
