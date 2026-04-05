// ============================================================
// VERVIERS DÉPANNAGE — Connecteur Odoo FSM (base test)
// Séparé du connecteur principal — ne pas modifier odoo.ts
// ============================================================

const FSM_URL     = process.env.ODOO_TEST_URL || process.env.ODOO_URL!
const FSM_DB      = process.env.ODOO_TEST_DB  || process.env.ODOO_DB!
const FSM_UID     = parseInt(process.env.ODOO_UID || '8')
const FSM_API_KEY = process.env.ODOO_API_KEY!

// Noms techniques des champs custom Studio
export const FSM_FIELDS = {
  intervention_type:    'x_studio_intervention_type',
  intervention_context: 'x_studio_intervention_context',
  source:               'x_studio_source',
  dossier_number:       'x_studio_dossier_number',
  chauffeur_name:       'x_studio_chauffeur_name',
  chauffeur_id:         'x_studio_chauffeur_id',
  depot_depart:         'x_studio_depot_depart',
  zone_parc:            'x_studio_zone_de_parc_1',
  parc_depot:           'x_studio_parc_depot',
  rel_address:          'x_studio_rel_address',
  mission_parent_id:    'x_studio_mission_parent_id',
  supabase_id:          'x_studio_supabase_id',
}

export const HELPDESK_FIELDS = {
  supabase_id:    'x_studio_id_supabase',
  dossier_number: 'x_studio_n_dossier',
  source:         'x_studio_source',
}

