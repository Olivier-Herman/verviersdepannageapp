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

// Produits Odoo utilises pour les devis :
//   - SERV-* : 5 produits generiques utilises par le module Facturation Phase 2
//     pour les missions classiques (assistance, prive, etc.). Cf [[facturation-phase2]].
//   - PECMG       : forfait enlevement Mal Garee (fourriere police)
//   - GARDIENNAGE : journee de gardiennage parc fourriere (Mal Garee et autres
//     types fourriere). Quantite = nombre de jours, prix unitaire = 20 EUR HTVA.
const PRODUCT_CODES = [
  // Generiques Facturation Phase 2
  'SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV',
  // Fourriere police
  'PECMG', 'PECRODEO', 'PECAVP', 'GARDIENNAGE',
  // SNC (Siabis Non Couvert)
  'SIAREM', 'SIAKIL', 'SIABAL',
  'PECSIAMAJ', 'SIAKILMAJ', 'SIABALMAJ',
] as const
type ProductCode = typeof PRODUCT_CODES[number]
export type { ProductCode }

const VEHICLE_FIELD = 'x_studio_many2one_field_78n_1j6fmmeom'

// Olivier 2026-06-24 (fix clé perso) : ce module avait son PROPRE rpc codé en dur
// sur ODOO_API_KEY (service account "VD App") → les devis étaient créés au nom de
// VD App même quand le user a une clé Odoo perso. On délègue désormais à odooRpc
// (@/lib/odoo) qui lit l'acteur courant (withOdooActor) et utilise sa clé perso
// si présente, sinon le service account. Comportement identique hors contexte acteur.
async function rpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const { odooRpc } = await import('@/lib/odoo')
  return odooRpc<T>(model, method, args, kwargs)
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
    { fields: ['id', 'default_code'], limit: 20 },
  )
  const map = new Map<ProductCode, number>()
  for (const p of (products || [])) {
    if (PRODUCT_CODES.includes(p.default_code)) {
      map.set(p.default_code as ProductCode, p.id)
    }
  }
  // Note : on ne throw plus si un code manque. Le check se fait au push (cf
  // buildOrderLines) sur les codes REELLEMENT utilises. Permet d ajouter de
  // nouveaux produits Odoo sans casser tous les flows.
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
  /** Descriptif d'intervention (date/heure, prise en charge, destination) affiché
   *  en tête du devis/facture sous forme de note. Olivier 2026-06-29. */
  description?: string
}

/** Construit l URL web Odoo d un devis pour ouverture directe. */
export function buildQuoteUrl(quoteId: number): string {
  return `${ODOO_URL}/web#id=${quoteId}&model=sale.order&view_type=form`
}

