// ============================================================
// VERVIERS DÉPANNAGE — Connecteur Odoo FSM (base test)
// Séparé du connecteur principal — ne pas modifier odoo.ts
// ============================================================

import { resolveBrandId, resolveModelId } from '@/lib/odoo-fleet'

const FSM_URL     = process.env.ODOO_TEST_URL || process.env.ODOO_URL!
const FSM_DB      = process.env.ODOO_TEST_DB  || process.env.ODOO_DB!
const FSM_UID     = parseInt(process.env.ODOO_UID || '8')
const FSM_API_KEY = process.env.ODOO_API_KEY!

// Noms techniques des champs custom Studio sur project.task
// (vehicule_fleet1 = related lecture seule vers helpdesk_ticket_id.x_studio_vehicule, donc pas écrit ici)
export const FSM_FIELDS = {
  intervention_type:    'x_studio_intervention_type',
  intervention_context: 'x_studio_intervention_context',
  source:               'x_studio_source',
  dossier_number:       'x_studio_dossier_number',
  chauffeur_name:       'x_studio_chauffeur_name',
  chauffeur_id:         'x_studio_chauffeur_id',
  depot_depart:         'x_studio_depot_depart',
  rel_address:          'x_studio_rel_address',
  mission_parent_id:    'x_studio_mission_parent_id',
  supabase_id:          'x_studio_supabase_id',
  adresse_intervention: 'x_studio_adresse_intervention',
  adresse_destination:  'x_studio_adresse_destination',
  beneficiaire_name:    'x_studio_beneficiaire_name',
  beneficiaire_phone:   'x_studio_beneficiaire_phone',
}

export const HELPDESK_FIELDS = {
  supabase_id:      'x_studio_id_supabase',
  dossier_number:   'x_studio_n_dossier',
  source:           'x_studio_source_1',  // suffixe _1 ajouté par Studio (conflit avec un autre source ailleurs)
  mission_towsoft:  'x_studio_mission_towsoft',
  date_entree:      'x_studio_date_dentree',
  vehicule:         'x_studio_vehicule',
}

// États véhicule Parc Auto
export const HELPDESK_TAGS: Record<string, number> = {
  accident:    6,
  saisie:      5,
  snc:         15,
  mal_garee:   1,
  appel_prive: 25,
}

