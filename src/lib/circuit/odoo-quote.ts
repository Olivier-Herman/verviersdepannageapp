// src/lib/circuit/odoo-quote.ts
//
// Olivier 2026-06-08 : helper pour creer un devis Odoo (sale.order) CONFIRME
// (state='sale') pour une prestation circuit Spa-Francorchamps.
//
// 1 ligne par jour de prestation (cf decision Olivier) :
//   - Description : "Incentive 05/07/2026 - 2 dépanneuses" ou "After-Six 05/07/2026"
//   - product_id : produit Incentive ou After6 (recherche dynamique par default_code)
//   - product_uom_qty : nb_depanneuses (1 par defaut, 1 forcé pour After-Six)
//   - price_unit : prix HT du produit Odoo (heritage default)
//
// Apres creation : action_confirm pour passer le devis en 'sale' (commande confirmee).

import { odooRpc } from '@/lib/odoo'

export interface CircuitPrestationLine {
  type:           'incentive' | 'after_six'
  date:           string        // ISO YYYY-MM-DD
  nb_depanneuses: number        // toujours 1 pour after_six, 1-6 pour incentive
}

export interface CreateCircuitQuoteInput {
  partnerId: number
  lines:     CircuitPrestationLine[]   // 1 entree = 1 jour
  notes?:    string
}

const PRODUCT_REF_INCENTIVE = 'Incentive'
const PRODUCT_REF_AFTER_SIX = 'After6'

const TYPE_LABELS: Record<string, string> = {
  incentive:  'Incentive',
  after_six:  'After-Six',
}

/**
 * Cherche un product.product par default_code (cache simple).
 */
const productCache = new Map<string, number>()
async function findProductIdByCode(code: string): Promise<number> {
  if (productCache.has(code)) return productCache.get(code)!
  const products = await odooRpc<any[]>('product.product', 'search_read', [
    [['default_code', '=', code]],
  ], { fields: ['id', 'name'], limit: 1 })
  if (!products || products.length === 0) {
    throw new Error(`Produit Odoo introuvable : default_code='${code}'. Verifier le catalog Odoo.`)
  }
  productCache.set(code, products[0].id)
  return products[0].id
}

/**
 * Cree un sale.order confirme avec 1 ligne par prestation (jour).
 * Retourne { id, name } du devis (ex: S00123).
 */
export async function createCircuitQuote(input: CreateCircuitQuoteInput): Promise<{ id: number; name: string }> {
  if (!input.partnerId)         throw new Error('partnerId requis')
  if (!input.lines || input.lines.length === 0) throw new Error('Au moins 1 ligne requise')

  // Resolve products once (cache)
  const incentiveProductId = input.lines.some(l => l.type === 'incentive')
    ? await findProductIdByCode(PRODUCT_REF_INCENTIVE)
    : 0
  const afterSixProductId  = input.lines.some(l => l.type === 'after_six')
    ? await findProductIdByCode(PRODUCT_REF_AFTER_SIX)
    : 0

  // Format DD/MM/YYYY pour les descriptions de ligne
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  const orderLines = input.lines.map((l, idx) => {
    const productId = l.type === 'after_six' ? afterSixProductId : incentiveProductId
    const qty       = l.type === 'after_six' ? 1 : Math.max(1, Math.min(6, l.nb_depanneuses || 1))
    const label     = `${TYPE_LABELS[l.type]} - Circuit Spa-Francorchamps ${fmtDate(l.date)}${qty > 1 ? ` (${qty} dépanneuses)` : ''}`
    return [0, 0, {
      product_id:       productId,
      product_uom_qty:  qty,
      name:             label,
      sequence:         10 + idx,
    }]
  })

  // Note obligatoire en bas de tout devis circuit.
  orderLines.push(await hsuppNoteLine(10 + orderLines.length))

  const orderId = await odooRpc<number>('sale.order', 'create', [{
    partner_id:       input.partnerId,
    client_order_ref: 'Prestation Circuit Spa-Francorchamps',
    order_line:       orderLines,
  }])

  // Confirme le devis (state draft -> sale)
  try {
    await odooRpc('sale.order', 'action_confirm', [[orderId]])
  } catch (e: any) {
    // Si la confirmation echoue (ex: workflow Odoo custom), on laisse en draft
    // mais on log pour traceabilite. L operateur pourra confirmer manuellement.
    console.warn(`[Odoo Circuit] action_confirm KO order=${orderId}:`, e?.message)
  }

  // Notes internes (optionnel)
  if (input.notes && input.notes.trim()) {
    await odooRpc('sale.order', 'message_post', [[orderId]], {
      body:         input.notes.trim(),
      message_type: 'comment',
      subtype_id:   2,
    }).catch(() => {})
  }

  const orders = await odooRpc<any[]>('sale.order', 'read',
    [[orderId]], { fields: ['id', 'name'] })

  return { id: orderId, name: orders[0]?.name || `S${orderId}` }
}

