// ============================================================
// VERVIERS DÉPANNAGE — Connecteur Odoo JSON-RPC
// Côté serveur uniquement (API routes Next.js)
// ============================================================

const ODOO_URL    = process.env.ODOO_URL!
const ODOO_DB     = process.env.ODOO_DB!
const ODOO_EMAIL  = process.env.ODOO_EMAIL!
const ODOO_API_KEY = process.env.ODOO_API_KEY!

interface OdooCallResult<T = any> {
  result?: T
  error?: { message: string; data?: any }
}

// Appel JSON-RPC générique
async function odooRpc<T = any>(endpoint: string, payload: object): Promise<T> {
  const res = await fetch(`${ODOO_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1, params: payload })
  })

  if (!res.ok) throw new Error(`Odoo HTTP error: ${res.status}`)

  const data: OdooCallResult<T> = await res.json()
  if (data.error) throw new Error(`Odoo RPC error: ${data.error.message}`)
  return data.result as T
}

// Authentification — retourne l'uid
let _uid: number | null = null
async function getUid(): Promise<number> {
  if (_uid) return _uid
  _uid = await odooRpc('/web/dataset/call_kw', {
    model: 'res.users',
    method: 'authenticate',
    args: [ODOO_DB, ODOO_EMAIL, ODOO_API_KEY, {}],
    kwargs: {}
  })
  if (!_uid) throw new Error('Odoo authentication failed')
  return _uid
}

// Exécuter une méthode sur un modèle Odoo
async function execute<T = any>(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: object = {}
): Promise<T> {
  const uid = await getUid()
  return odooRpc<T>('/web/dataset/call_kw', {
    model,
    method,
    args,
    kwargs: { ...kwargs, context: { uid, db: ODOO_DB, lang: 'fr_BE' } }
  })
}

// ============================================================
// API PUBLIQUE DU CONNECTEUR
// ============================================================

// Rechercher un partenaire par TVA
export async function findPartnerByVat(vat: string) {
  const results = await execute<any[]>('res.partner', 'search_read',
    [[['vat', '=', vat.toUpperCase()]]],
    { fields: ['id', 'name', 'vat', 'street', 'city', 'zip', 'phone', 'email'], limit: 1 }
  )
  return results[0] || null
}

// Rechercher un partenaire par nom ou email
export async function searchPartners(query: string) {
  return execute<any[]>('res.partner', 'search_read',
    [[['name', 'ilike', query]]],
    { fields: ['id', 'name', 'vat', 'street', 'city', 'phone', 'email'], limit: 10 }
  )
}

// Créer ou récupérer un partenaire
export async function upsertPartner(data: {
  name: string
  vat?: string
  street?: string
  phone?: string
  email?: string
}) {
  // Chercher d'abord par TVA
  if (data.vat) {
    const existing = await findPartnerByVat(data.vat)
    if (existing) return existing.id
  }

  // Créer
  return execute<number>('res.partner', 'create', [{
    name: data.name,
    vat: data.vat,
    street: data.street,
    phone: data.phone,
    email: data.email,
    customer_rank: 1,
    company_type: data.vat ? 'company' : 'person',
    country_id: 21  // Belgique
  }])
}

// Créer une facture client dans Odoo
export async function createInvoice(data: {
  partnerId: number
  amount: number
  description: string
  reference: string
  paymentMode?: string
}) {
  const invoiceId = await execute<number>('account.move', 'create', [{
    move_type: 'out_invoice',
    partner_id: data.partnerId,
    ref: data.reference,
    invoice_line_ids: [[0, 0, {
      name: data.description,
      quantity: 1,
      price_unit: data.amount,
      tax_ids: []  // à adapter selon config TVA Odoo
    }]]
  }])

  // Confirmer la facture
  await execute('account.move', 'action_post', [[invoiceId]])

  return invoiceId
}

// Récupérer une facture
export async function getInvoice(invoiceId: number) {
  const results = await execute<any[]>('account.move', 'read',
    [[invoiceId]],
    { fields: ['name', 'state', 'amount_total', 'partner_id', 'invoice_date', 'payment_state'] }
  )
  return results[0] || null
}
