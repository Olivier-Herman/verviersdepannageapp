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

/**
 * Recupere le PDF d une facture client depuis Odoo. 2 strategies en cascade :
 *
 * 1. ir.attachment : si la facture a deja ete imprimee/envoyee au moins une
 *    fois, son PDF est stocke en attachment. C est le cas de la quasi-totalite
 *    des factures clients (envoyees automatiquement a la validation).
 *
 * 2. HTTP login + render : si pas d attachment, on simule un login web
 *    Odoo (POST /web/session/authenticate avec login + api_key as password,
 *    fonctionne sur Odoo 18+) puis GET /report/pdf/<report_name>/<id> avec
 *    le cookie session_id obtenu. Plus lent mais universel.
 *
 * Retourne un Buffer du PDF.
 */
export async function fetchInvoicePdfFromOdoo(invoiceId: number): Promise<Buffer> {
  // ── Strategy 0 : lire account.move.invoice_pdf_report_id ──
  // Sur Odoo 18+, account.move expose 2 champs lies au PDF :
  //   - invoice_pdf_report_id : Many2One vers ir.attachment (PDF officiel)
  //   - invoice_pdf_report_file : Binary (computed, parfois vide)
  // C est la voie la plus directe et publique.
  try {
    const moves = await rpc<any[]>(
      'account.move',
      'read',
      [[invoiceId]],
      { fields: ['invoice_pdf_report_id'] }
    )
    if (moves.length > 0 && moves[0].invoice_pdf_report_id) {
      const reportRef = moves[0].invoice_pdf_report_id
      const attId = Array.isArray(reportRef) ? reportRef[0] : reportRef
      if (typeof attId === 'number' && attId > 0) {
        const atts = await rpc<any[]>(
          'ir.attachment',
          'read',
          [[attId]],
          { fields: ['id', 'name', 'datas'] }
        )
        if (atts.length > 0 && atts[0].datas) {
          console.info(`[relances/odoo] PDF facture ${invoiceId} via invoice_pdf_report_id (att ${attId})`)
          return Buffer.from(atts[0].datas, 'base64')
        }
      }
    }
  } catch (e: any) {
    console.warn(`[relances/odoo] invoice_pdf_report_id lookup failed for ${invoiceId}:`, e.message)
  }

  // ── Strategy 1 : ir.attachment ──
  // Recherche elargie : mimetype 'like' %pdf% OU name ilike %.pdf
  // (certains attachments PDF ont mimetype octet-stream ou inconnu).
  // On essaie d abord la recherche stricte, puis un fallback.
  try {
    const tryQueries = [
      // Query 1 : strict mimetype application/pdf
      [
        ['res_model', '=', 'account.move'],
        ['res_id',    '=', invoiceId],
        ['mimetype',  '=', 'application/pdf'],
      ],
      // Query 2 : tout attachment avec name finissant en .pdf
      [
        ['res_model', '=', 'account.move'],
        ['res_id',    '=', invoiceId],
        ['name',      'ilike', '%.pdf'],
      ],
      // Query 3 : n importe quel attachment lie a la facture (dernier recours)
      [
        ['res_model', '=', 'account.move'],
        ['res_id',    '=', invoiceId],
      ],
    ]
    for (const domain of tryQueries) {
      const attachments = await rpc<any[]>(
        'ir.attachment',
        'search_read',
        [domain],
        { fields: ['id', 'name', 'datas', 'mimetype'], limit: 5, order: 'create_date desc' }
      )
      if (attachments.length === 0) continue
      // Filtre cote Node : on cherche le 1er attachment dont datas est non-vide
      // ET (mimetype pdf OU name.endsWith('.pdf'))
      const pdfAtt = attachments.find(a =>
        a.datas
        && (a.mimetype === 'application/pdf'
            || (typeof a.name === 'string' && a.name.toLowerCase().endsWith('.pdf')))
      )
      if (pdfAtt) {
        console.info(`[relances/odoo] PDF facture ${invoiceId} trouve via ir.attachment id=${pdfAtt.id} (${pdfAtt.name}, ${pdfAtt.mimetype})`)
        return Buffer.from(pdfAtt.datas, 'base64')
      }
    }
  } catch (e: any) {
    console.warn(`[relances/odoo] ir.attachment lookup failed for invoice ${invoiceId}:`, e.message)
  }

  // ── Strategy 2 : HTTP login + render ──
  // 1. Login : POST /web/session/authenticate
  //    Sur Odoo 18+, l api_key peut etre utilisee comme password.
  //    Le login est l email du user Odoo (UID 8 chez VD).
  const odooLogin = process.env.ODOO_EMAIL || process.env.ODOO_USER || process.env.ODOO_LOGIN
  if (!odooLogin) {
    throw new Error(
      `Impossible de generer PDF pour facture ${invoiceId} : aucun attachment PDF en base, et ODOO_EMAIL non configure pour fallback HTTP.`
    )
  }

  let sessionId: string | null = null
  try {
    const loginRes = await fetch(`${ODOO_URL}/web/session/authenticate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        jsonrpc: '2.0',
        params:  { db: ODOO_DB, login: odooLogin, password: ODOO_API_KEY },
      }),
      cache: 'no-store',
    })
    const setCookie = loginRes.headers.get('set-cookie') || ''
    const match     = setCookie.match(/session_id=([^;]+)/)
    sessionId = match ? match[1] : null
    if (!sessionId) {
      const body = await loginRes.text().catch(() => '')
      throw new Error(`Login Odoo HTTP echec (status ${loginRes.status}): ${body.slice(0, 200)}`)
    }
  } catch (e: any) {
    throw new Error(
      `Impossible de generer PDF pour facture ${invoiceId} : login Odoo echec — ${e.message}`
    )
  }

  // 2. GET le rapport avec cookie session_id, fallback sur 3 noms de rapport
  const reportNames = [
    'account.report_invoice_with_payments',
    'account.account_invoices',
    'account.report_invoice',
  ]
  let lastError: any
  for (const reportName of reportNames) {
    try {
      const reportRes = await fetch(
        `${ODOO_URL}/report/pdf/${reportName}/${invoiceId}`,
        {
          headers: { Cookie: `session_id=${sessionId}` },
          cache:   'no-store',
        }
      )
      if (!reportRes.ok) {
        lastError = new Error(`HTTP ${reportRes.status} sur ${reportName}`)
        continue
      }
      const contentType = reportRes.headers.get('content-type') || ''
      if (!contentType.includes('pdf')) {
        // Odoo a retourne une page HTML d erreur, pas un PDF
        lastError = new Error(`Reponse non-PDF pour ${reportName} (content-type: ${contentType})`)
        continue
      }
      const buf = await reportRes.arrayBuffer()
      return Buffer.from(buf)
    } catch (e: any) {
      lastError = e
    }
  }
  throw new Error(
    `Impossible de generer PDF pour facture ${invoiceId} (rapports HTTP essayes: ${reportNames.join(', ')}). Last error: ${lastError?.message || 'unknown'}`
  )
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
  dueDate:          string | null   // YYYY-MM-DD (invoice_date_due) — null possible sur les notes de credit
  daysOverdue:      number   // jours pleins entre dueDate et today (0 si pas de dueDate, ex: NC)
  level:            ReminderLevel  // niveau propre a cette facture (basé sur daysOverdue)
  amountTotal:      number   // signed : positif si invoice, negatif si refund (NC)
  amountResidual:   number   // signed : restant du (positif) ou restant a rembourser (negatif)
  isRefund:         boolean  // true = note de credit (out_refund) ouverte
  plate:            string | null
  vehicleLabel:     string | null
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
  totalResidual:   number          // somme NETTE des residuals signes (invoices - refunds)
  invoiceCount:    number          // nb out_invoice
  refundCount:     number          // nb out_refund (NC ouvertes)
  maxDaysOverdue:  number          // retard max sur le groupe (factures uniquement)
  level:           ReminderLevel   // niveau découlant de maxDaysOverdue
}

export interface OverdueResult {
  groups:   PartnerOverdueGroup[]
  truncated: boolean   // true si on a hit le limit search_read (donnees potentiellement incompletes)
  fetched:   number    // nombre de factures lues
}

// Pagination Odoo XMLRPC : VD a un plafond serveur de ~80 par page (limite
// implicite probable via ir.config_parameter ou config web_data_limit).
// Du coup demander limit: 1000 retournait silencieusement 80, et notre
// ancien check "page.length < PAGE_SIZE -> derniere page" coupait apres
// 80 factures (52 partners). Bug detecte par Olivier en checkpoint 3.
//
// Fix : PAGE_SIZE 80 (= au plafond Odoo, on n a plus de fausse derniere
// page) + condition d arret = page.length === 0 (vraiment fini) au lieu
// de page.length < PAGE_SIZE.
const PAGE_SIZE = 80
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

  // Filtre payment_state : on EXCLUE 'paid' et 'reversed' (annulee par avoir),
  // on INCLUT not_paid, partial, in_payment (paiement en cours non reconcilie),
  // et toute valeur future. Plus robuste qu un IN strict qui pourrait rater
  // des states custom Odoo. amount_residual > 0 fait le filtre final.
  //
  // out_invoice ET out_refund (NC) sont inclus :
  //   - out_invoice : echu >= 15j (cutoffStr) → dette client
  //   - out_refund  : open (peu importe la date) → credit a rembourser au
  //     client. amount_residual sera "signe negatif" cote app pour visualisation.
  const domain: any[] = [
    ['state',             '=',  'posted'],
    ['payment_state',     'not in', ['paid', 'reversed']],
    ['amount_residual',   '>',  0],
    // OR : (invoice echue) OU (refund peu importe date)
    '|',
      '&',
        ['move_type',         '=',  'out_invoice'],
        '&',
          ['invoice_date_due',  '!=', false],
          ['invoice_date_due',  '<=', cutoffStr],
      ['move_type',         '=',  'out_refund'],
  ]
  if (vdCompanyId !== null) {
    domain.push(['company_id', '=', vdCompanyId])
  }
  console.info(`[relances/odoo] domain:`, JSON.stringify(domain), 'cutoffStr:', cutoffStr)

  // Champ custom sale.order qui pointe vers fleet.vehicle (cf src/lib/odoo.ts).
  const FIELD_PLAQUE = 'x_studio_many2one_field_78n_1j6fmmeom'

  // 1. Fetch pagine de toutes les factures clients echues >= 15j non soldees.
  // Loop tant que la page retournee n est pas vide (page.length === 0).
  // Plus robuste si Odoo plafonne implicitement la taille de page : on ne
  // se base plus sur (page.length < PAGE_SIZE) qui peut etre menteur.
  const moves: any[] = []
  let truncated = false
  for (let offset = 0; offset < MAX_FETCH; offset += PAGE_SIZE) {
    const page = await rpc<any[]>(
      'account.move',
      'search_read',
      [domain],
      {
        fields: ['id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due',
                 'amount_total', 'amount_residual', 'invoice_origin', 'move_type'],
        order:  'invoice_date_due asc, invoice_date desc',
        limit:  PAGE_SIZE,
        offset,
      }
    )
    if (page.length === 0) break   // vraiment fini
    moves.push(...page)
    if (offset + PAGE_SIZE >= MAX_FETCH) {
      truncated = true
      break
    }
  }

  console.info(`[relances/odoo] ${moves.length} factures echues recuperees (truncated: ${truncated})`)

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

    const dueDateStr: string | null = (m.invoice_date_due && typeof m.invoice_date_due === 'string') ? m.invoice_date_due : null
    let daysOverdue = 0
    if (dueDateStr) {
      const dueDate    = new Date(dueDateStr + 'T00:00:00Z')
      const todayUtc   = new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z')
      daysOverdue = Math.floor((todayUtc.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
    }

    const invLevel = computeLevel(daysOverdue) ?? 1
    const origin   = typeof m.invoice_origin === 'string' ? m.invoice_origin.trim() : ''
    const veh      = origin ? vehicleByOrderName.get(origin) : null
    const isRefund = m.move_type === 'out_refund'

    // Sign convention : factures positives (dette client), NC negatives (credit a rembourser)
    const rawResidual = Math.abs(Number(m.amount_residual) || 0)
    const rawTotal    = Math.abs(Number(m.amount_total) || 0)
    const signedResidual = isRefund ? -rawResidual : rawResidual
    const signedTotal    = isRefund ? -rawTotal    : rawTotal

    const invoice: OverdueInvoice = {
      id:             m.id,
      name:           m.name,
      invoiceDate:    m.invoice_date,
      dueDate:        dueDateStr,
      daysOverdue,
      level:          invLevel,
      amountTotal:    signedTotal,
      amountResidual: signedResidual,
      isRefund,
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
        invoiceCount:   0,
        refundCount:    0,
        maxDaysOverdue: 0,
        level:          1,
      }
      groups.set(partnerId, group)
    }
    group.invoices.push(invoice)
    group.totalResidual  += invoice.amountResidual
    if (isRefund) group.refundCount  += 1
    else          group.invoiceCount += 1
    // Le retard ne compte que pour les factures (les NC n'ont pas vraiment d'echeance)
    if (!isRefund) group.maxDaysOverdue = Math.max(group.maxDaysOverdue, daysOverdue)
  }

  // 4. Calcul niveau final + tri (plus gros retards d'abord)
  const result: PartnerOverdueGroup[] = []
  for (const g of groups.values()) {
    // Un partner avec uniquement des NC (aucune facture echue) n'a pas de
    // niveau de relance, mais on le garde dans la liste pour qu'on voit le
    // remboursement a faire. Default level=1 dans ce cas (cosmetique seulement).
    if (g.invoiceCount > 0) {
      const lvl = computeLevel(g.maxDaysOverdue)
      if (lvl === null) continue   // safe-guard
      g.level = lvl
    } else {
      g.level = 1
    }
    g.totalResidual = Math.round(g.totalResidual * 100) / 100
    result.push(g)
  }
  // Tri par defaut : montant total NET desc (positifs en haut, puis NC pures en bas).
  // Tie-break par maxDaysOverdue desc puis partner_name asc pour determinisme.
  result.sort((a, b) => {
    if (b.totalResidual !== a.totalResidual) return b.totalResidual - a.totalResidual
    if (b.maxDaysOverdue !== a.maxDaysOverdue) return b.maxDaysOverdue - a.maxDaysOverdue
    return a.partnerName.localeCompare(b.partnerName)
  })

  console.info(`[relances/odoo] ${result.length} partner(s) avec factures echues (apres filtre tag exclusion: ${excludedPartnerIds.size})`)

  return { groups: result, truncated, fetched: moves.length }
}