// ── Week-ends de COURSE ────────────────────────────────────────────────────
// Facturation différente : par jour, une SECTION puis les produits :
//   - Forfait jour (08h-18h)  → produit "Course" (id 217), qté = nb dépanneuses
//   - Forfait nuit (18h-08h)  → produit "Course" (id 217), qté = nb dépanneuses
//   - Supplément horaire      → produit "hsupplcircuit" (id 216), qté = nb dép. × heures
const PRODUCT_REF_COURSE   = 'Course'         // 217 — Prestation Circuit (forfait)
const PRODUCT_REF_HSUPP    = 'hsupplcircuit'  // 216 — Heure supplémentaire

export interface RaceSupp { from: string; to: string; nb?: number }   // nb dépanneuses du supplément (défaut = nb du jour)
export interface RaceDay {
  date:            string   // YYYY-MM-DD
  nb_depanneuses:  number
  jour:            boolean  // forfait jour 08h-18h
  nuit:            boolean  // forfait nuit 18h-08h
  supps?:          RaceSupp[]   // suppléments (plusieurs possibles) — chacun 'de-à'
  note?:           string       // note libre du jour (affichée sous la section)
}

/** Prix de vente HTVA d'un produit (list_price). */
async function readProductPrice(id: number): Promise<number> {
  const p = await odooRpc<any[]>('product.product', 'read', [[id], ['list_price']])
  return p?.[0]?.list_price ?? 0
}
/** Ligne de note « heures supplémentaires » à mettre en bas de tout devis circuit. */
async function hsuppNoteLine(seq: number): Promise<any> {
  let price = 0
  try { price = await readProductPrice(await findProductIdByCode(PRODUCT_REF_HSUPP)) } catch { /* défaut ci-dessous */ }
  const p = price || 75
  return [0, 0, { display_type: 'line_note', name: `Toute heure supplémentaire est facturée au prix de ${p}€ HTVA par heure.`, sequence: seq }]
}

/** Heures de supplément déduites de la plage « de-à » (gère le passage minuit). */
export function suppHours(from?: string, to?: string): number {
  if (!from || !to) return 0
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  let diff = mins(to) - mins(from)
  if (diff < 0) diff += 24 * 60          // ex. 22:00 → 02:00
  return Math.round((diff / 60) * 100) / 100
}

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const fmtDayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const wd = JOURS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${wd} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

/** Crée un devis (sale.order) BROUILLON pour un week-end de course : une section
 *  par jour, suivie des lignes forfait jour / nuit / supplément (× nb dépanneuses). */
