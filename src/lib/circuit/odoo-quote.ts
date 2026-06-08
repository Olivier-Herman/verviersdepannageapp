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
