// ============================================================
// VERVIERS DÉPANNAGE — Versements SumUp (API marchand)
// ============================================================
//
// Contrairement à Paynovate, SumUp expose une vraie API : pas de session web,
// pas de scraping. Trois listes suffisent pour reconstituer un versement, et
// elles se lisent en un appel chacune sur toute la période.
//
//   1. /financials/payouts       → UNE LIGNE PAR TRANSACTION versée, avec la
//                                  référence du versement (= la communication
//                                  bancaire), le net, le fee, et le code de la
//                                  vente. C'est le pivot.
//   2. /financials/transactions  → external_reference : notre référence quand
//                                  le paiement est parti d'un checkout VD Soft.
//   3. /transactions/history     → product_summary (ce qui est affiché sur le
//                                  terminal), client_transaction_id, la carte,
//                                  et qui a encaissé.
//
// ⚠️ Ne pas confondre `reference` et `id`. La communication bancaire porte la
// RÉFÉRENCE (« MC7 PID1332537 »), partagée par toutes les transactions d'un
// même virement ; l'`id` est propre à chaque ligne de versement. Regrouper sur
// `id` casserait le rapprochement en autant de morceaux qu'il y a de ventes.
//
// Vérifié en prod le 19/08/2026 : sur les 12 lignes bancaires SumUp non
// lettrées portant une communication exploitable, la somme des `amount` du
// groupe tombe au centime sur le montant crédité — 12 fois sur 12.

const API = 'https://api.sumup.com/v0.1'

/** Étiquettes que SumUp met par défaut : ce n'est pas une référence. */
const NON_REFS = new Set(['montant personnalisé', 'custom amount', 'test', 'divers'])

export interface SumUpTx {
  payoutRef:       string        // « MC7 PID1332537 » — la communication bancaire
  payoutId:        number        // 1332537 — la part numérique, identifiant du versement
  payoutDate:      string        // date du versement (ISO court)
  transactionCode: string        // TAAA… — identifie la vente chez SumUp
  rawAmount:       number        // brut encaissé au terminal
  commission:      number        // fee retenu à la source
  netAmount:       number        // ce qui arrive en banque
  transactionAt:   string | null // horodatage de l'encaissement
  cardBrand:       string
  entryMode:       string
  by:              string | null // qui a encaissé (compte SumUp)
  merchantRef:     string        // la référence saisie — '' si SumUp n'en a pas
}

function key(): string {
  const k = process.env.SUMUP_API_KEY
  if (!k) throw new Error("SumUp : SUMUP_API_KEY absente de l'environnement")
  return k
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key()}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // 403 = la clé existe mais n'a pas le scope demandé. Le dire plutôt que
    // laisser croire à une panne : c'est un réglage dans le back-office SumUp.
    if (res.status === 401 || res.status === 403) {
      throw new Error(`SumUp : accès refusé sur ${path.split('?')[0]} (HTTP ${res.status}) — vérifier les droits « payouts » et « transactions » de la clé API`)
    }
    throw new Error(`SumUp : ${path.split('?')[0]} → HTTP ${res.status} ${body.slice(0, 160)}`)
  }
  return res.json()
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** « MC7 PID1332537 » → 1332537. null si la référence n'a pas cette forme. */
export function payoutIdOf(reference: string): number | null {
  const m = String(reference || '').match(/PID\s*(\d{4,})/i)
  return m ? Number(m[1]) : null
}

/**
 * L'identifiant de versement porté par le libellé bancaire Odoo
 * (« … Communication : MC7 PID1332537 »). null si la ligne n'est pas
 * rattachable à un versement SumUp.
 */
export function payoutRefFromLabel(label: string): string | null {
  const m = String(label || '').match(/\b(MC\w*\s*PID\s*\d{4,})\b/i)
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
}

/**
 * Le jeton VD Soft caché dans `client_transaction_id`.
 *
 * Sur un paiement en ligne (QR, lien par mail), SumUp ne remonte PAS notre
 * `external_reference` mais compose `client_transaction_id` = « jeton-id ».
 * Sans cette lecture, ces encaissements n'avaient pour toute référence que la
 * description du checkout (« Intervention véhicule FZ949PT ») — alors que le
 * jeton, lui, désigne la facture sans la moindre ambiguïté.
 */
function tokenFromClientTxId(raw: unknown): string {
  const m = String(raw ?? '').match(/^(VD[A-Z0-9]{6,10})-\d+$/i)
  return m ? m[1] : ''
}

