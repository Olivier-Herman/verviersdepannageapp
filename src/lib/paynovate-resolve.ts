// ============================================================
// VERVIERS DÉPANNAGE — Résolution des références Paynovate
// ============================================================
//
// Ce qui est tapé sur le terminal n'est pas toujours un numéro de facture.
// Relevé sur 492 transactions (mars → août 2026) :
//
//   72 %  numéro de facture       2026/08/147
//   25 %  plaque                  2FEJ294, 1crx611, zabd049
//    4 %  format libre            1026/07/727-728-729 · 2026/06 /048 · 202604314
//
// Et ça dépend du terminal : Fourrière 97 % de numéros de facture,
// Dépannage 44 % seulement.
//
// D'où une résolution en cascade, du plus sûr au moins sûr. Seuls les
// niveaux « exact » et « corrigé » donnent un rapprochement en un clic ;
// au-delà on PROPOSE, et c'est un humain qui tranche.

import { odooRpc }           from '@/lib/odoo'
import { createAdminClient } from '@/lib/supabase'

export type Confidence = 'exact' | 'corrige' | 'plaque' | 'propose' | 'aucun'

export interface InvoiceCandidate {
  id: number
  name: string
  partner: string
  amount: number
  date: string
  payment_state: string | null
  state?: string | null
}

export interface Resolution {
  confidence:  Confidence
  invoiceIds:  number[]          // plusieurs si un paiement couvre plusieurs factures
  candidates:  InvoiceCandidate[]
  explanation: string            // affiché tel quel dans l'écran
  /** Vrai si le rattachement vient d'une saisie humaine → détachable. */
  manual?:     boolean
}

// ── Normalisation ───────────────────────────────────────────

const INVOICE_RE = /^\d{4}\/\d{2}\/\d{3,4}$/

/**
 * Rend lisible une référence tapée à la main.
 * Renvoie la liste des numéros de facture candidats (souvent un seul).
 */
export function normalizeInvoiceRefs(raw: string): string[] {
  let s = String(raw || '').trim()
  if (!s) return []

  // Espaces parasites autour des séparateurs : « 2026/06 /048 »
  s = s.replace(/\s*\/\s*/g, '/').replace(/\s+/g, '')

  // Déjà bon.
  if (INVOICE_RE.test(s)) return [s]

  // Année mal tapée : « 1026/07/727 » → le millésime est forcément 20xx.
  const bad = s.match(/^(\d)(\d{3})\/(\d{2})\/(\d{3,4})$/)
  if (bad && bad[1] !== '2') s = `2${bad[2]}/${bad[3]}/${bad[4]}`

  // Plusieurs factures d'un coup : « 2026/07/727-728-729 »
  const multi = s.match(/^(\d{4})\/(\d{2})\/([\d]{3,4}(?:[-+][\d]{3,4})+)$/)
  if (multi) {
    const [, y, m, tail] = multi
    return tail.split(/[-+]/).map(n => `${y}/${m}/${n.padStart(3, '0')}`)
  }

  // Slashes oubliés : « 202604314 » → 2026/04/314
  const flat = s.match(/^(20\d{2})(\d{2})(\d{3,4})$/)
  if (flat) return [`${flat[1]}/${flat[2]}/${flat[3]}`]

  return INVOICE_RE.test(s) ? [s] : []
}

/** Plaque belge normalisée, ou null si ça n'y ressemble pas. */
export function normalizePlate(raw: string): string | null {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (s.length < 6 || s.length > 9) return null
  if (!/[A-Z]/.test(s) || !/\d/.test(s)) return null
  if (INVOICE_RE.test(String(raw).trim())) return null
  return s
}

const plateKey = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Distance de Levenshtein, plafonnée — sert à repérer les fautes de frappe. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 9
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// ── Index des plaques ───────────────────────────────────────
// Chargé une fois par exécution : les plaques du terminal reviennent
// souvent, et PostgREST plafonne à 1000 lignes — donc pagination.

interface MissionRow { id: number; plate: string; invoiceId: number | null; at: string; client: string | null }

let plateIndex: { built: number; rows: MissionRow[] } | null = null

export async function loadPlateIndex(sinceIso: string, force = false): Promise<MissionRow[]> {
  if (!force && plateIndex && Date.now() - plateIndex.built < 5 * 60_000) return plateIndex.rows

  const sb = createAdminClient()
  const rows: MissionRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, vehicle_plate, invoice_odoo_id, created_at, client_name')
      .not('vehicle_plate', 'is', null)
      .gte('created_at', sinceIso)
      .order('id', { ascending: true })          // tri déterministe : jamais created_at
      .range(offset, offset + 999)
    if (!data?.length) break
    for (const m of data) {
      const k = plateKey(String(m.vehicle_plate || ''))
      if (k.length >= 5) {
        rows.push({ id: m.id, plate: k, invoiceId: m.invoice_odoo_id ? Number(m.invoice_odoo_id) : null, at: String(m.created_at || ''), client: m.client_name ?? null })
      }
    }
    if (data.length < 1000) break
  }
  plateIndex = { built: Date.now(), rows }
  return rows
}

