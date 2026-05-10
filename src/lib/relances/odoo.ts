// ============================================================
// Module Relance — Helper Odoo (account.move + res.partner)
// ============================================================
// Récupère les factures clients échues depuis Odoo, les regroupe par
// partenaire, calcule le niveau de relance (1/2/3) selon le retard max.
//
// Standard belge strict :
//   L1 = retard >= 15 jours  (amical)
//   L2 = retard >= 30 jours  (ferme)
//   L3 = retard >= 60 jours  (mise en demeure renvoyant aux CGV)
//
// Source factures = Odoo account.move (move_type = out_invoice, state = posted,
// payment_state in [not_paid, partial]). Le tracking des envois reste en
// Supabase (table invoice_reminders) pour ne pas polluer le chatter Odoo.

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8', 10)
const ODOO_API_KEY = process.env.ODOO_API_KEY!

async function rpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
      },
    }),
  })
  const data = await res.json()
  if (data.error) {
    throw new Error(`Odoo [${model}.${method}] ${JSON.stringify(data.error?.data?.message ?? data.error)}`)
  }
  return data.result
}

export type ReminderLevel = 1 | 2 | 3

/**
 * Calcule le niveau de relance selon le retard maximum (en jours pleins).
 * Retourne null si la facture n'est pas encore éligible (retard < 15j).
 */
export function computeLevel(daysOverdue: number): ReminderLevel | null {
  if (daysOverdue >= 60) return 3
  if (daysOverdue >= 30) return 2
  if (daysOverdue >= 15) return 1
  return null
}

export interface OverdueInvoice {
  id:               number   // account.move.id
  name:             string   // ex "INV/2025/00042"
  invoiceDate:      string   // YYYY-MM-DD (invoice_date)
  dueDate:          string   // YYYY-MM-DD (invoice_date_due)
  daysOverdue:      number   // jours pleins entre dueDate et today
  level:            ReminderLevel  // niveau propre a cette facture (basé sur daysOverdue)
  amountTotal:      number   // amount_total TVAC
  amountResidual:   number   // amount_residual TVAC (restant dû)
  plate:            string | null  // immatriculation si liee a un fleet.vehicle via sale.order
  vehicleLabel:     string | null  // ex "BMW X5" si vehicule resolu
}

export interface PartnerOverdueGroup {
  partnerId:       number
  partnerName:     string
  partnerRef:      string | null   // res.partner.ref — référence interne client Odoo
  partnerEmail:    string | null   // res.partner.email — null = ne peut pas être relancé par email
  partnerVat:      string | null
  partnerPhone:    string | null
  invoices:        OverdueInvoice[]
  totalResidual:   number          // somme amount_residual
  maxDaysOverdue:  number          // retard max sur le groupe
  level:           ReminderLevel   // niveau découlant de maxDaysOverdue
}

export interface OverdueResult {
  groups:   PartnerOverdueGroup[]
  truncated: boolean   // true si on a hit le limit search_read (donnees potentiellement incompletes)
  fetched:   number    // nombre de factures lues
}

// Limite haute par paginate. 5000 = large pour VD, mais on pagine quand meme
// par chunks de 500 pour eviter les payloads enormes en cas de purge tardive.
const PAGE_SIZE = 500
const MAX_FETCH = 5000   // si on hit ca, on renvoie truncated=true a l UI

/**
 * Récupère TOUTES les factures clients Odoo échues depuis >= 15 jours,
 * non payées (ou partiellement), groupées par partenaire avec calcul du
 * niveau de relance maximum.
 *
 * - Pagine search_read par chunks PAGE_SIZE jusqu a MAX_FETCH (un seul
 *   client tres ancien comme le Parquet peut a lui seul saturer un limit
 *   trop bas et masquer tous les autres dans le retour).
 * - 1 read res.partner pour les partenaires uniques concernes (pas de N+1).
 * - Le tri du résultat est par maxDaysOverdue desc (les plus gros retards
 *   d'abord — c'est le plus utile UI).
 * - Filtre les partenaires sans email (impossibles à relancer par mail).
 *   Ils sont retournés avec partnerEmail=null pour que l'UI les affiche
 *   en "à appeler" (Phase 2 future) sans les inclure dans l'envoi groupé.
 */
