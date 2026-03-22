// ============================================================
// VERVIERS DÉPANNAGE — Connecteur Odoo JSON-RPC
// Odoo 19 — verviers-depannage.odoo.com
// UID: 8
// ============================================================

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

// Champs custom sale.order
const FIELD_PLAQUE     = 'x_studio_many2one_field_78n_1j6fmmeom'
const FIELD_MENTION    = 'x_studio_related_field_8as_1j5u1lcp6'
const SALE_TEMPLATE_ID = 7

// ============================================================
// JSON-RPC core
// ============================================================
async function rpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs]
      }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo RPC [${model}.${method}]: ${JSON.stringify(data.error)}`)
  return data.result
}

// ============================================================
// FLEET — Marque
// ============================================================
async function findOrCreateBrand(brandName: string): Promise<number> {
  const results = await rpc<any[]>('fleet.vehicle.model.brand', 'search_read',
    [[['name', 'ilike', brandName]]],
    { fields: ['id', 'name'], limit: 1 }
  )
  if (results.length > 0) return results[0].id
  return rpc<number>('fleet.vehicle.model.brand', 'create', [{ name: brandName }])
}

// ============================================================
// FLEET — Modèle de véhicule
// ============================================================
async function findOrCreateVehicleModel(brandId: number, modelName: string): Promise<number> {
  const results = await rpc<any[]>('fleet.vehicle.model', 'search_read',
    [[['brand_id', '=', brandId], ['name', 'ilike', modelName]]],
    { fields: ['id', 'name'], limit: 1 }
  )
  if (results.length > 0) return results[0].id
  return rpc<number>('fleet.vehicle.model', 'create', [{ brand_id: brandId, name: modelName }])
}

// ============================================================
// FLEET — Véhicule
// ============================================================
export async function findOrCreateVehicle(data: {
  licensePlate: string
  brandName: string
  modelName: string
  vinSn?: string
}): Promise<number> {
  const plate = data.licensePlate.toUpperCase().trim()

  const existing = await rpc<any[]>('fleet.vehicle', 'search_read',
    [[['license_plate', '=', plate]]],
    { fields: ['id', 'license_plate'], limit: 1 }
  )
  if (existing.length > 0) {
    console.log(`[Odoo] Véhicule trouvé: ${plate} (ID: ${existing[0].id})`)
    return existing[0].id
  }

  const brandId = await findOrCreateBrand(data.brandName)
  const modelId = await findOrCreateVehicleModel(brandId, data.modelName)

  const vehicleId = await rpc<number>('fleet.vehicle', 'create', [{
    license_plate: plate,
    model_id: modelId,
    ...(data.vinSn ? { vin_sn: data.vinSn } : {})
  }])

  console.log(`[Odoo] Véhicule créé: ${plate} (ID: ${vehicleId})`)
  return vehicleId
}

// ============================================================
// PARTENAIRE — Recherche intelligente
// ============================================================
function invertName(name: string): string {
  const parts = name.trim().split(' ')
  if (parts.length < 2) return name
  return [...parts.slice(1), parts[0]].join(' ')
}

export async function findOrCreatePartner(data: {
  name?: string
  phone?: string
  email?: string
  vat?: string
  street?: string
}): Promise<number> {

  // 1. Par TVA
  if (data.vat) {
    const r = await rpc<any[]>('res.partner', 'search_read',
      [[['vat', '=', data.vat.toUpperCase()]]], { fields: ['id', 'name'], limit: 1 })
    if (r.length > 0) { console.log(`[Odoo] Partner by TVA: ${r[0].name}`); return r[0].id }
  }

  // 2. Par email
  if (data.email) {
    const r = await rpc<any[]>('res.partner', 'search_read',
      [[['email', '=', data.email.toLowerCase()]]], { fields: ['id', 'name'], limit: 1 })
    if (r.length > 0) { console.log(`[Odoo] Partner by email: ${r[0].name}`); return r[0].id }
  }

  // 3. Par téléphone
  if (data.phone) {
    const clean = data.phone.replace(/\s/g, '')
    const r = await rpc<any[]>('res.partner', 'search_read',
      [[['phone', 'like', clean]]], { fields: ['id', 'name'], limit: 1 })
    if (r.length > 0) { console.log(`[Odoo] Partner by phone: ${r[0].name}`); return r[0].id }
  }

  // 4. Par nom + nom inversé
  if (data.name) {
    const inverted = invertName(data.name)
    for (const n of [data.name, inverted]) {
      const r = await rpc<any[]>('res.partner', 'search_read',
        [[['name', 'ilike', n]]], { fields: ['id', 'name'], limit: 1 })
      if (r.length > 0) { console.log(`[Odoo] Partner by name "${n}": ${r[0].name}`); return r[0].id }
    }
  }

  // 5. Créer
  const id = await rpc<number>('res.partner', 'create', [{
    name: data.name || 'Client inconnu',
    phone: data.phone || false,
    email: data.email || false,
    street: data.street || false,
    ...(data.vat ? { vat: data.vat.toUpperCase(), company_type: 'company' } : { company_type: 'person' }),
    customer_rank: 1,
    country_id: 21,
  }])
  console.log(`[Odoo] Partner créé: ${data.name} (ID: ${id})`)
  return id
}

// ============================================================
// DEVIS — Créer un sale.order en état Devis
// ============================================================
export async function createSaleOrder(data: {
  partnerId: number
  vehicleId: number
  reference: string
  amount: number
  motifText: string
  paymentMode?: string
}): Promise<{ id: number; name: string }> {

  // Montant HT depuis TVAC 21%
  const amountHT = Math.round((data.amount / 1.21) * 100) / 100

  const orderId = await rpc<number>('sale.order', 'create', [{
    partner_id: data.partnerId,
    sale_order_template_id: SALE_TEMPLATE_ID,
    client_order_ref: data.reference,
    [FIELD_PLAQUE]: data.vehicleId,
    [FIELD_MENTION]: data.paymentMode ? `Payé par ${data.paymentMode}` : '',
    payment_term_id: 1,
    order_line: [[0, 0, {
      name: data.motifText,
      product_uom_qty: 1,
      price_unit: amountHT,
    }]]
  }])

  const orders = await rpc<any[]>('sale.order', 'read',
    [[orderId]], { fields: ['id', 'name', 'amount_total'] })

  console.log(`[Odoo] Devis créé: ${orders[0].name} — ${orders[0].amount_total}€`)
  return { id: orderId, name: orders[0].name }
}

// ============================================================
// SYNC COMPLÈTE — Point d'entrée
// ============================================================
export async function syncInterventionToOdoo(intervention: {
  reference: string
  plate: string
  brandText: string
  modelText: string
  vinSn?: string
  clientName?: string
  clientPhone?: string
  clientEmail?: string
  clientVat?: string
  clientAddress?: string
  amount: number
  motifText: string
  paymentMode?: string
}): Promise<{ vehicleId: number; partnerId: number; orderId: number; orderName: string }> {

  console.log(`[Odoo] Sync intervention ${intervention.reference}`)

  const vehicleId = await findOrCreateVehicle({
    licensePlate: intervention.plate,
    brandName: intervention.brandText,
    modelName: intervention.modelText,
    vinSn: intervention.vinSn,
  })

  const partnerId = await findOrCreatePartner({
    name: intervention.clientName,
    phone: intervention.clientPhone,
    email: intervention.clientEmail,
    vat: intervention.clientVat,
    street: intervention.clientAddress,
  })

  const { id: orderId, name: orderName } = await createSaleOrder({
    partnerId,
    vehicleId,
    reference: `Reçu chauffeur n° ${intervention.reference}`,
    amount: intervention.amount,
    motifText: intervention.motifText,
    paymentMode: intervention.paymentMode,
  })

  return { vehicleId, partnerId, orderId, orderName }
}