export async function createRaceWeekendQuote(input: {
  partnerId: number
  label:     string
  days:      RaceDay[]
  notes?:    string
  confirm?:  boolean
  existingOrderId?: number   // si fourni → met à jour le devis existant (réécrit ses lignes)
}): Promise<{ id: number; name: string }> {
  if (!input.partnerId) throw new Error('partnerId requis')
  const hasSupp = (d: RaceDay) => (d.supps || []).some(s => suppHours(s.from, s.to) > 0)
  const days = (input.days || []).filter(d => d?.date && (d.jour || d.nuit || hasSupp(d)))
  if (!days.length) throw new Error('Au moins un jour avec forfait ou supplément requis')

  const courseId = await findProductIdByCode(PRODUCT_REF_COURSE)
  const hsuppId  = await findProductIdByCode(PRODUCT_REF_HSUPP)

  const lineTuples: any[] = []
  let seq = 10
  for (const d of days) {
    const n = Math.max(1, d.nb_depanneuses || 1)
    // Section du jour (+ note du jour éventuelle)
    lineTuples.push([0, 0, { display_type: 'line_section', name: `${fmtDayLabel(d.date)} — ${n} dépanneuse${n > 1 ? 's' : ''}`, sequence: seq++ }])
    if (d.note && d.note.trim()) lineTuples.push([0, 0, { display_type: 'line_note', name: d.note.trim(), sequence: seq++ }])
    if (d.jour)  lineTuples.push([0, 0, { product_id: courseId, product_uom_qty: n, name: 'Forfait jour (08h-18h)',  sequence: seq++ }])
    if (d.nuit)  lineTuples.push([0, 0, { product_id: courseId, product_uom_qty: n, name: 'Forfait nuit (18h-08h)',  sequence: seq++ }])
    for (const s of (d.supps || [])) {
      const sh = suppHours(s.from, s.to)
      const sn = Math.max(1, Number(s.nb) || n)
      if (sh > 0) lineTuples.push([0, 0, { product_id: hsuppId, product_uom_qty: sn * sh, name: `Supplément horaire (de ${s.from} à ${s.to})${sn !== n ? ` — ${sn} dépanneuse${sn > 1 ? 's' : ''}` : ''}`, sequence: seq++ }])
    }
  }

  // Note obligatoire en bas de tout devis circuit.
  lineTuples.push(await hsuppNoteLine(seq++))

  // Mise à jour en place (on repart de zéro : unlink toutes les lignes + recrée)
  // pour que les suppléments ajoutés retombent dans la bonne section.
  if (input.existingOrderId) {
    const st = (await odooRpc<any[]>('sale.order', 'read', [[input.existingOrderId]], { fields: ['state'] }))?.[0]?.state
    if (st === 'draft' || st === 'sent') {
      await odooRpc('sale.order', 'write', [[input.existingOrderId], { order_line: [[5, 0, 0], ...lineTuples], client_order_ref: input.label }])
      const o = await odooRpc<any[]>('sale.order', 'read', [[input.existingOrderId]], { fields: ['id', 'name'] })
      return { id: input.existingOrderId, name: o[0]?.name || `S${input.existingOrderId}` }
    }
    // devis confirmé/facturé → on ne réécrit pas ; on crée un nouveau devis.
  }

  const orderId = await odooRpc<number>('sale.order', 'create', [{
    partner_id:       input.partnerId,
    client_order_ref: input.label || 'Week-end de course — Circuit Spa-Francorchamps',
    order_line:       lineTuples,
  }])

  // Par défaut on laisse en BROUILLON (test). Confirmation optionnelle.
  if (input.confirm) {
    try { await odooRpc('sale.order', 'action_confirm', [[orderId]]) }
    catch (e: any) { console.warn(`[Odoo Course] action_confirm KO order=${orderId}:`, e?.message) }
  }
  if (input.notes && input.notes.trim()) {
    await odooRpc('sale.order', 'message_post', [[orderId]], { body: input.notes.trim(), message_type: 'comment', subtype_id: 2 }).catch(() => {})
  }

  const orders = await odooRpc<any[]>('sale.order', 'read', [[orderId]], { fields: ['id', 'name'] })
  return { id: orderId, name: orders[0]?.name || `S${orderId}` }
}