/** Build le tableau `order_line` (format Odoo many2many tuple) a partir des sections. */
async function buildOrderLines(sections: QuoteSection[], description?: string): Promise<any[]> {
  const productIds = await getProductIds()
  const lines: any[] = []
  const showSections = sections.length > 1 || sections.some(s => s.section_label)

  // Descriptif d'intervention en tête (note Odoo, visible sur le devis/facture).
  if (description && description.trim()) {
    lines.push([0, 0, { display_type: 'line_note', name: description.trim() }])
  }

  for (const section of sections) {
    if (showSections && section.section_label) {
      // Ligne de section (titre dans le devis Odoo)
      lines.push([0, 0, {
        display_type: 'line_section',
        name:         section.section_label,
      }])
    }
    for (const ln of section.lines) {
      const productId = productIds.get(ln.kind)
      if (!productId) {
        throw new Error(`Produit Odoo "${ln.kind}" introuvable (default_code). Verifie qu il existe avec ce code dans Odoo (product.product).`)
      }
      lines.push([0, 0, {
        product_id:      productId,
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
  const orderLines = await buildOrderLines(input.sections, input.description)
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

// ── Facture directe (account.move) — sans passer par le devis ────────────────
// Champs Studio account.move (découverts via ir.model.fields) :
//   - véhicule  : x_studio_plaque       (many2one → fleet.vehicle)
//   - référence : x_studio_reference    (char) + standards invoice_origin / ref
const INVOICE_VEHICLE_FIELD = 'x_studio_plaque'
const INVOICE_REF_FIELD     = 'x_studio_reference'

/** URL web Odoo d'une facture (account.move). */
export function buildInvoiceMoveUrl(moveId: number): string {
  return `${ODOO_URL}/web#id=${moveId}&model=account.move&view_type=form`
}

/** Lignes de facture (account.move.line) : idem devis mais `quantity` au lieu de `product_uom_qty`. */
async function buildInvoiceLines(sections: QuoteSection[], description?: string): Promise<any[]> {
  const productIds = await getProductIds()
  const lines: any[] = []
  const showSections = sections.length > 1 || sections.some(s => s.section_label)

  if (description && description.trim()) {
    lines.push([0, 0, { display_type: 'line_note', name: description.trim() }])
  }
  for (const section of sections) {
    if (showSections && section.section_label) {
      lines.push([0, 0, { display_type: 'line_section', name: section.section_label }])
    }
    for (const ln of section.lines) {
      const productId = productIds.get(ln.kind)
      if (!productId) {
        throw new Error(`Produit Odoo "${ln.kind}" introuvable (default_code).`)
      }
      lines.push([0, 0, {
        product_id: productId,
        name:       ln.name,
        quantity:   ln.qty,
        price_unit: ln.price_unit,
      }])
    }
  }
  return lines
}

/**
 * Crée directement une FACTURE CLIENT (account.move `out_invoice`) en BROUILLON,
 * sans devis. Porte le véhicule (x_studio_plaque) + la référence (invoice_origin
 * + ref + x_studio_reference), comme le devis. L'employé la poste ensuite dans
 * Odoo (numéro définitif + paiement/caisse → hors app). Olivier 2026-07-26.
 */
export async function createDraftInvoice(input: CreateQuoteInput): Promise<{ id: number; url: string }> {
  const invoiceLines = await buildInvoiceLines(input.sections, input.description)
  const vals: any = {
    move_type:        'out_invoice',
    partner_id:       input.partner_id,
    invoice_origin:   input.origin,
    ref:              input.client_order_ref || input.origin || false,
    invoice_line_ids: invoiceLines,
  }
  if (input.origin) vals[INVOICE_REF_FIELD] = input.origin
  if (input.fleet_vehicle_id) vals[INVOICE_VEHICLE_FIELD] = input.fleet_vehicle_id
  const id = await rpc<number>('account.move', 'create', [vals])
  return { id, url: buildInvoiceMoveUrl(id) }
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
  let orderState = 'draft'
  try {
    const existing = await rpc<any[]>('sale.order', 'read', [[quoteId], ['order_line', 'state']])
    if (!existing || existing.length === 0) {
      throw new QuoteNotFoundError(quoteId)
    }
    existingLineIds = existing[0].order_line || []
    orderState      = existing[0].state || 'draft'
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
    const newLines = await buildOrderLines(input.sections, input.description)
    // Olivier 2026-06-22 (fix bug facturation) : Odoo INTERDIT de supprimer une
    // ligne d'une commande CONFIRMÉE (state sale/done) — "définissez plutôt la
    // quantité sur 0". Donc :
    //   - devis brouillon (draft/sent)  → delete + recreate (propre)
    //   - commande confirmée (sale/done) → on met les anciennes lignes à qty 0
    //     (au lieu de les supprimer) puis on ajoute les nouvelles lignes.
    const isConfirmed = orderState === 'sale' || orderState === 'done'
    const removeCmds = isConfirmed
      ? existingLineIds.map(id => [1, id, { product_uom_qty: 0 }]) // update qty -> 0
      : existingLineIds.map(id => [2, id, false])                  // delete
    const orderLineCmds = [
      ...removeCmds,
      ...newLines,        // create new lines
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

/**
 * Lookup l ID + le nom Odoo d un res.partner par code TVA (priorite) puis
 * par nom (fallback). Retourne null si rien trouve.
 *
 * Utilise par l import Kaze : payload contient un widget vatcode (BE0404484654)
 * + un widget name ("ETHIAS SA,c/o IMA BENELUX SA/NV"). Le TVA est plus fiable
 * comme identifiant unique, mais peut etre commun a plusieurs entites IMA →
 * on tente d abord le nom (s il est specifique a une assurance), puis on
 * retombe sur le TVA.
 */
export async function lookupPartner(opts: {
  vat?:        string | null
  name?:       string | null
}): Promise<{ id: number; name: string } | null> {
  // 1) Tentative par nom (s il est specifique, ex "Ethias")
  if (opts.name) {
    try {
      const r = await rpc<any[]>('res.partner', 'search_read',
        [[['name', '=ilike', opts.name.trim()]]],
        { fields: ['id', 'name'], limit: 2 },
      )
      if (r?.length === 1) return { id: r[0].id, name: r[0].name }
    } catch (e: any) {
      console.warn('[odoo lookupPartner] name search error:', e.message)
    }
  }

  // 2) Fallback par TVA (normalisation : supprime espaces et tirets)
  if (opts.vat) {
    const vat = opts.vat.replace(/[\s\-.]/g, '').toUpperCase()
    try {
      const r = await rpc<any[]>('res.partner', 'search_read',
        [[['vat', '=', vat]]],
        { fields: ['id', 'name'], limit: 2 },
      )
      if (r?.length === 1) return { id: r[0].id, name: r[0].name }
      // Plusieurs partners avec le meme TVA = on prend le premier (parfois doublons Odoo)
      if (r?.length && r.length > 1) {
        console.warn(`[odoo lookupPartner] ${r.length} partners avec TVA ${vat}, prend le premier`)
        return { id: r[0].id, name: r[0].name }
      }
    } catch (e: any) {
      console.warn('[odoo lookupPartner] vat search error:', e.message)
    }
  }

  return null
}