export async function getOverdueInvoicesGroupedByPartner(): Promise<OverdueResult> {
  const today = new Date()
  const cutoff15 = new Date(today)
  cutoff15.setDate(cutoff15.getDate() - 15)
  const cutoffStr = cutoff15.toISOString().slice(0, 10) // YYYY-MM-DD

  const domain = [
    ['move_type',         '=',  'out_invoice'],
    ['state',             '=',  'posted'],
    ['payment_state',     'in', ['not_paid', 'partial']],
    ['invoice_date_due',  '!=', false],
    ['invoice_date_due',  '<=', cutoffStr],
    ['amount_residual',   '>',  0],
  ]

  // Champ custom sale.order qui pointe vers fleet.vehicle (cf src/lib/odoo.ts).
  const FIELD_PLAQUE = 'x_studio_many2one_field_78n_1j6fmmeom'

  // 1. Fetch pagine de toutes les factures clients echues >= 15j non soldees
  const moves: any[] = []
  let truncated = false
  for (let offset = 0; offset < MAX_FETCH; offset += PAGE_SIZE) {
    const page = await rpc<any[]>(
      'account.move',
      'search_read',
      [domain],
      {
        fields: ['id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due',
                 'amount_total', 'amount_residual', 'invoice_origin'],
        order:  'invoice_date_due asc',
        limit:  PAGE_SIZE,
        offset,
      }
    )
    moves.push(...page)
    if (page.length < PAGE_SIZE) break  // derniere page atteinte
    if (offset + PAGE_SIZE >= MAX_FETCH) {
      truncated = true   // on a hit le plafond, il y a probablement encore
      break
    }
  }

  if (moves.length === 0) return { groups: [], truncated, fetched: 0 }

  // 1bis. Lookup vehicules : invoice_origin (string) -> sale.order.name -> vehicle_id.
  // Chez VD, le champ custom FIELD_PLAQUE sur sale.order pointe vers fleet.vehicle.
  // On batche en 1 search_read sale.order (par name in [...]) puis 1 read fleet.vehicle.
  // Si invoice_origin null/multi/inconnu : plate=null, vehicleLabel=null pour cette facture.
  const orderNames = Array.from(new Set(
    moves.map(m => typeof m.invoice_origin === 'string' ? m.invoice_origin.trim() : null)
         .filter((n): n is string => !!n && n.length > 0)
  ))
  const vehicleByOrderName = new Map<string, { plate: string | null; label: string | null }>()
  if (orderNames.length > 0) {
    try {
      const orders = await rpc<any[]>(
        'sale.order',
        'search_read',
        [[['name', 'in', orderNames]]],
        { fields: ['id', 'name', FIELD_PLAQUE], limit: orderNames.length + 100 }
      )
      const vehicleIds = Array.from(new Set(
        orders.map(o => {
          const v = (o as any)[FIELD_PLAQUE]
          return Array.isArray(v) ? v[0] : (typeof v === 'number' ? v : null)
        }).filter((id): id is number => typeof id === 'number')
      ))
      let vehicleById = new Map<number, any>()
      if (vehicleIds.length > 0) {
        const vehicles = await rpc<any[]>(
          'fleet.vehicle',
          'read',
          [vehicleIds],
          { fields: ['id', 'license_plate', 'model_id'] }
        )
        vehicleById = new Map(vehicles.map(v => [v.id, v]))
      }
      for (const o of orders) {
        const vRaw = (o as any)[FIELD_PLAQUE]
        const vId  = Array.isArray(vRaw) ? vRaw[0] : (typeof vRaw === 'number' ? vRaw : null)
        if (!vId) {
          vehicleByOrderName.set(o.name, { plate: null, label: null })
          continue
        }
        const v = vehicleById.get(vId)
        if (!v) {
          vehicleByOrderName.set(o.name, { plate: null, label: null })
          continue
        }
        const modelLabel = Array.isArray(v.model_id) ? (v.model_id[1] as string) : null
        vehicleByOrderName.set(o.name, {
          plate: v.license_plate || null,
          label: modelLabel || null,
        })
      }
    } catch (e: any) {
      // Lookup vehicule = best-effort, ne doit pas bloquer la liste relances
      console.error('[relances/odoo] vehicle lookup failed:', e.message)
    }
  }

  // 2. Fetch unique des partenaires concernés (un seul read batch)
  const partnerIds = Array.from(new Set(
    moves.map(m => Array.isArray(m.partner_id) ? m.partner_id[0] : m.partner_id)
         .filter((id): id is number => typeof id === 'number')
  ))
  // NB: 'mobile' n'existe pas sur res.partner dans cette base Odoo
  // (selon la version/config — chez VD seul 'phone' est dispo).
  // 'ref' = reference interne client (visible Odoo dans la fiche client).
  const partners = await rpc<any[]>(
    'res.partner',
    'read',
    [partnerIds],
    { fields: ['id', 'name', 'ref', 'email', 'vat', 'phone'] }
  )
  const partnerById = new Map<number, any>(partners.map(p => [p.id, p]))

  // 3. Regrouper par partenaire + calcul niveau
  const groups = new Map<number, PartnerOverdueGroup>()

  for (const m of moves) {
    const partnerId = Array.isArray(m.partner_id) ? m.partner_id[0] : m.partner_id
    if (typeof partnerId !== 'number') continue
    const partner = partnerById.get(partnerId)
    if (!partner) continue

    const dueDateStr = m.invoice_date_due as string
    const dueDate    = new Date(dueDateStr + 'T00:00:00Z')
    const todayUtc   = new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z')
    const daysOverdue = Math.floor((todayUtc.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

    const invLevel = computeLevel(daysOverdue) ?? 1
    const origin   = typeof m.invoice_origin === 'string' ? m.invoice_origin.trim() : ''
    const veh      = origin ? vehicleByOrderName.get(origin) : null
    const invoice: OverdueInvoice = {
      id:             m.id,
      name:           m.name,
      invoiceDate:    m.invoice_date,
      dueDate:        dueDateStr,
      daysOverdue,
      level:          invLevel,
      amountTotal:    Number(m.amount_total) || 0,
      amountResidual: Number(m.amount_residual) || 0,
      plate:          veh?.plate || null,
      vehicleLabel:   veh?.label || null,
    }

    let group = groups.get(partnerId)
    if (!group) {
      group = {
        partnerId,
        partnerName:    partner.name || 'Inconnu',
        partnerRef:     partner.ref || null,
        partnerEmail:   partner.email || null,
        partnerVat:     partner.vat || null,
        partnerPhone:   partner.phone || null,
        invoices:       [],
        totalResidual:  0,
        maxDaysOverdue: 0,
        level:          1,
      }
      groups.set(partnerId, group)
    }
    group.invoices.push(invoice)
    group.totalResidual  += invoice.amountResidual
    group.maxDaysOverdue  = Math.max(group.maxDaysOverdue, daysOverdue)
  }

  // 4. Calcul niveau final + tri (plus gros retards d'abord)
  const result: PartnerOverdueGroup[] = []
  for (const g of groups.values()) {
    const lvl = computeLevel(g.maxDaysOverdue)
    if (lvl === null) continue   // safe-guard, ne devrait pas arriver vu le filtre cutoff
    g.level = lvl
    g.totalResidual = Math.round(g.totalResidual * 100) / 100
    result.push(g)
  }
  result.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue)

  return { groups: result, truncated, fetched: moves.length }
}