// IDs fleet.vehicle.state (Odoo prod 2026-05-05)
// Workflow : confirmation → intervention_en_cours → (charge_sur_camion → parc final | termine pour DSP/annulation)
export const FLEET_STATES = {
  intervention_en_cours: 27,
  charge_sur_camion:     28,
  transit:               15,  // = zone de relivraison (parc, pas un état de transit)
  mal_garee:             17,  // L (MG)
  termine:               18,  // état final : DSP fermé, mission annulée, restitution
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
// Filtrage défensif des champs Studio custom (x_*)
// ============================================================
// Si un champ custom attendu par le code n'existe pas (encore) côté Odoo,
// on l'ignore silencieusement avec un warning au lieu de planter.
// Cache module-level : 1 query Odoo par modèle au démarrage du process Vercel.
const _knownCustomFieldsCache: Record<string, Set<string>> = {}

async function getKnownCustomFields(model: string): Promise<Set<string>> {
  if (_knownCustomFieldsCache[model]) return _knownCustomFieldsCache[model]
  try {
    const fields = await rpcFsm<any[]>(
      'ir.model.fields',
      'search_read',
      [[['model', '=', model], ['name', '=like', 'x_%']]],
      { fields: ['name'] }
    )
    _knownCustomFieldsCache[model] = new Set(fields.map(f => f.name))
  } catch (e: any) {
    console.warn(`[FSM] Impossible de lister les champs custom de ${model}: ${e.message}. Le payload sera envoyé tel quel.`)
    _knownCustomFieldsCache[model] = new Set()  // vide → on n'enverra aucun x_*
  }
  return _knownCustomFieldsCache[model]
}

/** Retire du payload les champs x_* qui n'existent pas dans Odoo, garde les champs standards. */
async function filterCustomFields<T extends Record<string, any>>(
  model: string,
  payload: T
): Promise<T> {
  const known = await getKnownCustomFields(model)
  const out: Record<string, any> = {}
  const skipped: string[] = []
  for (const [k, v] of Object.entries(payload)) {
    if (!k.startsWith('x_')) {
      // Champ standard Odoo → toujours garder
      out[k] = v
      continue
    }
    if (known.has(k)) {
      out[k] = v
    } else {
      skipped.push(k)
    }
  }
  if (skipped.length > 0) {
    console.warn(`[FSM] Champs custom absents de ${model} → ignorés : ${skipped.join(', ')}`)
  }
  return out as T
}

// ============================================================
// STAGES FSM — IDs hardcodés du projet Field Service #6 (prod 2026-05-05)
// 'A facturer' sans accent (Odoo SaaS ne permet pas la majuscule À via UI Studio)
// ============================================================
export const FSM_STAGES: Record<string, number> = {
  'Nouveau':                    66,
  'Assigné':                    67,
  'En route':                   76,
  'Sur place':                  68,
  'En route vers destination':  79,
  'Arrivé à destination':       80,
  'Mise en parc':               77,
  'A facturer':                 78,
  'Terminé':                    69,
  'Annulé':                     70,
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
  supabaseId:      string
  dossierNumber:   string
  source:          string
  clientName:      string
  partnerId?:      number
  odooPartner?:    string  // nom du partenaire Odoo pour recherche auto
  description?:    string
  teamId?:         number
  vehiclePlate?:   string
  vehicleBrand?:   string
  vehicleModel?:   string
  vehicleVin?:     string
  city?:           string
  dateIntervention?: string
  missionType?:    string
  tagIds?:         number[]  // tags multiples (compagnie + type)
  noteEtiquette?:  string
  stageId?:        number    // ID de l'étape helpdesk.stage (4 = Résolu)
  namePrefix?:     string    // ex: '[TEST] ' — préfixé au name du ticket
}): Promise<{ ticketId: number; ticketUrl: string }> {

  // Chercher/créer le véhicule et mettre à jour son statut
  let vehicleId: number | null = null
  if (params.vehiclePlate) {
    vehicleId = await findOrCreateFsmVehicle({
      licensePlate: params.vehiclePlate,
      brandName:    params.vehicleBrand,
      modelName:    params.vehicleModel,
      vin:          params.vehicleVin,
    })
    // Mettre à jour le statut du véhicule à la création du dossier :
    // - mal_garee  → directement en parc L (MG), le véhicule est déjà déplacé par la police
    // - autres cas → "Intervention en cours" (mission engagée, véhicule pas encore chez nous).
    //   Les transitions ultérieures (Chargé sur camion → parc final → Terminé) seront
    //   déclenchées par l'app chauffeur quand elle existera.
    // ⚠ Pas conditionné sur missionType : odoo-dossier ne le passe pas, et tout dossier
    // (assistance ou police) doit toujours sortir le véhicule de "Terminé".
    if (vehicleId) {
      const stateId = params.missionType === 'mal_garee'
        ? FLEET_STATES.mal_garee
        : FLEET_STATES.intervention_en_cours
      await updateVehicleState(vehicleId, stateId)
    }
  }

  // Chercher le partenaire Odoo si spécifié
  let partnerId = params.partnerId
  if (!partnerId && params.odooPartner) {
    try {
      const partners = await rpcFsm<any[]>('res.partner', 'search_read',
        [[['name', '=', params.odooPartner]]],
        { fields: ['id', 'name'], limit: 1 }
      )
      if (partners.length > 0) partnerId = partners[0].id
    } catch (e) { console.error('[FSM] Partenaire non trouvé:', params.odooPartner) }
  }

  const noteEtiquette = params.noteEtiquette || 'Généré par VDBot by HOOS'

  const ticketData: any = {
    name:        (params.namePrefix || '') + 'Etiquette automatique',
    x_studio_note_sur_etiquette: noteEtiquette,
    team_id:     params.teamId || 12,
    description: params.description || '',
  }

  // Champs Studio production
  if (params.supabaseId)       ticketData[HELPDESK_FIELDS.supabase_id]    = params.supabaseId
  if (params.dossierNumber)    ticketData[HELPDESK_FIELDS.dossier_number] = params.dossierNumber
  if (params.source)           ticketData[HELPDESK_FIELDS.source]         = params.source.toUpperCase()
  if (params.dateIntervention) ticketData[HELPDESK_FIELDS.date_entree]    = params.dateIntervention.split('-').reverse().join('-')
  if (vehicleId)               ticketData[HELPDESK_FIELDS.vehicule]       = vehicleId
  if (partnerId)               ticketData.partner_id                      = partnerId
  if (params.stageId)          ticketData.stage_id                        = params.stageId
  // Tags — priorité à tagIds si fourni, sinon fallback sur HELPDESK_TAGS
  if (params.tagIds && params.tagIds.length > 0) {
    ticketData.tag_ids = params.tagIds.map(id => [4, id])
  } else if (params.missionType && HELPDESK_TAGS[params.missionType]) {
    ticketData.tag_ids = [[4, HELPDESK_TAGS[params.missionType]]]
  }

  // Filtrage défensif : retirer les x_studio_* qui n'existent pas (encore) côté Odoo
  const filteredTicketData = await filterCustomFields('helpdesk.ticket', ticketData)
  const ticketId = await rpcFsm<number>('helpdesk.ticket', 'create', [filteredTicketData])
  const ticketUrl = `${FSM_URL}/web#id=${ticketId}&model=helpdesk.ticket&view_type=form`

  console.log(`[FSM] Helpdesk ticket créé: #${ticketId}`)
  return { ticketId, ticketUrl }
}

