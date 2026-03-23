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
const SALE_TEMPLATE_ID = 7
const PRODUCT_FORFAIT  = 5   // [FORFAIT] Forfait
const TAX_21           = 5   // TVA 21% Belgique

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
    // Mettre à jour le statut
    await rpc('fleet.vehicle', 'write', [[existing[0].id], { state_id: 23 }])
    return existing[0].id
  }

  const brandId = await findOrCreateBrand(data.brandName)
  const modelId = await findOrCreateVehicleModel(brandId, data.modelName)

  const vehicleId = await rpc<number>('fleet.vehicle', 'create', [{
    license_plate: plate,
    model_id: modelId,
    state_id: 23, // Encaissement Chauffeur
    ...(data.vinSn ? { vin_sn: data.vinSn } : {})
  }])

  console.log(`[Odoo] Véhicule créé: ${plate} (ID: ${vehicleId})`)
  return vehicleId
}

// ============================================================
// PAYS — Récupérer l'ID Odoo par code ISO
// ============================================================
const countryCache: Record<string, number> = {}
async function getCountryId(code: string): Promise<number> {
  if (!code) return 20 // Belgique par défaut
  const upper = code.toUpperCase()
  if (countryCache[upper]) return countryCache[upper]
  const r = await rpc<any[]>('res.country', 'search_read',
    [[['code', '=', upper]]], { fields: ['id', 'code'], limit: 1 })
  const id = r.length > 0 ? r[0].id : 20
  countryCache[upper] = id
  return id
}