// ── Résolution ──────────────────────────────────────────────

async function readInvoices(names: string[]) {
  if (!names.length) return []
  return odooRpc<any[]>('account.move', 'search_read', [[['name', 'in', names]]], {
    fields: ['id', 'name', 'partner_id', 'amount_total', 'invoice_date', 'payment_state', 'state'],
    limit: names.length + 10,
  })
}

async function readInvoicesById(ids: number[]) {
  if (!ids.length) return []
  return odooRpc<any[]>('account.move', 'search_read', [[['id', 'in', ids]]], {
    fields: ['id', 'name', 'partner_id', 'amount_total', 'invoice_date', 'payment_state', 'state'],
    limit: ids.length + 10,
  })
}

/**
 * Le prestataire dont on résout les références. Les rattachements manuels sont
 * cloisonnés par prestataire : « 2DPU256 » tapé sur un terminal Paynovate et
 * sur un terminal SumUp ne désignent pas forcément la même facture.
 */
export type Provider = 'paynovate' | 'sumup'

/** Un rattachement manuel enregistré pour cette référence et ce montant. */
async function readOverride(ref: string, amount: number, provider: Provider) {
  try {
    const sb = createAdminClient()
    const { data } = await sb
      .from('payout_reference_overrides')
      .select('invoice_ids, invoice_names')
      .eq('provider', provider)
      .eq('merchant_ref', ref)
      .eq('amount', Math.round(amount * 100) / 100)
      .maybeSingle()
    return data?.invoice_ids?.length ? data : null
  } catch {
    return null            // table absente ou injoignable → on continue en auto
  }
}

/**
 * Le rattachement humain enregistré pour cette référence, s'il existe.
 *
 * Exporté pour les résolveurs qui ont leur propre chemin rapide (SumUp passe
 * par le jeton VD Soft avant tout le reste) : ce qu'un humain a tranché doit
 * rester consulté EN PREMIER, sinon un rattachement corrigé à la main serait
 * écrasé au prochain calcul par la résolution automatique.
 */
export async function readManualOverride(
  ref: string,
  amount: number,
  provider: Provider,
): Promise<Resolution | null> {
  const found = await readOverride(String(ref || '').trim(), amount, provider)
  if (!found) return null
  const rows = await readInvoicesById(found.invoice_ids)
  if (!rows.length) return null
  return {
    confidence: 'exact',
    invoiceIds: rows.map(r => r.id),
    candidates: rows.map(shape),
    explanation: `Rattachée à la main : ${rows.map(r => r.name).join(' + ')}`,
    manual: true,
  }
}

/**
 * Enregistre le rattachement d'une référence terminal à des factures.
 * Les factures sont vérifiées côté Odoo : on ne mémorise rien d'inexistant.
 */
export async function saveOverride(
  ref: string,
  amount: number,
  invoiceNames: string[],
  userId: string | null,
  provider: Provider = 'paynovate',
): Promise<{
  invoiceIds: number[]
  names: string[]
  total: number
  partner: string
  paymentState: string | null
}> {
  const wanted = invoiceNames.map(n => n.trim()).filter(Boolean)
  if (!wanted.length) throw new Error('Aucun numéro de facture indiqué')

  const rows = await readInvoices(wanted)
  const missing = wanted.filter(n => !rows.some(r => r.name === n))
  if (missing.length) throw new Error(`Facture introuvable dans Odoo : ${missing.join(', ')}`)

  const total = rows.reduce((s, r) => s + Number(r.amount_total), 0)

  const sb = createAdminClient()
  const { error } = await sb.from('payout_reference_overrides').upsert({
    provider,
    merchant_ref:  ref.trim(),
    amount:        Math.round(amount * 100) / 100,
    invoice_ids:   rows.map(r => r.id),
    invoice_names: rows.map(r => r.name),
    created_by:    userId,
  }, { onConflict: 'provider,merchant_ref,amount' })
  if (error) throw new Error(`Rattachement non enregistré : ${error.message}`)

  plateIndex = null        // la prochaine résolution repart d'un index propre
  return {
    invoiceIds:   rows.map(r => r.id),
    names:        rows.map(r => r.name),
    total:        Math.round(total * 100) / 100,
    partner:      Array.isArray(rows[0]?.partner_id) ? rows[0].partner_id[1] : '',
    // Une seule facture → son état de paiement pilote l'affichage ; plusieurs
    // → on laisse le serveur trancher au moment du rapprochement.
    paymentState: rows.length === 1 ? (rows[0].payment_state ?? null) : null,
  }
}