// ============================================================
// JSON-RPC core FSM
// ============================================================
export async function rpcFsm<T = any>(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: object = {}
): Promise<T> {
  const res = await fetch(`${FSM_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [FSM_DB, FSM_UID, FSM_API_KEY, model, method, args, kwargs]
      }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(`[FSM RPC] ${model}.${method}: ${JSON.stringify(data.error)}`)
  return data.result
}

// ============================================================
// STAGES FSM — IDs hardcodés depuis la base test
// ============================================================
export const FSM_STAGES: Record<string, number> = {
  'Nouveau':               66,
  'Assigné':               67,
  'En route':              68,
  'Sur place':             69,
  'En route vers destination': 70,
  'Arrivé à destination':  76,
  'Mise en parc':          77,
  'À facturer':            78,
  'Terminé':               79,
}

export async function getFsmStageId(stageName: string): Promise<number> {
  if (FSM_STAGES[stageName]) return FSM_STAGES[stageName]
  // Fallback: chercher dans Odoo
  const results = await rpcFsm<any[]>('project.task.type', 'search_read',
    [[['name', 'ilike', stageName]]],
    { fields: ['id', 'name'], limit: 1 }
  )
  if (!results.length) throw new Error(`[FSM] Étape "${stageName}" introuvable`)
  return results[0].id
}

// ============================================================
// HELPDESK — Créer un ticket (dossier chapeau)
// ============================================================
export async function createHelpdeskTicket(params: {
  supabaseId:    string
  dossierNumber: string
  source:        string
  clientName:    string
  partnerId?:    number
  description?:  string
  teamId?:       number
  vehiclePlate?: string
  city?:         string
}): Promise<{ ticketId: number; ticketUrl: string }> {

  // Trouver l'équipe Helpdesk (première équipe disponible)
  const ticketData: any = {
    name:       [params.vehiclePlate, params.dossierNumber, params.city].filter(Boolean).join(' - ') || `${params.source} — ${params.clientName}`,
    team_id:    params.teamId || 12,
    description: params.description || '',
    [HELPDESK_FIELDS.supabase_id]:    params.supabaseId,
    [HELPDESK_FIELDS.dossier_number]: params.dossierNumber,
    [HELPDESK_FIELDS.source]:         params.source,
  }
  if (params.partnerId) ticketData.partner_id = params.partnerId

  const ticketId = await rpcFsm<number>('helpdesk.ticket', 'create', [ticketData])
  const ticketUrl = `${FSM_URL}/web#id=${ticketId}&model=helpdesk.ticket&view_type=form`

  console.log(`[FSM] Helpdesk ticket créé: #${ticketId}`)
  return { ticketId, ticketUrl }
}

// ============================================================
// FSM TASK — Créer une tâche d'intervention
// ============================================================
export async function createFsmTask(params: {
  supabaseId:          string
  helpdeskTicketId:    number
  interventionType:    string
  interventionContext: string
  source:              string
  dossierNumber:       string
  chauffeurName:       string
  chauffeurSupabaseId: string
  depotDepart?:        string
  clientName:          string
  partnerId?:          number
  vehicleId?:          number
  vehicleInfo?:        string
  incidentAddress?:    string
  destinationAddress?: string
  description?:        string
}): Promise<{ taskId: number; taskUrl: string }> {

  const stageId = await getFsmStageId('Assigné')

  // Trouver le projet FSM (premier projet FSM disponible)
  const projects = await rpcFsm<any[]>('project.project', 'search_read',
    [[['is_fsm', '=', true]]],
    { fields: ['id', 'name'], limit: 1 }
  )
  if (!projects.length) throw new Error('[FSM] Aucun projet Field Service trouvé')
  const projectId = projects[0].id

  const vehiclePlate = params.vehicleInfo?.split(' ')[0] || ''
  const taskName = [
    vehiclePlate || params.vehicleInfo,
    params.dossierNumber,
    params.incidentAddress?.split(',').pop()?.trim() || '',
  ].filter(Boolean).join(' - ')

  const description = [
    params.description || '',
    params.incidentAddress ? `📍 Prise en charge: ${params.incidentAddress}` : '',
    params.destinationAddress ? `🏁 Destination: ${params.destinationAddress}` : '',
  ].filter(Boolean).join('\n')

  const taskData: any = {
    name:       taskName,
    project_id: projectId,
    stage_id:   stageId,
    is_fsm:     true,
    helpdesk_ticket_id: params.helpdeskTicketId,
    description,
    [FSM_FIELDS.supabase_id]:          params.supabaseId,
    [FSM_FIELDS.intervention_type]:    params.interventionType,
    [FSM_FIELDS.intervention_context]: params.interventionContext,
    [FSM_FIELDS.source]:               params.source,
    [FSM_FIELDS.dossier_number]:       params.dossierNumber,
    [FSM_FIELDS.chauffeur_name]:       params.chauffeurName,
    [FSM_FIELDS.chauffeur_id]:         params.chauffeurSupabaseId,
  }

  if (params.depotDepart)       taskData[FSM_FIELDS.depot_depart]              = params.depotDepart
  if (params.partnerId)         taskData.partner_id                              = params.partnerId
  if (params.vehicleId)         taskData['x_studio_vehicule']                   = params.vehicleId
  if (params.incidentAddress)   taskData['x_studio_adresse_dintervention']      = params.incidentAddress
  if (params.destinationAddress) taskData['x_studio_adresse_de_destination']   = params.destinationAddress

  const taskId = await rpcFsm<number>('project.task', 'create', [taskData])
  const taskUrl = `${FSM_URL}/web#id=${taskId}&model=project.task&view_type=form`

  console.log(`[FSM] Tâche FSM créée: #${taskId} — ${taskName}`)
  return { taskId, taskUrl }
}

// ============================================================
// FSM TASK — Mettre à jour le stage
// ============================================================
export async function updateFsmStage(taskId: number, stageName: string): Promise<void> {
  const stageId = await getFsmStageId(stageName)
  await rpcFsm('project.task', 'write', [[taskId], { stage_id: stageId }])
  console.log(`[FSM] Tâche #${taskId} → ${stageName}`)
}

// ============================================================
// FSM TASK — Mettre à jour la zone de parc
// ============================================================
export async function updateFsmParcZone(taskId: number, zoneId: number): Promise<void> {
  await rpcFsm('project.task', 'write', [[taskId], {
    [FSM_FIELDS.zone_parc]: zoneId,
  }])
  console.log(`[FSM] Tâche #${taskId} → zone parc #${zoneId}`)
}

// ============================================================
// FLEET — Mettre à jour le statut du véhicule client
// ============================================================
export async function updateVehicleState(vehicleId: number, stateId: number): Promise<void> {
  await rpcFsm('fleet.vehicle', 'write', [[vehicleId], { state_id: stateId }])
  console.log(`[FSM] Véhicule #${vehicleId} → state #${stateId}`)
}

// ============================================================
// TEST — Vérifier la connexion FSM
// ============================================================
export async function testFsmConnection(): Promise<{ ok: boolean; db: string; stages: string[] }> {
  const stages = await rpcFsm<any[]>('project.task.type', 'search_read',
    [[]], { fields: ['id', 'name'] }
  )
  return {
    ok: true,
    db: FSM_DB,
    stages: stages.map(s => `${s.id}: ${s.name}`),
  }
}

// ============================================================
// PARTENAIRE — Recherche ou création dans la base FSM
// ============================================================
export async function findOrCreateFsmPartner(data: {
  name?:  string
  phone?: string
  email?: string
}): Promise<number> {
  // Chercher par téléphone
  if (data.phone) {
    const clean = data.phone.replace(/\s/g, '')
    const r = await rpcFsm<any[]>('res.partner', 'search_read',
      [[['phone', 'like', clean]]], { fields: ['id', 'name'], limit: 1 })
    if (r.length > 0) return r[0].id
  }
  // Chercher par nom
  if (data.name) {
    const r = await rpcFsm<any[]>('res.partner', 'search_read',
      [[['name', 'ilike', data.name]]], { fields: ['id', 'name'], limit: 1 })
    if (r.length > 0) return r[0].id
  }
  // Créer
  const id = await rpcFsm<number>('res.partner', 'create', [{
    name:          data.name || 'Client inconnu',
    phone:         data.phone || false,
    email:         data.email || false,
    customer_rank: 1,
    company_type:  'person',
  }])
  return id
}


// ============================================================
// FLEET — Chercher ou créer un véhicule dans la base FSM
// ============================================================
export async function findOrCreateFsmVehicle(data: {
  licensePlate: string
  brandName?:   string
  modelName?:   string
  vin?:         string
  fuel?:        string
}): Promise<number | null> {
  if (!data.licensePlate) return null
  const plate = data.licensePlate.toUpperCase().replace(/[-.\s]/g, '')

  // Chercher par plaque
  const existing = await rpcFsm<any[]>('fleet.vehicle', 'search_read',
    [[['license_plate', 'ilike', plate]]],
    { fields: ['id', 'license_plate'], limit: 10 }
  )
  const match = existing.find(v =>
    v.license_plate.replace(/[-.\s]/g, '').toUpperCase() === plate
  )
  if (match) {
    console.log(`[FSM Fleet] Véhicule trouvé: ${plate} (ID: ${match.id})`)
    return match.id
  }

  // Créer le véhicule
  try {
    let modelId: number | null = null

    if (data.brandName && data.modelName) {
      // Chercher ou créer la marque
      let brandId: number | null = null
      const brands = await rpcFsm<any[]>('fleet.vehicle.model.brand', 'search_read',
        [[['name', 'ilike', data.brandName]]], { fields: ['id'], limit: 1 })
      if (brands.length > 0) {
        brandId = brands[0].id
      } else {
        brandId = await rpcFsm<number>('fleet.vehicle.model.brand', 'create', [{ name: data.brandName }])
      }

      // Chercher ou créer le modèle
      const models = await rpcFsm<any[]>('fleet.vehicle.model', 'search_read',
        [[['name', 'ilike', data.modelName], ['brand_id', '=', brandId]]],
        { fields: ['id'], limit: 1 })
      if (models.length > 0) {
        modelId = models[0].id
      } else {
        modelId = await rpcFsm<number>('fleet.vehicle.model', 'create', [{
          name: data.modelName, brand_id: brandId
        }])
      }
    }

    const vehicleData: any = {
      license_plate: data.licensePlate.toUpperCase(),
      ...(modelId ? { model_id: modelId } : {}),
      ...(data.vin   ? { vin_sn: data.vin } : {}),
    }

    const vehicleId = await rpcFsm<number>('fleet.vehicle', 'create', [vehicleData])
    console.log(`[FSM Fleet] Véhicule créé: ${plate} (ID: ${vehicleId})`)
    return vehicleId
  } catch (e) {
    console.error('[FSM Fleet] Erreur création véhicule:', e)
    return null
  }
}