// ============================================================
// PARTENAIRE — Mettre à jour les champs manquants
// ============================================================
async function updatePartnerIfMissing(id: number, existing: any, data: {
  name?: string; phone?: string; email?: string; vat?: string
  street?: string; zip?: string; city?: string; countryCode?: string
}): Promise<void> {
  const updates: any = {}
  if (!existing.street && data.street) updates.street = data.street
  if (!existing.zip && data.zip) updates.zip = data.zip
  if (!existing.city && data.city) updates.city = data.city
  if (!existing.phone && data.phone) updates.phone = data.phone
  if (!existing.email && data.email) updates.email = data.email
  if (!existing.country_id && data.countryCode) {
    updates.country_id = await getCountryId(data.countryCode)
  }
  if (Object.keys(updates).length > 0) {
    await rpc('res.partner', 'write', [[id], updates])
    console.log(`[Odoo] Partner mis à jour:`, Object.keys(updates))
  }
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
  zip?: string
  city?: string
  countryCode?: string
}): Promise<number> {
  const countryId = await getCountryId(data.countryCode || 'BE')

  // 1. Par TVA
  if (data.vat) {
    const r = await rpc<any[]>('res.partner', 'search_read',
      [[['vat', '=', data.vat.toUpperCase()]]], { fields: ['id', 'name', 'street', 'phone', 'email'], limit: 1 })
    if (r.length > 0) {
      console.log(`[Odoo] Partner by TVA: ${r[0].name}`)
      await updatePartnerIfMissing(r[0].id, r[0], data)
      return r[0].id
    }
  }

  // 2. Par email
  if (data.email) {
    const r = await rpc<any[]>('res.partner', 'search_read',
      [[['email', '=', data.email.toLowerCase()]]], { fields: ['id', 'name', 'street', 'phone', 'email'], limit: 1 })
    if (r.length > 0) {
      console.log(`[Odoo] Partner by email: ${r[0].name}`)
      await updatePartnerIfMissing(r[0].id, r[0], data)
      return r[0].id
    }
  }

  // 3. Par téléphone
  if (data.phone) {
    const clean = data.phone.replace(/\s/g, '')
    const r = await rpc<any[]>('res.partner', 'search_read',
      [[['phone', 'like', clean]]], { fields: ['id', 'name', 'street', 'phone', 'email'], limit: 1 })
    if (r.length > 0) {
      console.log(`[Odoo] Partner by phone: ${r[0].name}`)
      await updatePartnerIfMissing(r[0].id, r[0], data)
      return r[0].id
    }
  }

  // 4. Par nom + nom inversé
  if (data.name) {
    const inverted = invertName(data.name)
    for (const n of [data.name, inverted]) {
      const r = await rpc<any[]>('res.partner', 'search_read',
        [[['name', 'ilike', n]]], { fields: ['id', 'name', 'street', 'phone', 'email'], limit: 1 })
      if (r.length > 0) {
        console.log(`[Odoo] Partner by name "${n}": ${r[0].name}`)
        await updatePartnerIfMissing(r[0].id, r[0], data)
        return r[0].id
      }
    }
  }

  // 5. Créer
  const id = await rpc<number>('res.partner', 'create', [{
    name: data.name || 'Client inconnu',
    phone: data.phone || false,
    email: data.email || false,
    street: data.street || data.city ? `${data.street || ''}`.trim() || false : false,
    zip: data.zip || false,
    city: data.city || false,
    country_id: countryId,
    ...(data.vat
      ? { vat: data.vat.toUpperCase(), company_type: 'company' }
      : { company_type: 'person' }),
    customer_rank: 1,
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
  motifPrecision?: string
  locationAddress?: string
  paymentMode?: string
  paymentReference?: string  // référence SumUp
  driverName?: string
  notes?: string
}): Promise<{ id: number; name: string }> {

  // Montant TVAC exact — on calcule la TVA et le HT manuellement
  // pour éviter les erreurs d'arrondi d'Odoo (ex: 100€ TVAC → 99.99 dans Odoo)
  const tvac = data.amount
  const tva = Math.round(tvac * 21 / 121 * 10000) / 10000
  const finalHT = parseFloat((tvac - tva).toFixed(4))

  // Note interne : chauffeur + mode paiement
  const internalNote = [
    data.driverName ? `Chauffeur : ${data.driverName}` : null,
    data.paymentMode ? `Mode de paiement : ${data.paymentMode}` : null,
  ].filter(Boolean).join('<br/>')

  const orderId = await rpc<number>('sale.order', 'create', [{
    partner_id: data.partnerId,
    sale_order_template_id: SALE_TEMPLATE_ID,
    client_order_ref: data.reference,
    [FIELD_PLAQUE]: data.vehicleId,
    payment_term_id: 1,
    order_line: [
      // Section template (repris du template 27)
      [0, 0, {
        display_type: 'line_section',
        name: 'Suite à votre demande, intervention sur véhicule dont référence ci-dessus',
        sequence: 10,
      }],
      // Ligne produit Forfait avec prix HT et TVA 21%
      [0, 0, {
        product_id: PRODUCT_FORFAIT,
        product_uom_qty: 1,
        price_unit: finalHT,
        tax_ids: [[6, 0, [TAX_21]]], // Set taxes
        sequence: 11,
      }],
      // Ligne note : motif + précision si "Autre" + adresse intervention
      [0, 0, {
        display_type: 'line_note',
        name: [
          `Motif de l'intervention : ${data.motifPrecision ? data.motifPrecision : data.motifText}`,
          data.locationAddress ? `Lieu d'intervention : ${data.locationAddress}` : null,
        ].filter(Boolean).join('\n'),
        sequence: 12,
      }],
    ]
  }])

  const orders = await rpc<any[]>('sale.order', 'read',
    [[orderId]], { fields: ['id', 'name', 'amount_total', 'amount_tax'] })

  // Ajouter une note interne dans le chatter (subtype_id=2 = Note interne)
  const noteLines = [
    data.driverName ? `<b>Chauffeur :</b> ${data.driverName}` : null,
    data.paymentMode ? `<b>Mode de paiement :</b> ${data.paymentMode}` : null,
    data.paymentReference ? `<b>Référence SumUp :</b> ${data.paymentReference}` : null,
    data.notes ? `<b>Remarques :</b> ${data.notes}` : null,
  ].filter(Boolean).join('<br/>')

  if (noteLines) {
    await rpc('sale.order', 'message_post', [[orderId]], {
      body: noteLines,
      message_type: 'comment',
      subtype_id: 2, // Note interne
    })
  }

  console.log(`[Odoo] Devis créé: ${orders[0].name} — HT: ${finalHT}€ | Total: ${orders[0].amount_total}€ | TVA: ${orders[0].amount_tax}€`)
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
  clientStreet?: string
  clientZip?: string
  clientCity?: string
  clientCountryCode?: string
  amount: number
  motifText: string
  motifPrecision?: string
  locationAddress?: string
  paymentMode?: string
  paymentReference?: string
  driverName?: string
  notes?: string
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
    street: intervention.clientStreet,
    zip: intervention.clientZip,
    city: intervention.clientCity,
    countryCode: intervention.clientCountryCode,
  })

  const { id: orderId, name: orderName } = await createSaleOrder({
    partnerId,
    vehicleId,
    reference: `Reçu chauffeur n° ${intervention.reference}`,
    amount: intervention.amount,
    motifText: intervention.motifText,
    motifPrecision: intervention.motifPrecision,
    locationAddress: intervention.locationAddress,
    paymentMode: intervention.paymentMode,
    paymentReference: intervention.paymentReference,
    driverName: intervention.driverName,
    notes: intervention.notes,
  })

  return { vehicleId, partnerId, orderId, orderName }
}

