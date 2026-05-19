// src/lib/odoo-quote.ts
//
// Phase 2 facturation : creation / update de devis Odoo (sale.order) depuis
// l app. Cf [[facturation-phase2]].
//
// Principes :
//   - 4 produits generiques Odoo (SERV-PEC/KM/PARC/MAJ) cree par Olivier
//   - L app push les lignes avec `name` custom et `price_unit` calcule
//   - Odoo gere la facturation partielle via qty_to_invoice (N factures
//     depuis 1 devis)
//   - Lookup des product_id via default_code (plus robuste qu un id en dur)
//
// Champ Studio sale.order : x_studio_many2one_field_78n_1j6fmmeom -> fleet.vehicle

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

const PRODUCT_CODES = ['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV'] as const
type ProductCode = typeof PRODUCT_CODES[number]

const VEHICLE_FIELD = 'x_studio_many2one_field_78n_1j6fmmeom'

async function rpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method:  'call',
      id:      Date.now(),
      params:  {
        service: 'object',
        method:  'execute_kw',
        args:    [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
      },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo ${model}.${method}: ${JSON.stringify(data.error)}`)
  return data.result
}

// Cache process-level pour eviter de re-lookup les products a chaque appel.
let _productIdCache: Map<ProductCode, number> | null = null
let _productCacheLoadedAt = 0
const CACHE_TTL_MS = 60 * 60 * 1000  // 1h

async function getProductIds(): Promise<Map<ProductCode, number>> {
  const now = Date.now()
  if (_productIdCache && now - _productCacheLoadedAt < CACHE_TTL_MS) {
    return _productIdCache
  }
  const products = await rpc<any[]>('product.product', 'search_read',
    [[['default_code', 'in', [...PRODUCT_CODES]]]],
    { fields: ['id', 'default_code'], limit: 10 },
  )
  const map = new Map<ProductCode, number>()
  for (const p of (products || [])) {
    if (PRODUCT_CODES.includes(p.default_code)) {
      map.set(p.default_code as ProductCode, p.id)
    }
  }
  // Verifie qu on a bien les 5 produits generiques
  for (const code of PRODUCT_CODES) {
    if (!map.has(code)) {
      throw new Error(`Produit Odoo "${code}" introuvable (default_code). Verifie que les 5 produits generiques SERV-PEC/KM/PARC/MAJ/DIV sont crees.`)
    }
  }
  _productIdCache = map
  _productCacheLoadedAt = now
  return map
}

/** Une ligne de devis prete a push vers Odoo. */
export interface QuoteLine {
  kind:        ProductCode        // SERV-PEC / SERV-KM / SERV-PARC / SERV-MAJ
  name:        string              // description custom (ecrasera le nom du produit)
  qty:         number               // quantite (pour la majoration : % en decimal, ex 0.30)
  price_unit:  number               // prix unitaire HT (pour la majoration : total HT majorable)
}

export interface QuoteSection {
  /** Label de section (pour les chaines REM+REL), ex: "REM #M-2026-001234".
   *  Si fourni, on prefixe les lignes par un display_type='line_section' Odoo. */
  section_label?: string
  lines:          QuoteLine[]
}

export interface CreateQuoteInput {
  /** ID Odoo du client final (res.partner). REQUIS. */
  partner_id:   number
  /** Reference mission cote VD Soft (ira dans `origin` Odoo). */
  origin:       string
  /** Reference client (dossier ex: dossier_number). Va dans client_order_ref. */
  client_order_ref?: string
  /** ID Odoo du fleet.vehicle (champ Studio). Optionnel. */
  fleet_vehicle_id?: number | null
  /** Sections de lignes a inclure. Si une seule section sans label, on ne met pas de display_type. */
  sections:     QuoteSection[]
}

/** Construit l URL web Odoo d un devis pour ouverture directe. */
export function buildQuoteUrl(quoteId: number): string {
  return `${ODOO_URL}/web#id=${quoteId}&model=sale.order&view_type=form`
}

/** Build le tableau `order_line` (format Odoo many2many tuple) a partir des sections. */
async function buildOrderLines(sections: QuoteSection[]): Promise<any[]> {
  const productIds = await getProductIds()
  const lines: any[] = []
  const showSections = sections.length > 1 || sections.some(s => s.section_label)

  for (const section of sections) {
    if (showSections && section.section_label) {
      // Ligne de section (titre dans le devis Odoo)
      lines.push([0, 0, {
        display_type: 'line_section',
        name:         section.section_label,
      }])
    }
    for (const ln of section.lines) {
      lines.push([0, 0, {
        product_id:      productIds.get(ln.kind),
        name:            ln.name,
        product_uom_qty: ln.qty,
        price_unit:      ln.price_unit,
      }])
    }
  }
  return lines
}