/** Supprime un rattachement manuel — on s'est trompé de facture. */
export async function removeOverride(
  ref: string,
  amount: number,
  provider: Provider = 'paynovate',
): Promise<boolean> {
  const sb = createAdminClient()
  const { error, count } = await sb
    .from('payout_reference_overrides')
    .delete({ count: 'exact' })
    .eq('provider', provider)
    .eq('merchant_ref', ref.trim())
    .eq('amount', Math.round(amount * 100) / 100)
  if (error) throw new Error(`Détachement impossible : ${error.message}`)
  plateIndex = null
  return (count ?? 0) > 0
}

/** Les factures clients du même montant, dans les jours qui précèdent. */
async function sameAmountInvoices(amount: number, when: string | null, days = 3) {
  if (!when) return []
  const day = when.slice(0, 10)
  const from = new Date(day)
  from.setUTCDate(from.getUTCDate() - days)
  return odooRpc<any[]>('account.move', 'search_read', [[
    ['move_type', '=', 'out_invoice'],
    ['amount_total', '>=', amount - 0.005],
    ['amount_total', '<=', amount + 0.005],
    ['invoice_date', '>=', from.toISOString().slice(0, 10)],
    ['invoice_date', '<=', day],
  ]], { fields: ['id', 'name', 'partner_id', 'amount_total', 'invoice_date', 'payment_state', 'state'], limit: 6 })
}

const shape = (r: any) => ({
  id: r.id,
  name: r.name,
  partner: Array.isArray(r.partner_id) ? r.partner_id[1] : '',
  amount: Number(r.amount_total),
  date: r.invoice_date || '',
  // Indispensable : sans lui, une facture retrouvée par plaque passait pour
  // soldée et l'encaissement perdu n'était pas détecté.
  payment_state: r.payment_state ?? null,
  // Une facture en brouillon n'est pas une facture impayée : Odoo refuse d'y
  // enregistrer un paiement tant qu'elle n'est pas comptabilisée.
  state: r.state ?? null,
})

/**
 * Retrouve la ou les factures payées par une transaction.
 *
 * @param ref    ce qui a été tapé sur le terminal
 * @param amount montant encaissé
 * @param when   date de l'encaissement (ISO)
 * @param provider prestataire, pour ne consulter que SES rattachements manuels
 */
