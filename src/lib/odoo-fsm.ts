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
// STAGES FSM — Récupérer l'ID d'une étape par son nom
// ============================================================
const stageCache: Record<string, number> = {}

export async function getFsmStageId(stageName: string): Promise<number> {
  if (stageCache[stageName]) return stageCache[stageName]
  const results = await rpcFsm<any[]>('project.task.type', 'search_read',
    [[['name', 'ilike', stageName]]],
    { fields: ['id', 'name'], limit: 1 }
  )
  if (!results.length) throw new Error(`[FSM] Étape "${stageName}" introuvable`)
  stageCache[stageName] = results[0].id
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
}): Promise<{ ticketId: number; ticketUrl: string }> {

  // Trouver l'équipe Helpdesk (première équipe disponible)
  const teams = await rpcFsm<any[]>('helpdesk.team', 'search_read',
    [[]], { fields: ['id', 'name'], limit: 1 }
  )
  if (!teams.length) throw new Error('[FSM] Aucune équipe Helpdesk trouvée')
  const teamId = teams[0].id

  const ticketData: any = {
    name:       `${params.source} — ${params.clientName} — ${params.dossierNumber}`,
    team_id:    teamId,
    description: params.description || '',
    [HELPDESK_FIELDS.supabase_id]:    params.supabaseId,
    [HELPDESK_FIELDS.dossier_number]: params.dossierNumber,
    [HELPDESK_FIELDS.source]:         params.source,
  }
  if (params.partnerId) ticketData.partner_id = params.partnerId

  const ticketId = await rpcFsm<number>('helpdesk.ticket', 'create', [ticketData])
  const ticketUrl = `${FSM_URL}/odoo/helpdesk/${ticketId}`

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

  const taskName = [
    params.interventionType,
    params.clientName,
    params.vehicleInfo,
  ].filter(Boolean).join(' — ')

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
    description,
    [FSM_FIELDS.supabase_id]:          params.supabaseId,
    [FSM_FIELDS.intervention_type]:    params.interventionType,
    [FSM_FIELDS.intervention_context]: params.interventionContext,
    [FSM_FIELDS.source]:               params.source,
    [FSM_FIELDS.dossier_number]:       params.dossierNumber,
    [FSM_FIELDS.chauffeur_name]:       params.chauffeurName,
    [FSM_FIELDS.chauffeur_id]:         params.chauffeurSupabaseId,
  }

  if (params.depotDepart) taskData[FSM_FIELDS.depot_depart] = params.depotDepart
  if (params.partnerId)   taskData.partner_id = params.partnerId

  const taskId = await rpcFsm<number>('project.task', 'create', [taskData])
  const taskUrl = `${FSM_URL}/odoo/field-service/${taskId}`

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
