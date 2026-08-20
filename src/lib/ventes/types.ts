// src/lib/ventes/types.ts
//
// Types et libellés du module « Ventes de véhicules ».
// Source unique : ce qui est ici est repris par l'admin, l'API publique et,
// demain, le site. Aucun libellé en dur ailleurs.

export type SaleOrigin      = 'abandon' | 'achat'
export type SaleMode        = 'fixed' | 'sealed' | 'auction'
export type SaleCondition   = 'roulant' | 'non_roulant' | 'pieces'
export type SaleDestination = 'circulation' | 'pieces'
export type SaleStatus      = 'draft' | 'published' | 'closed' | 'awarded' | 'sold' | 'withdrawn'
export type BidStatus       = 'pending' | 'confirmed' | 'awarded' | 'rejected' | 'withdrawn'

export const SALE_MODES: Record<SaleMode, { label: string; short: string; help: string }> = {
  fixed: {
    label: 'Prix fixe',
    short: 'Prix affiché',
    help: "Le prix est affiché, le premier qui se manifeste l'emporte. Pour les véhicules rachetés d'occasion, dont on connaît la valeur.",
  },
  sealed: {
    label: 'Enveloppe fermée',
    short: 'Au plus offrant',
    help: "Les offres ne sont pas publiées. À la clôture, on ouvre tout et on retient la meilleure — sans obligation de vendre si le prix minimum n'est pas atteint.",
  },
  auction: {
    label: 'Enchère montante',
    short: 'Enchères',
    help: "Le meilleur montant est visible et chacun peut surenchérir jusqu'à la clôture. Ça monte plus haut, mais ça attire aussi les enchères de dernière seconde.",
  },
}

export const SALE_CONDITIONS: Record<SaleCondition, string> = {
  roulant:     'Roulant',
  non_roulant: 'Ne roule plus',
  pieces:      'Pour pièces',
}

export const SALE_DESTINATIONS: Record<SaleDestination, string> = {
  circulation: 'Remise en circulation',
  pieces:      'Pièces / hors d’usage',
}

export const SALE_STATUSES: Record<SaleStatus, { label: string; public: boolean }> = {
  draft:     { label: 'Brouillon',   public: false },
  published: { label: 'En ligne',    public: true  },
  closed:    { label: 'Clôturé',     public: true  },
  awarded:   { label: 'Attribué',    public: false },
  sold:      { label: 'Vendu',       public: false },
  withdrawn: { label: 'Retiré',      public: false },
}

export interface VehicleSale {
  id: string
  reference: string
  origin: SaleOrigin
  mission_id: string | null
  purchase_price: number | null
  purchase_notes: string | null
  title: string
  brand: string | null
  model: string | null
  version: string | null
  first_registration: string | null
  mileage: number | null
  mileage_source: string | null
  fuel: string | null
  gearbox: string | null
  power_kw: number | null
  doors: number | null
  color: string | null
  plate: string | null
  vin: string | null
  condition: SaleCondition
  destination: SaleDestination
  damage: string | null
  ct_status: string | null
  carpass: boolean | null
  keys_count: number | null
  description: string | null
  photos: string[]
  sale_mode: SaleMode
  price: number | null
  reserve_price: number | null
  start_price: number | null
  bid_step: number | null
  status: SaleStatus
  opens_at: string | null
  closes_at: string | null
  depot_id: string | null
  visit_info: string | null
  awarded_bid_id: string | null
  sold_price: number | null
  sold_at: string | null
  created_at: string
  updated_at: string
}

export interface VehicleSaleBid {
  id: string
  sale_id: string
  amount: number
  bidder_name: string
  bidder_email: string
  bidder_phone: string | null
  bidder_is_pro: boolean
  bidder_vat: string | null
  intent: string | null
  message: string | null
  confirmed_at: string | null
  status: BidStatus
  created_at: string
}

/** Colonnes internes : jamais renvoyées par l'API publique. */
export const PRIVATE_FIELDS = [
  'origin', 'mission_id', 'purchase_price', 'purchase_notes',
  'plate', 'vin', 'reserve_price', 'created_by',
] as const

/** Colonnes exposées au site public. */
export const PUBLIC_COLUMNS =
  'id, reference, title, brand, model, version, first_registration, mileage, mileage_source, ' +
  'fuel, gearbox, power_kw, doors, color, condition, destination, damage, ct_status, carpass, ' +
  'keys_count, description, photos, sale_mode, price, start_price, bid_step, status, ' +
  'opens_at, closes_at, visit_info'

/**
 * Ce qu'on montre du carnet d'offres, selon le mode.
 * En enveloppe fermée on publie le NOMBRE d'offres, jamais les montants :
 * c'est tout l'intérêt du mode.
 */
export function publicBidSummary(
  mode: SaleMode,
  bids: { amount: number; status: BidStatus }[],
): { count: number; best: number | null } {
  const live = bids.filter(b => b.status === 'confirmed' || b.status === 'awarded')
  return {
    count: live.length,
    best: mode === 'auction' && live.length ? Math.max(...live.map(b => b.amount)) : null,
  }
}

/** Montant minimum acceptable pour une nouvelle offre. */
export function minimumBid(
  sale: Pick<VehicleSale, 'sale_mode' | 'price' | 'start_price' | 'bid_step'>,
  bestSoFar: number | null,
): number {
  if (sale.sale_mode === 'fixed')  return Number(sale.price ?? 0)
  if (sale.sale_mode === 'auction') {
    const step = Number(sale.bid_step ?? 25)
    if (bestSoFar != null) return bestSoFar + step
    return Number(sale.start_price ?? 1)
  }
  return 1 // enveloppe fermée : libre, c'est le prix de réserve qui tranche
}