/** Ce que SumUp affiche par défaut n'est pas une référence exploitable. */
function cleanRef(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s || NON_REFS.has(s.toLowerCase())) return ''
  return s
}

/** Les lignes de versement de la période, une par transaction versée. */
async function fetchPayoutRows(from: Date, to: Date): Promise<any[]> {
  const rows = await get(`/me/financials/payouts?start_date=${ymd(from)}&end_date=${ymd(to)}&format=json`)
  if (!Array.isArray(rows)) throw new Error('SumUp : réponse inattendue sur /financials/payouts')
  // Un versement rejeté par la banque ne crédite rien : il n'a rien à faire ici.
  return rows.filter(r => String(r.status || '').toUpperCase() === 'SUCCESSFUL')
}

/** external_reference par transaction — présent quand le checkout vient de VD Soft. */
async function fetchExternalRefs(from: Date, to: Date): Promise<Map<string, string>> {
  const rows = await get(`/me/financials/transactions?start_date=${ymd(from)}&end_date=${ymd(to)}&format=json`)
  const map = new Map<string, string>()
  for (const r of Array.isArray(rows) ? rows : []) {
    const ref = cleanRef(r.external_reference)
    if (r.transaction_code && ref) map.set(String(r.transaction_code), ref)
  }
  return map
}

/**
 * L'historique des transactions : c'est lui qui porte `product_summary`, donc
 * la référence tapée sur le terminal. Paginé (100 par page, lien « next »).
 */
async function fetchHistory(from: Date): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  let qs = `limit=100&order=descending&oldest_time=${encodeURIComponent(from.toISOString())}`

  // Borne dure : 100 pages = 10 000 transactions, très au-delà d'une fenêtre de
  // réconciliation. Sans elle, un lien « next » qui boucle tournerait sans fin.
  for (let page = 0; page < 100; page++) {
    const data = await get(`/me/transactions/history?${qs}`)
    const items = Array.isArray(data?.items) ? data.items : []
    for (const it of items) if (it?.transaction_code) map.set(String(it.transaction_code), it)

    const next = (data?.links || []).find((l: any) => l?.rel === 'next')?.href
    if (!next || !items.length) break
    qs = String(next).replace(/^\?/, '')
  }
  return map
}

/**
 * Toutes les transactions versées sur la période, prêtes à être rapprochées.
 *
 * @param from début de fenêtre — porte sur la DATE DE VERSEMENT. Remonter large :
 *   une transaction du 14 peut n'être versée que le 17.
 */
export async function fetchPayoutTransactions(from: Date, to: Date): Promise<SumUpTx[]> {
  // L'historique remonte un peu plus loin que les versements : une transaction
  // versée le 1er du mois a pu être encaissée quelques jours avant la fenêtre.
  const histFrom = new Date(from)
  histFrom.setUTCDate(histFrom.getUTCDate() - 10)

  const [rows, exts, hist] = await Promise.all([
    fetchPayoutRows(from, to),
    fetchExternalRefs(from, to),
    fetchHistory(histFrom),
  ])

  const out: SumUpTx[] = []
  for (const r of rows) {
    const code = String(r.transaction_code || '')
    const h    = hist.get(code)
    const id   = payoutIdOf(r.reference)
    if (!id) continue                      // versement sans référence exploitable

    const net  = Number(r.amount) || 0
    const fee  = Number(r.fee) || 0

    out.push({
      payoutRef:       String(r.reference),
      payoutId:        id,
      payoutDate:      String(r.date || '').slice(0, 10),
      transactionCode: code,
      rawAmount:       Math.round((net + fee) * 100) / 100,
      commission:      fee,
      netAmount:       net,
      transactionAt:   h?.timestamp ? String(h.timestamp) : null,
      cardBrand:       String(h?.card_type || '').replace(/_/g, ' '),
      entryMode:       String(h?.entry_mode || ''),
      by:              h?.user ? String(h.user).split('@')[0] : null,
      // Du plus sûr au moins sûr :
      //   external_reference  → notre référence, posée par VD Soft (terminal)
      //   client_transaction_id → le même jeton, cas du paiement en ligne
      //   product_summary     → ce qui est affiché sur le terminal (plaque,
      //                         description, ou rien du tout)
      merchantRef:     exts.get(code)
                       || tokenFromClientTxId(h?.client_transaction_id)
                       || cleanRef(h?.product_summary),
    })
  }
  return out
}