export async function resolveReference(
  ref: string,
  amount: number,
  when: string | null,
  provider: Provider = 'paynovate',
): Promise<Resolution> {
  const none: Resolution = { confidence: 'aucun', invoiceIds: [], candidates: [], explanation: '' }
  const raw = String(ref || '').trim()
  if (!raw) return { ...none, explanation: 'Aucune référence saisie sur le terminal' }

  // ── 0. Rattachement déjà indiqué à la main ────────────────
  // Consulté en premier : ce qu'un humain a tranché fait autorité, et le
  // versement redevient « prêt » par le chemin normal, garde-fous compris.
  const manual = await readOverride(raw, amount, provider)
  if (manual) {
    const rows = await readInvoicesById(manual.invoice_ids)
    if (rows.length) {
      return {
        confidence: 'exact',
        invoiceIds: rows.map(r => r.id),
        candidates: rows.map(shape),
        explanation: `Rattachée à la main : ${rows.map(r => r.name).join(' + ')}`,
        manual: true,
      }
    }
  }

  // ── 1. Numéro de facture, tel quel ────────────────────────
  if (INVOICE_RE.test(raw)) {
    const rows = await readInvoices([raw])
    if (rows.length) {
      return {
        confidence: 'exact',
        invoiceIds: [rows[0].id],
        candidates: rows.map(shape),
        explanation: `Facture ${raw}`,
      }
    }
    return { ...none, explanation: `Aucune facture au numéro ${raw} — annulée depuis l'encaissement ?` }
  }

  // ── 2. Référence corrigeable ──────────────────────────────
  const guessed = normalizeInvoiceRefs(raw)
  if (guessed.length) {
    const rows = await readInvoices(guessed)
    if (rows.length === guessed.length) {
      const total = rows.reduce((s, r) => s + Number(r.amount_total), 0)
      const fits = Math.abs(total - amount) < 0.005
      return {
        confidence: fits ? 'corrige' : 'propose',
        invoiceIds: rows.map(r => r.id),
        candidates: rows.map(shape),
        explanation: guessed.length > 1
          ? `« ${raw} » lu comme ${guessed.join(' + ')} — ${rows.length} factures pour ${total.toFixed(2)} €${fits ? '' : `, or ${amount.toFixed(2)} € ont été encaissés`}`
          : `« ${raw} » lu comme ${guessed[0]}`,
      }
    }
    if (rows.length) {
      return {
        confidence: 'propose',
        invoiceIds: [],
        candidates: rows.map(shape),
        explanation: `« ${raw} » : ${rows.length} des ${guessed.length} factures attendues retrouvées`,
      }
    }
  }

  // ── 3. Plaque → mission VD Soft → facture ─────────────────
  const plate = normalizePlate(raw)
  if (plate) {
    // On remonte large : un encaissement peut suivre la mission de loin.
    const since = new Date(when ?? Date.now())
    since.setUTCMonth(since.getUTCMonth() - 4)
    const index = await loadPlateIndex(since.toISOString().slice(0, 10))

    const hits = index.filter(m => m.plate === plate)

    // 3a. Plaque exacte, mission facturée.
    const invoiced = hits.filter(m => m.invoiceId)
    if (invoiced.length) {
      const rows = await readInvoicesById(invoiced.map(m => m.invoiceId as number))
      // On croise plaque ET montant : un même véhicule peut repasser.
      const sameAmount = rows.filter(r => Math.abs(Number(r.amount_total) - amount) < 0.005)
      const pool = sameAmount.length ? sameAmount : rows

      // Et on privilégie la facture la plus proche de la date d'encaissement.
      if (when && pool.length > 1) {
        const t = new Date(when).getTime()
        pool.sort((a, b) =>
          Math.abs(new Date(a.invoice_date || 0).getTime() - t) -
          Math.abs(new Date(b.invoice_date || 0).getTime() - t))
      }

      if (sameAmount.length === 1) {
        return {
          confidence: 'plaque',
          invoiceIds: [sameAmount[0].id],
          candidates: pool.map(shape),
          explanation: `Plaque ${plate} — facture ${sameAmount[0].name}, montant identique`,
        }
      }
      return {
        confidence: 'propose',
        invoiceIds: [],
        candidates: pool.slice(0, 6).map(shape),
        explanation: sameAmount.length
          ? `Plaque ${plate} — ${sameAmount.length} factures au même montant, à départager`
          : `Plaque ${plate} — facture ${rows[0]?.name} de ${Number(rows[0]?.amount_total).toFixed(2)} €, or ${amount.toFixed(2)} € encaissés`,
      }
    }

    // 3b. Mission trouvée, mais aucune facture ne lui est rattachée.
    if (hits.length) {
      const near = await sameAmountInvoices(amount, when)
      return {
        confidence: 'propose',
        invoiceIds: [],
        candidates: near.map(shape),
        explanation: `Plaque ${plate} : mission trouvée dans VD Soft, mais aucune facture ne lui est rattachée`,
      }
    }

    // 3c. Faute de frappe au terminal — une plaque à un caractère près.
    const typos = index
      .map(m => ({ m, d: editDistance(plate, m.plate) }))
      .filter(x => x.d === 1 && x.m.invoiceId)
    if (typos.length) {
      const rows = await readInvoicesById([...new Set(typos.map(x => x.m.invoiceId as number))])
      const fits = rows.filter(r => Math.abs(Number(r.amount_total) - amount) < 0.005)
      const pool = fits.length ? fits : rows
      return {
        confidence: 'propose',
        invoiceIds: [],
        candidates: pool.slice(0, 6).map(shape),
        explanation: fits.length === 1
          ? `Plaque ${plate} inconnue — mais ${typos.find(t => t.m.invoiceId === fits[0].id)?.m.plate} existe, à un caractère près, pour le même montant`
          : `Plaque ${plate} inconnue — plaques proches : ${[...new Set(typos.map(t => t.m.plate))].slice(0, 4).join(', ')}`,
      }
    }
  }

  // ── 4. Dernier recours : même montant, même jour ──────────
  if (when) {
    const rows = await sameAmountInvoices(amount, when)
    if (rows.length) {
      return {
        confidence: 'propose',
        invoiceIds: [],
        candidates: rows.map(shape),
        explanation: plate
          ? `Plaque ${plate} inconnue au parc — voici les factures du même montant`
          : `Référence « ${raw} » non reconnue — voici les factures du même montant`,
      }
    }
  }

  return {
    ...none,
    explanation: plate
      ? `Plaque ${plate} : aucune mission facturée à cette plaque`
      : `Référence « ${raw} » non reconnue, et aucune facture à ${amount.toFixed(2)} €`,
  }
}