// ============================================================
// AVANCE DE FONDS
// ============================================================

const ADVANCE_TEMPLATE_ID     = 30
const ODOO_FIELD_SALE_VEHICLE = 'x_studio_many2one_field_78n_1j6fmmeom'

async function getDiversPartnerId(): Promise<number> {
  const results = await rpc<any[]>('res.partner', 'search_read',
    [[['ref', '=', 'Divers']]],
    { fields: ['id', 'name'], limit: 1 }
  )
  if (!results?.length) throw new Error('Partenaire "Client divers" (ref: Divers) introuvable')
  return results[0].id
}

export async function createAdvanceOrder(
  plate:      string,
  amountHtva: number
): Promise<{ orderId: number; orderName: string; vehicleSet: boolean }> {

  const partnerId = await getDiversPartnerId()

  const templateLines = await rpc<any[]>('sale.order.template.line', 'search_read',
    [[['sale_order_template_id', '=', ADVANCE_TEMPLATE_ID]]],
    { fields: ['product_id', 'name'], limit: 1 }
  )
  if (!templateLines?.length) {
    throw new Error(`Modèle de devis id ${ADVANCE_TEMPLATE_ID} introuvable ou sans lignes`)
  }
  const productId: number = templateLines[0].product_id[0]

  const orderId = await rpc<number>('sale.order', 'create', [{
    partner_id:             partnerId,
    sale_order_template_id: ADVANCE_TEMPLATE_ID,
    order_line: [[0, 0, {
      product_id:      productId,
      price_unit:      amountHtva,
      product_uom_qty: 1,
      name:            `Avance de fonds — ${plate}`,
    }]],
  }])

  const orders = await rpc<any[]>('sale.order', 'read',
    [[orderId]], { fields: ['id', 'name'] }
  )
  const orderName: string = orders[0]?.name ?? `SO${orderId}`

  let vehicleSet = false
  const vehicles = await rpc<any[]>('fleet.vehicle', 'search_read',
    [[['license_plate', 'ilike', plate]]],
    { fields: ['id', 'license_plate'], limit: 10 }
  )
  const match = vehicles.find(v =>
    v.license_plate.replace(/[-.\s]/g, '').toUpperCase() === plate.toUpperCase()
  )
  if (match) {
    await rpc('sale.order', 'write', [[orderId], { [ODOO_FIELD_SALE_VEHICLE]: match.id }])
    vehicleSet = true
  }

  return { orderId, orderName, vehicleSet }
}