// Mettre à jour le numéro TowSoft sur un ticket Helpdesk
export async function updateHelpdeskTowsoftNumber(ticketId: number, missionNumber: string): Promise<void> {
  // Extraire uniquement les chiffres (ex: SVR-55547 → 55547)
  const number = missionNumber.replace(/[^0-9]/g, '')
  await rpcFsm('helpdesk.ticket', 'write', [[ticketId], {
    [HELPDESK_FIELDS.mission_towsoft]: number,
  }])
  console.log(`[FSM] Ticket #${ticketId} → TowSoft #${number}`)
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
  beneficiaryName?:    string  // client physiquement dépanné (≠ partner_id qui est le payeur)
  beneficiaryPhone?:   string
  namePrefix?:         string  // ex: '[TEST] ' — préfixé au name de la task
}): Promise<{ taskId: number; taskUrl: string } | null> {

  // Trouver le projet FSM (premier projet FSM disponible)
  const projects = await rpcFsm<any[]>('project.project', 'search_read',
    [[['is_fsm', '=', true]]],
    { fields: ['id', 'name'], limit: 1 }
  )
  if (!projects.length) {
    console.warn('[FSM] Aucun projet Field Service trouvé — création de la tâche FSM ignorée. Active use_fsm sur une équipe Helpdesk pour générer le projet automatiquement.')
    return null
  }
  const projectId = projects[0].id

  // Stage initial à la création : "Nouveau" (= confirmation dispatch, pas encore de chauffeur).
  // Le passage à "Assigné" se fait dans /api/missions/assign quand un chauffeur est attribué.
  // Fallback New/Planned si l'utilisateur n'a pas créé "Nouveau".
  let stageId: number
  try {
    stageId = await getFsmStageId('Nouveau')
  } catch {
    try {
      stageId = await getFsmStageId('New')
    } catch {
      try {
        stageId = await getFsmStageId('Planned')
      } catch (e) {
        console.warn('[FSM] Aucun stage trouvé (Nouveau/New/Planned) — création tâche ignorée')
        return null
      }
    }
  }

  const vehiclePlate = params.vehicleInfo?.split(' ')[0] || ''
  const taskName = (params.namePrefix || '') + [
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

  if (params.depotDepart)        taskData[FSM_FIELDS.depot_depart]         = params.depotDepart
  if (params.partnerId)          taskData.partner_id                       = params.partnerId
  // Véhicule : pas écrit ici — affiché via le related x_studio_vehicule_fleet1 qui pointe vers le ticket helpdesk parent
  if (params.incidentAddress)    taskData[FSM_FIELDS.adresse_intervention] = params.incidentAddress
  if (params.destinationAddress) taskData[FSM_FIELDS.adresse_destination]  = params.destinationAddress
  if (params.beneficiaryName)    taskData[FSM_FIELDS.beneficiaire_name]    = params.beneficiaryName
  if (params.beneficiaryPhone)   taskData[FSM_FIELDS.beneficiaire_phone]   = params.beneficiaryPhone

  // Filtrage défensif : retirer les x_studio_* qui n'existent pas (encore) côté Odoo
  const filteredTaskData = await filterCustomFields('project.task', taskData)
  const taskId = await rpcFsm<number>('project.task', 'create', [filteredTaskData])
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
// FLEET — Mettre à jour le statut du véhicule client
// (= seule source de vérité pour la zone de parc, lue côté task FSM via related)
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
// ATTACHMENTS — Upload photos sur une fiche FSM (project.task)
// ============================================================
/**
 * Récupère les photos depuis leurs URLs Supabase et les upload sur Odoo
 * comme ir.attachment liées à la project.task. Apparaissent dans l'onglet
 * "Pièces jointes" du chatter Odoo et dans la barre latérale.
 *
 * Best effort : log les erreurs mais ne fait pas crasher l'appel parent.
 */
export async function attachPhotosToFsmTask(
  taskId:    number,
  photoUrls: string[]
): Promise<{ uploaded: number; skipped: number; failed: number }> {
  if (photoUrls.length === 0) return { uploaded: 0, skipped: 0, failed: 0 }

  // Dédup par filename : on récupère les attachments existants pour ne pas uploader 2 fois.
  const existing = await rpcFsm<any[]>('ir.attachment', 'search_read',
    [[['res_model', '=', 'project.task'], ['res_id', '=', taskId]]],
    { fields: ['name'] }
  )
  const existingNames = new Set(existing.map(a => a.name))

  let uploaded = 0, skipped = 0, failed = 0
  for (let i = 0; i < photoUrls.length; i++) {
    const url = photoUrls[i]
    const filename = url.split('/').pop()?.split('?')[0] || `photo-${i + 1}.jpg`
    if (existingNames.has(filename)) { skipped++; continue }
    try {
      const res = await fetch(url)
      if (!res.ok) { failed++; continue }
      const buf = await res.arrayBuffer()
      const b64 = Buffer.from(buf).toString('base64')
      const mimetype = res.headers.get('content-type') || 'image/jpeg'
      await rpcFsm('ir.attachment', 'create', [{
        name:      filename,
        type:      'binary',
        datas:     b64,
        res_model: 'project.task',
        res_id:    taskId,
        mimetype,
      }])
      uploaded++
    } catch (e: any) {
      console.warn(`[FSM] Échec upload photo ${i + 1}/${photoUrls.length}: ${e.message}`)
      failed++
    }
  }
  console.log(`[FSM] Photos task #${taskId}: ${uploaded} uploaded, ${skipped} skipped (déjà présent), ${failed} échecs`)
  return { uploaded, skipped, failed }
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
  gearbox?:     string
}): Promise<number | null> {
  if (!data.licensePlate) return null
  const plate = data.licensePlate.toUpperCase().replace(/[-.\s]/g, '')

  // Helper : compléter les champs absents (VIN, carburant, boîte) sur un véhicule existant
  // sans jamais écraser une valeur déjà saisie côté Odoo.
  const fillMissingFields = async (vehicleId: number) => {
    if (!data.vin && !data.fuel && !data.gearbox) return
    try {
      const [current] = await rpcFsm<any[]>('fleet.vehicle', 'read', [[vehicleId]],
        { fields: ['vin_sn', 'fuel_type', 'transmission'] })
      if (!current) return
      const updates: Record<string, any> = {}
      if (data.vin?.trim()     && !current.vin_sn)       updates.vin_sn       = data.vin.trim()
      if (data.fuel?.trim()    && !current.fuel_type)    updates.fuel_type    = data.fuel
      if (data.gearbox?.trim() && !current.transmission) updates.transmission = data.gearbox
      if (Object.keys(updates).length > 0) {
        await rpcFsm('fleet.vehicle', 'write', [[vehicleId], updates])
        console.log(`[FSM Fleet] Champs complétés sur #${vehicleId}: ${Object.keys(updates).join(', ')}`)
      }
    } catch (e: any) {
      console.warn(`[FSM Fleet] Impossible de compléter le véhicule #${vehicleId}: ${e.message}`)
    }
  }

  // Chercher par plaque
  const existing = await rpcFsm<any[]>('fleet.vehicle', 'search_read',
    [[['license_plate', 'ilike', plate]]],
    { fields: ['id', 'license_plate', 'model_id'], limit: 10 }
  )
  const platesMatch = existing.filter(v =>
    v.license_plate.replace(/[-.\s]/g, '').toUpperCase() === plate
  )

  if (platesMatch.length > 0) {
    // Si on n'a pas marque+modèle entrants, fallback historique : premier match plaque
    if (!data.brandName || !data.modelName) {
      console.log(`[FSM Fleet] Véhicule trouvé (sans comparaison marque/modèle): ${plate} (ID: ${platesMatch[0].id})`)
      await fillMissingFields(platesMatch[0].id)
      return platesMatch[0].id
    }

    // Vérifier que marque+modèle correspondent — si le client a remis sa plaque
    // sur un nouveau véhicule, on doit créer une nouvelle fiche véhicule (la plaque
    // existe en double dans Odoo, l'ancienne fiche reste pour l'historique).
    const modelIds = platesMatch
      .map(v => Array.isArray(v.model_id) ? v.model_id[0] : null)
      .filter((id): id is number => typeof id === 'number')

    const models = modelIds.length > 0
      ? await rpcFsm<any[]>('fleet.vehicle.model', 'search_read',
          [[['id', 'in', modelIds]]],
          { fields: ['id', 'name', 'brand_id'] })
      : []

    const norm = (s: string) => (s || '').toLowerCase().replace(/[-.\s]/g, '').trim()
    // Match permissif : l'un inclut l'autre après normalisation (ex: "Mercedes" ⊂ "Mercedes-Benz")
    const fuzzyMatch = (a: string, b: string) => {
      const na = norm(a), nb = norm(b)
      if (!na || !nb) return false
      return na.includes(nb) || nb.includes(na)
    }

    for (const candidate of platesMatch) {
      const modelId = Array.isArray(candidate.model_id) ? candidate.model_id[0] : null
      if (!modelId) continue
      const m = models.find(x => x.id === modelId)
      if (!m) continue
      const existingBrand = Array.isArray(m.brand_id) ? (m.brand_id[1] || '') : ''
      const existingModel = m.name || ''
      if (fuzzyMatch(existingBrand, data.brandName) && fuzzyMatch(existingModel, data.modelName)) {
        console.log(`[FSM Fleet] Véhicule existant compatible: ${plate} (ID: ${candidate.id}) — "${existingBrand} ${existingModel}" ≈ "${data.brandName} ${data.modelName}"`)
        await fillMissingFields(candidate.id)
        return candidate.id
      }
    }

    console.log(`[FSM Fleet] Plaque ${plate} existe (${platesMatch.length} véhicule(s)) mais aucune marque/modèle ne correspond à "${data.brandName} ${data.modelName}" — création d'une nouvelle fiche véhicule`)
  }

  // Créer le véhicule
  try {
    let modelId: number | null = null

    if (data.brandName && data.modelName) {
      // Résolution centralisée anti-doublon — cf. @/lib/odoo-fleet.
      const brandId = await resolveBrandId(rpcFsm, data.brandName)
      modelId       = await resolveModelId(rpcFsm, brandId, data.modelName)
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