/**
 * Cree un nouveau sale.order Odoo en draft avec les lignes fournies.
 * Retourne l id Odoo + l URL d acces direct.
 */
export async function createSaleOrder(input: CreateQuoteInput): Promise<{ id: number; url: string }> {
  const orderLines = await buildOrderLines(input.sections)
  const vals: any = {
    partner_id:        input.partner_id,
    origin:            input.origin,
    client_order_ref:  input.client_order_ref || null,
    order_line:        orderLines,
  }
  if (input.fleet_vehicle_id) {
    vals[VEHICLE_FIELD] = input.fleet_vehicle_id
  }
  const id = await rpc<number>('sale.order', 'create', [vals])
  return { id, url: buildQuoteUrl(id) }
}

/** Erreur jetee si le devis cible n existe plus (supprime cote Odoo). */
export class QuoteNotFoundError extends Error {
  constructor(quoteId: number) {
    super(`Devis Odoo ${quoteId} introuvable (probablement supprime)`)
    this.name = 'QuoteNotFoundError'
  }
}

/**
 * Update un sale.order existant : on remplace toutes les lignes (unlink + recreate).
 * Garde le partner_id / origin / fleet_vehicle_id inchanges sauf si fournis.
 * Throws QuoteNotFoundError si le devis a ete supprime cote Odoo.
 */
export async function updateSaleOrder(quoteId: number, input: Partial<CreateQuoteInput>): Promise<{ id: number; url: string }> {
  // Verifie d abord l existence pour eviter d ecrire dans le vide
  let existingLineIds: number[] = []
  try {
    const existing = await rpc<any[]>('sale.order', 'read', [[quoteId], ['order_line', 'state']])
    if (!existing || existing.length === 0) {
      throw new QuoteNotFoundError(quoteId)
    }
    existingLineIds = existing[0].order_line || []
  } catch (e: any) {
    const msg = String(e.message || '')
    if (msg.includes('does not exist') || msg.includes('Missing') || msg.includes('AccessError')) {
      throw new QuoteNotFoundError(quoteId)
    }
    throw e
  }

  const vals: any = {}
  if (input.partner_id != null)        vals.partner_id        = input.partner_id
  if (input.origin != null)            vals.origin            = input.origin
  if (input.client_order_ref != null)  vals.client_order_ref  = input.client_order_ref
  if (input.fleet_vehicle_id != null)  vals[VEHICLE_FIELD]    = input.fleet_vehicle_id

  if (input.sections) {
    const newLines = await buildOrderLines(input.sections)
    const orderLineCmds = [
      ...existingLineIds.map(id => [2, id, false]),  // delete each existing line
      ...newLines,                                   // create new lines
    ]
    vals.order_line = orderLineCmds
  }

  await rpc<boolean>('sale.order', 'write', [[quoteId], vals])
  return { id: quoteId, url: buildQuoteUrl(quoteId) }
}

/** Lookup l ID Odoo d un fleet.vehicle par sa plaque (best-effort). */
export async function findFleetVehicleByPlate(plate: string): Promise<number | null> {
  if (!plate) return null
  try {
    const results = await rpc<any[]>('fleet.vehicle', 'search_read',
      [[['license_plate', '=', plate.trim().toUpperCase()]]],
      { fields: ['id'], limit: 1 },
    )
    return results?.[0]?.id || null
  } catch (e: any) {
    console.warn('[odoo-quote] findFleetVehicleByPlate error:', e.message)
    return null
  }
}

/** Lookup l ID Odoo d un res.partner par nom (best-effort, retourne null si ambigu). */
export async function findPartnerByName(name: string): Promise<number | null> {
  if (!name) return null
  try {
    // ilike pour souplesse (insensible casse), limit 2 pour detecter l ambiguite
    const results = await rpc<any[]>('res.partner', 'search_read',
      [[['name', '=ilike', name.trim()]]],
      { fields: ['id'], limit: 2 },
    )
    if (!results || results.length === 0) return null
    if (results.length > 1) {
      console.warn(`[odoo-quote] findPartnerByName ambigu pour "${name}", ${results.length} resultats`)
      return null
    }
    return results[0].id
  } catch (e: any) {
    console.warn('[odoo-quote] findPartnerByName error:', e.message)
    return null
  }
}
