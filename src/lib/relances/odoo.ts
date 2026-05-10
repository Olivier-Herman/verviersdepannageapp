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
  amountTotal:      number   // amount_total TVAC
  amountResidual:   number   // amount_residual TVAC (restant dû)
}

export interface PartnerOverdueGroup {
  partnerId:       number
  partnerName:     string
  partnerEmail:    string | null   // res.partner.email — null = ne peut pas être relancé par email
  partnerVat:      string | null
  partnerPhone:    string | null
  invoices:        OverdueInvoice[]
  totalResidual:   number          // somme amount_residual
  maxDaysOverdue:  number          // retard max sur le groupe
  level:           ReminderLevel   // niveau découlant de maxDaysOverdue
}

/**
 * Récupère TOUTES les factures clients Odoo échues depuis >= 15 jours,
 * non payées (ou partiellement), groupées par partenaire avec calcul du
 * niveau de relance maximum.
 *
 * - Fait UN seul search_read account.move (filtre Odoo côté serveur sur
 *   invoice_date_due <= cutoff15j) puis UN seul read res.partner pour les
 *   partenaires concernés (pas de N+1).
 * - Le tri du résultat est par maxDaysOverdue desc (les plus gros retards
 *   d'abord — c'est le plus utile UI).
 * - Filtre les partenaires sans email (impossibles à relancer par mail).
 *   Ils sont retournés avec partnerEmail=null pour que l'UI les affiche
 *   en "à appeler" (Phase 2 future) sans les inclure dans l'envoi groupé.
 */
export async function getOverdueInvoicesGroupedByPartner(): Promise<PartnerOverdueGroup[]> {
  const today = new Date()
  const cutoff15 = new Date(today)
  cutoff15.setDate(cutoff15.getDate() - 15)
  const cutoffStr = cutoff15.toISOString().slice(0, 10) // YYYY-MM-DD

  // 1. Fetch toutes les factures clients échues >= 15j non soldées
  const moves = await rpc<any[]>(
    'account.move',
    'search_read',
    [[
      ['move_type',         '=',  'out_invoice'],
      ['state',             '=',  'posted'],
      ['payment_state',     'in', ['not_paid', 'partial']],
      ['invoice_date_due',  '!=', false],
      ['invoice_date_due',  '<=', cutoffStr],
      ['amount_residual',   '>',  0],
    ]],
    {
      fields: ['id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due',
               'amount_total', 'amount_residual'],
      order:  'invoice_date_due asc',
      limit:  500,
    }
  )

  if (moves.length === 0) return []

  // 2. Fetch unique des partenaires concernés (un seul read batch)
  const partnerIds = Array.from(new Set(
    moves.map(m => Array.isArray(m.partner_id) ? m.partner_id[0] : m.partner_id)
         .filter((id): id is number => typeof id === 'number')
  ))
  const partners = await rpc<any[]>(
    'res.partner',
    'read',
    [partnerIds],
    { fields: ['id', 'name', 'email', 'vat', 'phone', 'mobile'] }
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

    const invoice: OverdueInvoice = {
      id:             m.id,
      name:           m.name,
      invoiceDate:    m.invoice_date,
      dueDate:        dueDateStr,
      daysOverdue,
      amountTotal:    Number(m.amount_total) || 0,
      amountResidual: Number(m.amount_residual) || 0,
    }

    let group = groups.get(partnerId)
    if (!group) {
      group = {
        partnerId,
        partnerName:    partner.name || 'Inconnu',
        partnerEmail:   partner.email || null,
        partnerVat:     partner.vat || null,
        partnerPhone:   partner.phone || partner.mobile || null,
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

  return result
}
