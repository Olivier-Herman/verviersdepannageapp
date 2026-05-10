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
//
// Exclusion : un partner est ignore si ses res.partner.category_id (tags
// Odoo) contiennent un tag dont le name matche RELANCE_EXCLUDED_TAG_NAME
// ('Exclure relances'). Olivier l applique sur le Parquet et autres
// partners en contentieux pour les sortir des relances email.

import { RELANCE_EXCLUDED_TAG_NAME } from './constants'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8', 10)
const ODOO_API_KEY = process.env.ODOO_API_KEY!

// Multi-company Odoo : VD a plusieurs societes (Verviers Depannage,
// Riga Depannage, DGJ VHU, ...). Les factures de relance ne doivent
// remonter QUE pour "Verviers Depannage" - les autres societes ont leur
// propre comptabilite. Match par name ilike, plus robuste que par id en
// cas de copie de base entre instances. Override via env var.
// NB: 'Riga Depannage' et 'DGJ VHU' ne matchent PAS le filtre.
const COMPANY_NAME = process.env.RELANCES_ODOO_COMPANY_NAME || 'Verviers Dépannage'
let cachedCompanyId: number | null = null

async function getVdCompanyId(): Promise<number | null> {
  if (cachedCompanyId !== null) return cachedCompanyId
  try {
    const r = await rpc<any[]>(
      'res.company',
      'search_read',
      [[['name', 'ilike', COMPANY_NAME]]],
      { fields: ['id', 'name'], limit: 5 }
    )
    if (r.length === 0) {
      console.error(`[relances/odoo] Aucune res.company matchee pour "${COMPANY_NAME}"`)
      return null
    }
    // Si plusieurs matches : prendre le plus court (= "Verviers Dépannage" plutot
    // que "Verviers Dépannage SA Holding 2" eventuel).
    const match = r.length === 1 ? r[0] :
      r.sort((a, b) => (a.name as string).length - (b.name as string).length)[0]
    cachedCompanyId = match.id
    console.info(`[relances/odoo] Company VD : ID ${match.id} - "${match.name}"`)
    if (r.length > 1) {
      console.warn(`[relances/odoo] ${r.length} companies matchent "${COMPANY_NAME}", utilisation de "${match.name}"`)
    }
    return cachedCompanyId
  } catch (e: any) {
    console.error('[relances/odoo] getVdCompanyId failed:', e.message)
    return null
  }
}

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
  partnerStreet:   string | null
  partnerZip:      string | null
  partnerCity:     string | null
  partnerCountry:  string | null   // libelle pays (ex "Belgique") resolu depuis country_id
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

// Limite haute par paginate. On pagine par chunks de 1000 pour grouper
// le moins de round-trips possible tout en restant sous le timeout Vercel.
// MAX_FETCH 20000 = tres large : meme avec multi-company exclu, VD ne
// devrait jamais avoir autant de factures echues simultanement.
// Note : avec le filtre company_id de Verviers Depannage, on coupe deja
// drastiquement le volume (les factures Riga/DGJ VHU ne sont plus
// remontees). Ce limit haut est un safety net, pas un usage normal.
const PAGE_SIZE = 1000
const MAX_FETCH = 20000   // si on hit ca, on renvoie truncated=true a l UI

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

  // Filtre societe Verviers Depannage (multi-company Odoo).
  // Si pas trouvee, on log mais on continue sans filtre company.
  const vdCompanyId = await getVdCompanyId()

  const domain: any[] = [
    ['move_type',         '=',  'out_invoice'],
    ['state',             '=',  'posted'],
    ['payment_state',     'in', ['not_paid', 'partial']],
    ['invoice_date_due',  '!=', false],
    ['invoice_date_due',  '<=', cutoffStr],
    ['amount_residual',   '>',  0],
  ]
  if (vdCompanyId !== null) {
    domain.push(['company_id', '=', vdCompanyId])
  }

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
  // 'category_id' = tags Odoo (many2many) -> sert pour l'exclusion via tag.
  // street/zip/city/country_id : adresse pour le bloc destinataire PDF.
  const partners = await rpc<any[]>(
    'res.partner',
    'read',
    [partnerIds],
    { fields: ['id', 'name', 'ref', 'email', 'vat', 'phone', 'category_id',
               'street', 'zip', 'city', 'country_id'] }
  )

  // Resolution des noms de tags : 1 read batch sur res.partner.category
  // pour tous les category_ids distincts, puis match par NAME (et non ID)
  // pour ne pas dependre de l id Odoo (multi-tenant proof).
  const allTagIds = Array.from(new Set(
    partners.flatMap(p => Array.isArray(p.category_id) ? p.category_id as number[] : [])
  ))
  let excludedTagIds = new Set<number>()
  if (allTagIds.length > 0) {
    try {
      const tags = await rpc<any[]>(
        'res.partner.category',
        'read',
        [allTagIds],
        { fields: ['id', 'name'] }
      )
      excludedTagIds = new Set(
        tags.filter(t => (t.name as string)?.trim() === RELANCE_EXCLUDED_TAG_NAME)
            .map(t => t.id as number)
      )
    } catch (e: any) {
      console.error('[relances/odoo] tag lookup failed:', e.message)
    }
  }

  const partnerById = new Map<number, any>(partners.map(p => [p.id, p]))

  // Filtrer les partners exclus (Parquet & co.)
  const excludedPartnerIds = new Set<number>()
  if (excludedTagIds.size > 0) {
    for (const p of partners) {
      const tags = Array.isArray(p.category_id) ? (p.category_id as number[]) : []
      if (tags.some(tagId => excludedTagIds.has(tagId))) {
        excludedPartnerIds.add(p.id)
      }
    }
  }
  if (excludedPartnerIds.size > 0) {
    console.info(`[relances/odoo] ${excludedPartnerIds.size} partner(s) exclu(s) via tag '${RELANCE_EXCLUDED_TAG_NAME}'`)
  }

  // 3. Regrouper par partenaire + calcul niveau
  const groups = new Map<number, PartnerOverdueGroup>()

  for (const m of moves) {
    const partnerId = Array.isArray(m.partner_id) ? m.partner_id[0] : m.partner_id
    if (typeof partnerId !== 'number') continue
    if (excludedPartnerIds.has(partnerId)) continue
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
      const countryName = Array.isArray(partner.country_id) ? (partner.country_id[1] as string) : null
      group = {
        partnerId,
        partnerName:    partner.name || 'Inconnu',
        partnerRef:     partner.ref || null,
        partnerEmail:   partner.email || null,
        partnerVat:     partner.vat || null,
        partnerPhone:   partner.phone || null,
        partnerStreet:  partner.street || null,
        partnerZip:     partner.zip || null,
        partnerCity:    partner.city || null,
        partnerCountry: countryName,
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
  // Tri par defaut : montant total du desc (les plus gros enjeux d abord).
  // Tie-break par maxDaysOverdue desc puis partner_name asc pour
  // determinisme.
  result.sort((a, b) => {
    if (b.totalResidual !== a.totalResidual) return b.totalResidual - a.totalResidual
    if (b.maxDaysOverdue !== a.maxDaysOverdue) return b.maxDaysOverdue - a.maxDaysOverdue
    return a.partnerName.localeCompare(b.partnerName)
  })

  return { groups: result, truncated, fetched: moves.length }
}
