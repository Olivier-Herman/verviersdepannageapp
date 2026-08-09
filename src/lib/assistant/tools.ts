// src/lib/assistant/tools.ts
//
// Registry des outils exposes a l assistant Claude (mode tool use).
// Chaque outil a :
//   - name           : id technique
//   - description    : aide pour Claude (pourquoi/quand l utiliser)
//   - input_schema   : JSONSchema des arguments
//   - destructive    : si true, l assistant doit explicitement confirmer
//                       par texte avant de l appeler (prompt engineering)
//   - execute(args, ctx) : fonction asynchrone, retourne le resultat brut

import { createAdminClient } from '@/lib/supabase'

export interface ToolContext {
  userId:    string
  userEmail: string
  userName:  string
}

export interface ToolDef {
  name:         string
  description:  string
  destructive:  boolean
  input_schema: any
  execute:      (args: any, ctx: ToolContext) => Promise<any>
}

const sb = () => createAdminClient()

// ─────────────────────────────────────────────────────────────────────
// TARIFS (source_tariffs)
// ─────────────────────────────────────────────────────────────────────

const tariffTools: ToolDef[] = [
  {
    name:        'list_tariffs',
    description: 'Liste les tarifs en vigueur. Optionnel : filtre par source (ex: vab, touring). Retourne les forfaits, km inclus, prix/km, etc.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Cle de la source (lowercase). Vide = toutes.' },
        include_expired: { type: 'boolean', description: 'Inclure tarifs avec effective_to passe', default: false },
      },
    },
    async execute(args) {
      let q = sb().from('source_tariffs').select('*').order('source').order('mission_type')
      if (args.source) q = q.eq('source', String(args.source).toLowerCase())
      if (!args.include_expired) q = q.or('effective_to.is.null,effective_to.gte.' + new Date().toISOString().slice(0, 10))
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, tariffs: data || [] }
    },
  },
  {
    name:        'create_tariff',
    description: 'Cree un nouveau tarif dans source_tariffs. Requis : source, mission_type, unit_price (forfait HT). Optionnels : km_inclus, km_price, km_basis (charged|total), parc_day_price, effective_from (YYYY-MM-DD), conditions, is_autofac.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        source:         { type: 'string' },
        mission_type:   { type: 'string', enum: ['remorquage', 'depannage', 'trajet_vide', 'parc'] },
        unit_price:     { type: 'number', description: 'Forfait HT en euros (0 si pas de forfait fixe)' },
        km_inclus:      { type: 'number', default: 0 },
        km_price:       { type: 'number', description: 'Prix par km au-dela des km inclus' },
        km_basis:       { type: 'string', enum: ['charged', 'total'], default: 'charged' },
        parc_day_price: { type: 'number' },
        effective_from: { type: 'string', description: 'YYYY-MM-DD, defaut = aujourd hui' },
        conditions:     { type: 'string' },
        is_autofac:     { type: 'boolean', default: false },
      },
      required: ['source', 'mission_type', 'unit_price'],
    },
    async execute(args, ctx) {
      const { data: actor } = await sb().from('users').select('id').eq('id', ctx.userId).maybeSingle()
      const { data, error } = await sb().from('source_tariffs').insert({
        source:         String(args.source).toLowerCase().trim(),
        mission_type:   String(args.mission_type).toLowerCase().trim(),
        unit_price:     args.unit_price,
        km_inclus:      args.km_inclus ?? 0,
        km_price:       args.km_price ?? null,
        km_basis:       args.km_basis === 'total' ? 'total' : 'charged',
        parc_day_price: args.parc_day_price ?? null,
        effective_from: args.effective_from || new Date().toISOString().slice(0, 10),
        conditions:     args.conditions || null,
        is_autofac:     Boolean(args.is_autofac),
        created_by:     actor?.id || null,
      }).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, tariff: data }
    },
  },
  {
    name:        'update_tariff',
    description: 'Modifie un tarif existant. Specifie l id et les champs a changer.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        id:             { type: 'string' },
        source:         { type: 'string' },
        mission_type:   { type: 'string' },
        unit_price:     { type: 'number' },
        km_inclus:      { type: 'number' },
        km_price:       { type: 'number' },
        km_basis:       { type: 'string', enum: ['charged', 'total'] },
        parc_day_price: { type: 'number' },
        effective_from: { type: 'string' },
        effective_to:   { type: 'string' },
        conditions:     { type: 'string' },
        is_autofac:     { type: 'boolean' },
      },
      required: ['id'],
    },
    async execute(args) {
      const { id, ...rest } = args
      const updates: any = { ...rest, updated_at: new Date().toISOString() }
      const { data, error } = await sb().from('source_tariffs').update(updates).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, tariff: data }
    },
  },
  {
    name:        'delete_tariff',
    description: 'Desactive un tarif (set effective_to = today). Le tarif reste visible mais ne s applique plus.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(args) {
      const { error } = await sb().from('source_tariffs')
        .update({ effective_to: new Date().toISOString().slice(0, 10) }).eq('id', args.id)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// SOURCES (mission_source_catalog)
// ─────────────────────────────────────────────────────────────────────

const sourceTools: ToolDef[] = [
  {
    name:        'list_sources',
    description: 'Liste toutes les sources de mission (Touring, VAB, etc.).',
    destructive: false,
    input_schema: { type: 'object', properties: {} },
    async execute() {
      const { data, error } = await sb().from('mission_source_catalog').select('*').order('label')
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, sources: data || [] }
    },
  },
  {
    name:        'create_source',
    description: 'Cree une nouvelle source de mission. La cle est auto-generee depuis le label si non fournie.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        label:                  { type: 'string', description: 'Nom affiche (ex: "TGR Touring")' },
        key:                    { type: 'string', description: 'Cle technique lowercase (ex: "tgr_touring"). Auto-generee si vide.' },
        sort_order:             { type: 'number', default: 100 },
        notes:                  { type: 'string' },
        default_billed_to_id:   { type: 'number', description: 'ID partenaire Odoo pour facturation par defaut' },
        default_billed_to_name: { type: 'string' },
      },
      required: ['label'],
    },
    async execute(args) {
      const label = String(args.label).trim()
      const key = args.key
        ? String(args.key).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
        : label.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const { data, error } = await sb().from('mission_source_catalog').insert({
        key, label, sort_order: args.sort_order ?? 100,
        notes: args.notes || null,
        default_billed_to_id: args.default_billed_to_id ?? null,
        default_billed_to_name: args.default_billed_to_name || null,
      }).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, source: data }
    },
  },
  {
    name:        'update_source',
    description: 'Modifie une source existante : label, sort_order, notes, client par defaut. ATTENTION : la cle technique (key) n est PAS modifiable (referencee par les missions historiques).',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        key:                    { type: 'string', description: 'Cle technique de la source a modifier (ex: "ardenne")' },
        label:                  { type: 'string', description: 'Nouveau libelle' },
        sort_order:             { type: 'number' },
        notes:                  { type: 'string' },
        default_billed_to_id:   { type: 'number' },
        default_billed_to_name: { type: 'string' },
      },
      required: ['key'],
    },
    async execute(args) {
      const update: any = { updated_at: new Date().toISOString() }
      if (args.label !== undefined)                  update.label                  = String(args.label).trim()
      if (args.sort_order !== undefined)             update.sort_order             = args.sort_order
      if (args.notes !== undefined)                  update.notes                  = args.notes || null
      if (args.default_billed_to_id !== undefined)   update.default_billed_to_id   = args.default_billed_to_id ?? null
      if (args.default_billed_to_name !== undefined) update.default_billed_to_name = args.default_billed_to_name || null
      const { data, error } = await sb().from('mission_source_catalog').update(update).eq('key', args.key).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, source: data }
    },
  },
  {
    name:        'toggle_source',
    description: 'Active ou desactive une source (par cle).',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        key:    { type: 'string' },
        active: { type: 'boolean' },
      },
      required: ['key', 'active'],
    },
    async execute(args) {
      const { error } = await sb().from('mission_source_catalog')
        .update({ active: args.active, updated_at: new Date().toISOString() }).eq('key', args.key)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
  {
    name:        'delete_source',
    description: 'Supprime une source du catalogue. NB : echoue si des missions historiques l utilisent (refuse soft, propose toggle_source(active=false)).',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
    async execute(args) {
      const { count } = await sb().from('incoming_missions')
        .select('id', { count: 'exact', head: true }).eq('source', args.key)
      if ((count || 0) > 0) {
        throw new Error(`${count} mission(s) historique(s) utilisent cette source. Utilise toggle_source(active=false) pour la cacher sans casser l historique.`)
      }
      const { error } = await sb().from('mission_source_catalog').delete().eq('key', args.key)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// REGLES DYNAMIQUES (tariff_rules)
// ─────────────────────────────────────────────────────────────────────

const ruleTools: ToolDef[] = [
  {
    name:        'list_tariff_rules',
    description: 'Liste les regles tarifaires dynamiques (exceptions temporelles, surcharges carburant, etc.).',
    destructive: false,
    input_schema: { type: 'object', properties: {} },
    async execute() {
      const { data, error } = await sb().from('tariff_rules').select('*').order('priority').order('created_at')
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, rules: data || [] }
    },
  },
  {
    name:        'create_tariff_rule',
    description: 'Cree une regle dynamique. operation_type: add_fixed (ajouter Xeur), add_pct (ajouter X%), set_fixed (remplacer total par X). Filtres optionnels : filter_source, filter_mission_type, filter_date_from/to (YYYY-MM-DD), filter_client_name.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        description:         { type: 'string' },
        reason:              { type: 'string' },
        filter_source:       { type: 'string' },
        filter_mission_type: { type: 'string' },
        filter_date_from:    { type: 'string' },
        filter_date_to:      { type: 'string' },
        filter_client_name:  { type: 'string' },
        operation_type:      { type: 'string', enum: ['add_fixed', 'add_pct', 'set_fixed'] },
        operation_value:     { type: 'number' },
      },
      required: ['description', 'reason', 'operation_type', 'operation_value'],
    },
    async execute(args) {
      const { data, error } = await sb().from('tariff_rules').insert({
        description:         args.description,
        reason:              args.reason,
        filter_source:       args.filter_source || null,
        filter_mission_type: args.filter_mission_type || null,
        filter_date_from:    args.filter_date_from || null,
        filter_date_to:      args.filter_date_to || null,
        filter_client_name:  args.filter_client_name || null,
        operation_type:      args.operation_type,
        operation_value:     args.operation_value,
        active:              true,
        priority:            100,
      }).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, rule: data }
    },
  },
  {
    name:        'update_tariff_rule',
    description: 'Modifie une regle dynamique existante. Specifie l id et les champs a changer.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        id:                  { type: 'string' },
        description:         { type: 'string' },
        reason:              { type: 'string' },
        filter_source:       { type: 'string' },
        filter_mission_type: { type: 'string' },
        filter_date_from:    { type: 'string' },
        filter_date_to:      { type: 'string' },
        filter_client_name:  { type: 'string' },
        operation_type:      { type: 'string', enum: ['add_fixed', 'add_pct', 'set_fixed'] },
        operation_value:     { type: 'number' },
        priority:            { type: 'number' },
      },
      required: ['id'],
    },
    async execute(args) {
      const { id, ...rest } = args
      const { data, error } = await sb().from('tariff_rules').update(rest).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, rule: data }
    },
  },
  {
    name:        'toggle_tariff_rule',
    description: 'Active ou desactive une regle dynamique sans la supprimer.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        id:     { type: 'string' },
        active: { type: 'boolean' },
      },
      required: ['id', 'active'],
    },
    async execute(args) {
      const { error } = await sb().from('tariff_rules').update({ active: args.active }).eq('id', args.id)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
  {
    name:        'delete_tariff_rule',
    description: 'Supprime une regle dynamique par id.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(args) {
      const { error } = await sb().from('tariff_rules').delete().eq('id', args.id)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// MISSIONS (recherche read-only + remarques)
// ─────────────────────────────────────────────────────────────────────

const missionTools: ToolDef[] = [
  {
    name:        'search_missions',
    description: 'Recherche des missions par plaque, dossier, client, ou texte libre. Max 20 resultats.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        query:    { type: 'string', description: 'Texte a chercher (plaque, dossier, client, ville)' },
        status:   { type: 'string', description: 'Filtre statut (new, dispatching, assigned, en_route, en_intervention, terminated, etc.)' },
        source:   { type: 'string' },
        limit:    { type: 'number', default: 10, maximum: 20 },
      },
    },
    async execute(args) {
      const limit = Math.min(20, Math.max(1, args.limit || 10))
      let q = sb().from('incoming_missions')
        .select('id, dossier_number, external_id, source, status, client_name, vehicle_plate, vehicle_brand, vehicle_model, incident_city, intervention_date, received_at')
        .order('received_at', { ascending: false })
        .range(0, limit - 1)
      if (args.status) q = q.eq('status', args.status)
      if (args.source) q = q.eq('source', args.source)
      if (args.query) {
        const v = `%${String(args.query).trim()}%`
        q = q.or(`vehicle_plate.ilike.${v},dossier_number.ilike.${v},client_name.ilike.${v},incident_city.ilike.${v},external_id.ilike.${v}`)
      }
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, missions: data || [] }
    },
  },
  {
    name:        'get_mission',
    description: 'Recupere le detail complet d une mission par id.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(args) {
      const { data, error } = await sb().from('incoming_missions').select('*').eq('id', args.id).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Mission introuvable')
      return { mission: data }
    },
  },
  {
    name:        'update_mission',
    description: 'Modifie les champs d une mission (PATCH). Tous les champs sont optionnels — specifie uniquement ceux a changer. ATTENTION : modifier le statut peut casser le workflow, prefere les actions dediees.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        id:                   { type: 'string' },
        source:               { type: 'string' },
        mission_type:         { type: 'string' },
        incident_type:        { type: 'string' },
        incident_description: { type: 'string' },
        client_name:          { type: 'string' },
        client_phone:         { type: 'string' },
        client_address:       { type: 'string' },
        assisted_name:        { type: 'string' },
        assisted_phone:       { type: 'string' },
        vehicle_plate:        { type: 'string' },
        vehicle_brand:        { type: 'string' },
        vehicle_model:        { type: 'string' },
        vehicle_vin:          { type: 'string' },
        incident_address:     { type: 'string' },
        incident_city:        { type: 'string' },
        destination_name:     { type: 'string' },
        destination_address:  { type: 'string' },
        amount_guaranteed:    { type: 'number' },
        amount_to_collect:    { type: 'number' },
        intervention_date:    { type: 'string', description: 'YYYY-MM-DD HH:MM:SS' },
        remarks_general:      { type: 'string' },
      },
      required: ['id'],
    },
    async execute(args) {
      const { id, ...fields } = args
      const updates: any = { updated_at: new Date().toISOString() }
      for (const [k, v] of Object.entries(fields)) {
        updates[k] = v === '' ? null : v
      }
      const { data, error } = await sb().from('incoming_missions').update(updates).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, mission: data }
    },
  },
  {
    name:        'add_mission_remark',
    description: 'Ajoute une remarque dispatcher (note texte) sur une mission.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        mission_id: { type: 'string' },
        text:       { type: 'string' },
      },
      required: ['mission_id', 'text'],
    },
    async execute(args, ctx) {
      const { data, error } = await sb().from('mission_remarks').insert({
        mission_id: args.mission_id,
        text:       args.text,
        created_by: ctx.userId,
      }).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, remark: data }
    },
  },
  {
    name:        'list_mission_remarks',
    description: 'Liste les remarques (notes dispatcher) d une mission.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: { mission_id: { type: 'string' } },
      required: ['mission_id'],
    },
    async execute(args) {
      const { data, error } = await sb()
        .from('mission_remarks')
        .select('id, text, created_at, updated_at, author:users!created_by(name, email)')
        .eq('mission_id', args.mission_id)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, remarks: data || [] }
    },
  },
  {
    name:        'delete_mission_remark',
    description: 'Supprime une remarque par id.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(args) {
      const { error } = await sb().from('mission_remarks').delete().eq('id', args.id)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// SURCHARGES (majorations horaires : nuit / WE / JF)
// ─────────────────────────────────────────────────────────────────────

const surchargeTools: ToolDef[] = [
  {
    name:        'list_surcharges',
    description: 'Liste les majorations horaires (nuit, weekend, JF) configurees.',
    destructive: false,
    input_schema: { type: 'object', properties: {} },
    async execute() {
      const { data, error } = await sb().from('surcharges').select('*').order('priority').order('label')
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, surcharges: data || [] }
    },
  },
  {
    name:        'create_surcharge',
    description: 'Cree une majoration horaire (nuit/WE/JF). days est un array de 0-6 (0=lundi, 6=dimanche). holiday_only: applique aux jours feries beges uniquement.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        label:        { type: 'string' },
        rate_pct:     { type: 'number', description: '% de majoration (ex: 50 pour +50%)' },
        time_from:    { type: 'string', description: 'HH:MM (ex: "22:00")' },
        time_to:      { type: 'string', description: 'HH:MM (ex: "06:00"). Si time_to < time_from -> traverse minuit' },
        days:         { type: 'array', items: { type: 'number', minimum: 0, maximum: 6 } },
        holiday_only: { type: 'boolean' },
        priority:     { type: 'number', default: 100 },
        active:       { type: 'boolean', default: true },
      },
      required: ['label', 'rate_pct'],
    },
    async execute(args) {
      const { data, error } = await sb().from('surcharges').insert({
        label:        args.label,
        rate_pct:     args.rate_pct,
        time_from:    args.time_from || null,
        time_to:      args.time_to || null,
        days:         args.days || null,
        holiday_only: Boolean(args.holiday_only),
        priority:     args.priority ?? 100,
        active:       args.active !== false,
      }).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, surcharge: data }
    },
  },
  {
    name:        'update_surcharge',
    description: 'Modifie une surcharge.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        id:           { type: 'string' },
        label:        { type: 'string' },
        rate_pct:     { type: 'number' },
        time_from:    { type: 'string' },
        time_to:      { type: 'string' },
        days:         { type: 'array', items: { type: 'number' } },
        holiday_only: { type: 'boolean' },
        priority:     { type: 'number' },
        active:       { type: 'boolean' },
      },
      required: ['id'],
    },
    async execute(args) {
      const { id, ...rest } = args
      const { data, error } = await sb().from('surcharges').update(rest).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, surcharge: data }
    },
  },
  {
    name:        'delete_surcharge',
    description: 'Supprime une surcharge.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    async execute(args) {
      const { error } = await sb().from('surcharges').delete().eq('id', args.id)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────

const userTools: ToolDef[] = [
  {
    name:        'list_users',
    description: 'Liste tous les utilisateurs avec leur role.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        with_modules: { type: 'boolean', description: 'Inclure les modules autorises de chaque user' },
      },
    },
    async execute(args) {
      const { data, error } = await sb().from('users')
        .select('id, name, email, role, is_driver, is_dispatcher, active')
        .order('name')
      if (error) throw new Error(error.message)
      let users: any[] = data || []
      if (args.with_modules) {
        const { data: ums } = await sb().from('user_modules').select('user_id, module_id, granted')
        const byUser: Record<string, string[]> = {}
        for (const u of ums || []) {
          if (u.granted) (byUser[u.user_id] ??= []).push(u.module_id)
        }
        users = users.map(u => ({ ...u, modules: byUser[u.id] || [] }))
      }
      return { count: users.length, users }
    },
  },
  {
    name:        'update_user',
    description: 'Modifie un utilisateur : role (driver, dispatcher, admin, superadmin), is_driver, is_dispatcher, active, name.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        id:            { type: 'string' },
        name:          { type: 'string' },
        role:          { type: 'string', enum: ['driver', 'dispatcher', 'admin', 'superadmin'] },
        is_driver:     { type: 'boolean' },
        is_dispatcher: { type: 'boolean' },
        active:        { type: 'boolean' },
      },
      required: ['id'],
    },
    async execute(args) {
      const { id, ...rest } = args
      const { data, error } = await sb().from('users').update(rest).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, user: data }
    },
  },
  {
    name:        'set_user_module',
    description: 'Active ou desactive un module pour un utilisateur. Module ids courants : missions, driver_missions, tgr, admin, facturation, encaissement, fourriere, check_vehicle, stats, etc.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        user_id:   { type: 'string' },
        module_id: { type: 'string' },
        granted:   { type: 'boolean' },
      },
      required: ['user_id', 'module_id', 'granted'],
    },
    async execute(args) {
      const { error } = await sb().from('user_modules').upsert({
        user_id:   args.user_id,
        module_id: args.module_id,
        granted:   args.granted,
      }, { onConflict: 'user_id,module_id' })
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
  {
    name:        'list_modules',
    description: 'Liste tous les modules definis dans le systeme (avec leur ordre dans la nav).',
    destructive: false,
    input_schema: { type: 'object', properties: {} },
    async execute() {
      const { data, error } = await sb().from('modules').select('id, label, description, nav_order').order('nav_order')
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, modules: data || [] }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// CHAUFFEURS et DEPOTS
// ─────────────────────────────────────────────────────────────────────

const fleetTools: ToolDef[] = [
  {
    name:        'list_drivers',
    description: 'Liste les chauffeurs (users avec is_driver=true).',
    destructive: false,
    input_schema: { type: 'object', properties: {} },
    async execute() {
      const { data, error } = await sb().from('users')
        .select('id, name, email, role, active, is_driver, is_dispatcher')
        .eq('is_driver', true).eq('active', true).order('name')
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, drivers: data || [] }
    },
  },
  {
    name:        'list_depots',
    description: 'Liste les depots (points de depart des chauffeurs).',
    destructive: false,
    input_schema: { type: 'object', properties: {} },
    async execute() {
      const { data, error } = await sb().from('depots').select('*').order('name')
      if (error) throw new Error(error.message)
      return { count: data?.length || 0, depots: data || [] }
    },
  },
  {
    name:        'create_depot',
    description: 'Cree un nouveau depot (point de depart).',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        name:       { type: 'string' },
        address:    { type: 'string' },
        lat:        { type: 'number' },
        lng:        { type: 'number' },
        is_default: { type: 'boolean', default: false },
      },
      required: ['name'],
    },
    async execute(args) {
      const { data, error } = await sb().from('depots').insert({
        name:       args.name,
        address:    args.address || null,
        lat:        args.lat ?? null,
        lng:        args.lng ?? null,
        is_default: Boolean(args.is_default),
        active:     true,
      }).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, depot: data }
    },
  },
  {
    name:        'update_depot',
    description: 'Modifie un depot existant.',
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        id:         { type: 'string' },
        name:       { type: 'string' },
        address:    { type: 'string' },
        lat:        { type: 'number' },
        lng:        { type: 'number' },
        is_default: { type: 'boolean' },
        active:     { type: 'boolean' },
      },
      required: ['id'],
    },
    async execute(args) {
      const { id, ...rest } = args
      const { data, error } = await sb().from('depots').update(rest).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return { ok: true, depot: data }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// MEMOIRE (long-terme pour l user, partage entre conversations)
// ─────────────────────────────────────────────────────────────────────

const memoryTools: ToolDef[] = [
  {
    name:        'read_memory',
    description: 'Lit la memoire long-terme de l utilisateur (cles persistantes entre conversations).',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Cle specifique a lire (vide = toutes)' },
      },
    },
    async execute(args, ctx) {
      let q = sb().from('assistant_memory').select('key, value, updated_at').eq('user_id', ctx.userId)
      if (args.key) q = q.eq('key', args.key)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return { entries: data || [] }
    },
  },
  {
    name:        'write_memory',
    description: 'Sauvegarde un fait/preference dans la memoire long-terme de l utilisateur. A utiliser quand l user dit "souviens-toi que" ou quand tu apprends un fait persistant.',
    destructive: false,
    input_schema: {
      type: 'object',
      properties: {
        key:   { type: 'string', description: 'Cle (ex: "preferences_ui", "contexte_projet")' },
        value: { type: 'string', description: 'Valeur (texte libre)' },
      },
      required: ['key', 'value'],
    },
    async execute(args, ctx) {
      const { error } = await sb().from('assistant_memory').upsert({
        user_id:    ctx.userId,
        key:        args.key,
        value:      args.value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,key' })
      if (error) throw new Error(error.message)
      return { ok: true }
    },
  },
]

// ─────────────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────────────

export const ALL_TOOLS: ToolDef[] = [
  ...tariffTools,
  ...sourceTools,
  ...ruleTools,
  ...missionTools,
  ...surchargeTools,
  ...userTools,
  ...fleetTools,
  ...memoryTools,
]

export const TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(
  ALL_TOOLS.map(t => [t.name, t]),
)

/** Format Claude API : list de definitions tools pour le request body.
 *  Prompt caching : on pose `cache_control` sur le DERNIER outil → toute la liste
 *  (~9k tokens, identique à CHAQUE appel + chaque itération de la boucle tool-use)
 *  est mise en cache et relue à 10 % du tarif au lieu du plein tarif. Aucun
 *  changement de comportement, juste moins cher. Olivier 2026-08-09. */
export function toolsForClaude(): any[] {
  const tools: any[] = ALL_TOOLS.map(t => ({
    name:         t.name,
    description:  t.description,
    input_schema: t.input_schema,
  }))
  if (tools.length) tools[tools.length - 1].cache_control = { type: 'ephemeral' }
  return tools
}
