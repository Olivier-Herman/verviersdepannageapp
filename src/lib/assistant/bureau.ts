// src/lib/assistant/bureau.ts
//
// ASSISTANT BUREAU — l'agent de Jona (Olivier 14/10/2026).
// But : COMPRENDRE un dossier VD Soft et le CORRIGER, jamais créer de facturation :
// « il a pour but d'adapter un dossier vd soft ou de comprendre un dossier. Pas de créer
// de la facturation. Il corrige et ensuite jona peut facturer via son process lui ».
// Déroulé : l'agent lit (fiche, dossier, mails), résume ce qu'il a compris et ce qu'il va
// faire ; il DÉPOSE une action (proposer_action) ; la personne la confirme ou l'annule
// dans la conversation ; VD Soft l'exécute avec SON compte (lib exécutée = celle des
// boutons du dossier). Tout est gardé : conversations, actions, résultats.

import { createAdminClient } from '@/lib/supabase'
import type { ToolDef, ToolContext } from './tools'

const sb = () => createAdminClient()
const r2 = (n: number) => Math.round(n * 100) / 100

// ─────────────────────────────────────────────────────────────────────
// Accès : superadmin, ou personne listée dans le réglage « assistant_bureau_users ».
// ─────────────────────────────────────────────────────────────────────
export async function canUseBureau(user: { email?: string | null; role?: string | null; roles?: string[] | null }): Promise<boolean> {
  const roles = [user.role, ...(user.roles || [])].filter(Boolean) as string[]
  if (roles.includes('superadmin')) return true
  try {
    const { getBusinessList } = await import('@/lib/settings/business')
    const list = (await getBusinessList('assistant_bureau_users')).map(x => String(x).trim().toLowerCase())
    return !!user.email && list.includes(String(user.email).toLowerCase())
  } catch { return false }
}

// ─────────────────────────────────────────────────────────────────────
// Lectures
// ─────────────────────────────────────────────────────────────────────

/** Trouve une fiche par numéro (10xxxxxx), plaque ou n° de dossier assistance. */
async function findMission(ref: string): Promise<any | null> {
  const v = String(ref || '').trim()
  if (!v) return null
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) {
    const { data } = await sb().from('incoming_missions').select('id, mission_number, parent_mission_id').eq('id', v).maybeSingle()
    return data
  }
  if (/^\d{7,9}$/.test(v)) {
    const { data } = await sb().from('incoming_missions').select('id, mission_number, parent_mission_id').eq('mission_number', Number(v)).maybeSingle()
    if (data) return data
  }
  const plate = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const { data } = await sb().from('incoming_missions').select('id, mission_number, parent_mission_id')
    .or(`vehicle_plate.ilike.%${plate}%,dossier_number.ilike.%${v}%,external_id.ilike.%${v}%`)
    .eq('dossier_leg', false).order('received_at', { ascending: false }).limit(1)
  return data?.[0] || null
}

async function dossierSummary(ref: string) {
  const m = await findMission(ref)
  if (!m) throw new Error(`Aucune fiche trouvée pour « ${ref} ».`)
  const { buildDossier } = await import('@/lib/dossier/build')
  const d = await buildDossier(m.id, {})
  if (!d) throw new Error('Dossier introuvable.')
  return {
    dossier_id: d.root_id, ref: d.ref, dossier_assistance: d.dossier_number, source: d.source_label, recu_le: d.received_at,
    vehicule: d.vehicle, client: d.client, client_facture: d.billed_to.name,
    en_cours: d.state.open ? (d.state.reason || 'oui') : 'non', annule: !!d.cancelled,
    totaux_htva: { estime: d.totals.estimated, facture: d.totals.billed, reste: d.totals.remaining }, encaisse_sur_place_tvac: d.totals.collected,
    groupes: d.legs.map(l => ({
      lettre: l.letter, mission_id: l.mission_id, numero: l.mission_number, type: l.kind, titre: l.title, detail: l.subtitle,
      chauffeur: l.driver_name, statut: l.status_label, ouvert: l.open, montant_htva: l.amount_htva, calcul: l.amount_note,
      montant_inconnu: !!l.amount_unknown, rien_a_facturer: l.nothing_to_bill, facture_par: l.billed_refs, client: l.billed_to_name,
      circuit: l.channel || 'facture client', regime: l.regime, alertes: l.alerts || [], faits: l.facts,
    })),
    factures: d.invoices.map(i => ({ numero: i.number, client: i.client, montant_htva: i.amount, date: i.at, groupes: i.covers, payee_le: i.paid_at })),
    parquet: d.parquet ? { etats_de_frais: d.parquet.efs.map(e => ({ numero: e.numero, du: e.from, au: e.to, total_htva: e.total_htva, statut: e.status })), facture_au_parquet_jusqu_au: d.parquet.billed_to_date } : null,
    domaine: d.stamps.domaine, dernier_parc: d.last_parc,
    historique_recent: d.events.slice(-25),
  }
}

const MISSION_COLS = 'id, mission_number, dossier_number, external_id, source, status, mission_type, incident_type, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, client_name, client_phone, client_address, billed_to_id, billed_to_name, incident_address, destination_name, destination_address, redelivery_address, received_at, completed_at, parked_at, parc_exit_at, invoice_number, no_charge_reason, remarks_general, remarks_billing, closing_notes, parent_mission_id, levee_saisie_date, requisitoire_at, domaine_remise_date'

// ─────────────────────────────────────────────────────────────────────
// Actions : ce que l'agent peut PROPOSER (rien ne s'exécute sans confirmation)
// ─────────────────────────────────────────────────────────────────────

/** Champs qu'une correction de fiche peut toucher. Statut, montants, facturation : jamais. */
const EDITABLE: Record<string, string> = {
  source: 'source', mission_type: 'type de mission', incident_type: 'type d’incident',
  client_name: 'nom du client', client_phone: 'téléphone du client', client_address: 'adresse du client',
  vehicle_plate: 'plaque', vehicle_brand: 'marque', vehicle_model: 'modèle', vehicle_vin: 'châssis',
  incident_address: 'lieu de prise en charge', destination_name: 'nom de la destination', destination_address: 'adresse de livraison',
  redelivery_address: 'adresse de relivraison', dossier_number: 'n° de dossier assistance',
  billed_to_id: 'client facturé (identifiant)', billed_to_name: 'client facturé',
}
export const ACTION_KINDS = ['modifier_fiche', 'ajouter_remarque', 'sans_frais', 'deja_facture', 'levee_saisie'] as const
export type ActionKind = typeof ACTION_KINDS[number]
export const ACTION_LABEL: Record<ActionKind, string> = {
  modifier_fiche: 'Corriger la fiche', ajouter_remarque: 'Ajouter une remarque', sans_frais: 'Ne rien facturer (sans frais)',
  deja_facture: 'Marquer déjà facturé', levee_saisie: 'Enregistrer la levée de saisie',
}

/** Contrôle et prépare une action ; renvoie le résumé « avant → après » et ce qui sera exécuté. */
async function prepareAction(args: any): Promise<{ kind: ActionKind; mission_id: string | null; payload: any; avant: any; apres: any }> {
  const kind = String(args.type || '') as ActionKind
  if (!ACTION_KINDS.includes(kind)) throw new Error(`type inconnu. Types possibles : ${ACTION_KINDS.join(', ')}. Facturer, créer un brouillon, une note de crédit ou un état de frais : jamais, c'est Jona qui le fait.`)

  if (kind === 'modifier_fiche') {
    const champs = args.champs && typeof args.champs === 'object' ? args.champs : {}
    const keys = Object.keys(champs)
    if (!keys.length) throw new Error('champs obligatoires : { champ: nouvelle valeur }.')
    const bad = keys.filter(k => !(k in EDITABLE))
    if (bad.length) throw new Error(`Champs non modifiables par l'assistant : ${bad.join(', ')}. Modifiables : ${Object.keys(EDITABLE).join(', ')}.`)
    if (('billed_to_id' in champs) !== ('billed_to_name' in champs)) throw new Error('Client facturé : donner billed_to_id ET billed_to_name ensemble.')
    if ('source' in champs) {
      const { data: src } = await sb().from('mission_source_catalog').select('key').eq('key', String(champs.source)).maybeSingle()
      if (!src) throw new Error(`Source inconnue : ${champs.source}.`)
    }
    const { data: m }: { data: any } = await sb().from("incoming_missions").select(`id, mission_number, ${keys.join(", ")}`).eq("id", String(args.mission_id || "")).maybeSingle()
    if (!m) throw new Error('mission_id inconnu.')
    const avant: Record<string, any> = {}, apres: Record<string, any> = {}
    for (const k of keys) { avant[k] = (m as any)[k] ?? null; apres[k] = champs[k] === '' ? null : champs[k] }
    return { kind, mission_id: m.id, payload: { champs: apres, avant }, avant, apres }
  }

  if (kind === 'ajouter_remarque') {
    const texte = String(args.texte || '').trim()
    if (!texte) throw new Error('texte obligatoire.')
    const { data: m } = await sb().from('incoming_missions').select('id').eq('id', String(args.mission_id || '')).maybeSingle()
    if (!m) throw new Error('mission_id inconnu.')
    return { kind, mission_id: m.id, payload: { texte }, avant: null, apres: { remarque: texte } }
  }

  if (kind === 'sans_frais' || kind === 'deja_facture') {
    const { buildDossier } = await import('@/lib/dossier/build')
    const d = await buildDossier(String(args.dossier_id || ''), {})
    if (!d) throw new Error('dossier_id inconnu (prendre dossier_id de lire_dossier).')
    const ids: string[] = Array.isArray(args.mission_ids) ? args.mission_ids.map(String) : []
    const legs = d.legs.filter(l => ids.includes(l.mission_id) && l.kind !== 'out')
    if (!legs.length) throw new Error('mission_ids : groupes du dossier à viser (champ mission_id des groupes de lire_dossier).')
    const motif = String(args.motif || '').trim(), numero = String(args.numero || '').trim()
    if (kind === 'sans_frais' && !motif) throw new Error('motif obligatoire.')
    if (kind === 'deja_facture') {
      if (!numero) throw new Error('numero de facture obligatoire.')
      const { resolveInvoiceByNumber } = await import('@/lib/odoo-invoice')
      if (!(await resolveInvoiceByNumber(numero).catch(() => null))) throw new Error(`Facture ${numero} introuvable : on ne marque « déjà facturé » qu'avec une facture qui existe.`)
    }
    const avant = legs.map(l => ({ groupe: l.letter, titre: l.title, statut: l.status_label, montant_htva: l.amount_htva }))
    const total = r2(legs.reduce((s, l) => s + (l.amount_htva || 0), 0))
    return {
      kind, mission_id: d.root_id, payload: { dossier_id: d.root_id, mission_ids: legs.map(l => l.mission_id), motif, numero },
      avant: { groupes: avant, total_htva: total },
      apres: kind === 'sans_frais' ? { groupes: legs.map(l => l.letter), etat: `sans frais — ${motif}`, plus_a_facturer_htva: total } : { groupes: legs.map(l => l.letter), etat: `facturé sur ${numero}` },
    }
  }

  // levee_saisie
  const type = String(args.levee_type || '')
  const date = String(args.date || '')
  const payeur = String(args.payeur || '')
  const note = String(args.note || '').trim()
  if (!['definitive', 'temporaire'].includes(type)) throw new Error('levee_type : definitive ou temporaire.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date AAAA-MM-JJ obligatoire.')
  if (!note) throw new Error('note obligatoire (d’où vient l’information de levée).')
  const { data: m } = await sb().from('incoming_missions').select('id, source, levee_saisie_date').eq('id', String(args.mission_id || '')).maybeSingle()
  if (!m) throw new Error('mission_id inconnu.')
  if (m.source !== 'police_saisie') throw new Error('Une levée ne se pose que sur une saisie (source police_saisie).')
  if (type === 'definitive' && !['frais_justice', 'client'].includes(payeur)) throw new Error('payeur : frais_justice ou client (qui paie après la levée).')
  return { kind, mission_id: m.id, payload: { type, date, payeur, note }, avant: { levee: m.levee_saisie_date || 'aucune' }, apres: { levee: `${type} du ${date}`, payeur: payeur || null, note } }
}

/** Exécute une action confirmée, avec le compte de la personne. Relit l'état avant d'écrire. */
export async function executeAction(action: { kind: ActionKind; mission_id: string | null; payload: any }, user: { id: string; name: string }): Promise<Record<string, any>> {
  const p = action.payload || {}
  const now = new Date().toISOString()
  if (action.kind === 'modifier_fiche') {
    const keys = Object.keys(p.champs || {})
    const { data: cur } = await sb().from('incoming_missions').select(keys.join(', ')).eq('id', action.mission_id!).maybeSingle()
    if (!cur) throw new Error('Fiche introuvable.')
    const changed = keys.filter(k => JSON.stringify((cur as any)[k] ?? null) !== JSON.stringify(p.avant?.[k] ?? null))
    if (changed.length) throw new Error(`La fiche a changé depuis la proposition (${changed.join(', ')}) : rien n'est modifié, redemande à l'assistant.`)
    const { error } = await sb().from('incoming_missions').update({ ...p.champs, updated_at: now }).eq('id', action.mission_id!)
    if (error) throw new Error(error.message)
    await sb().from('mission_logs').insert({
      mission_id: action.mission_id, actor_id: user.id, action: 'assistant_correction',
      notes: `${user.name} via l'assistant bureau : ${keys.map(k => `${EDITABLE[k] || k} « ${p.avant?.[k] ?? '—'} » → « ${p.champs[k] ?? '—'} »`).join(' ; ')}`,
      metadata: { avant: p.avant, apres: p.champs },
    })
    const { invalidateDossierCache } = await import('@/lib/dossier/build'); invalidateDossierCache()
    return { ok: true, modifie: keys }
  }
  if (action.kind === 'ajouter_remarque') {
    const { data, error } = await sb().from('mission_remarks').insert({ mission_id: action.mission_id, text: p.texte, created_by: user.id }).select('id').single()
    if (error) throw new Error(error.message)
    return { ok: true, remarque_id: data.id }
  }
  if (action.kind === 'sans_frais' || action.kind === 'deja_facture') {
    const { markDossierLegs } = await import('@/lib/dossier/mark')
    const r = await markDossierLegs(p.dossier_id, { action: action.kind === 'sans_frais' ? 'no_charge' : 'already_billed', ids: p.mission_ids, reason: p.motif, number: p.numero }, { id: user.id })
    return { ok: true, groupes: r.covers }
  }
  // levee_saisie : même route que le bouton, rejouée avec le compte de la personne.
  const base = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  const fd = new FormData()
  fd.set('type', p.type); fd.set('date', p.date); fd.set('note', `${p.note} (via l'assistant bureau)`); if (p.payeur) fd.set('payer', p.payeur)
  const res = await fetch(`${base}/api/missions/${action.mission_id}/levee-saisie`, { method: 'POST', body: fd, headers: { 'x-internal-secret': process.env.NEXTAUTH_SECRET || '', 'x-internal-actor': user.id }, cache: 'no-store' })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `Levée refusée (HTTP ${res.status})`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────
// Outils de l'agent
// ─────────────────────────────────────────────────────────────────────
export const BUREAU_TOOLS: ToolDef[] = [
  {
    name: 'chercher_fiches', destructive: false,
    description: `Retrouve des fiches à partir de ce qu'on sait, même sans plaque ni numéro. Tous les critères sont optionnels et se combinent :
texte (plaque, n° de fiche, n° de dossier assistance, nom du client), marque, modele, du / au (dates AAAA-MM-JJ : jour de réception de la mission ; un seul jour = du et au identiques), source (police_saisie = saisie, police_snc = Siabis non couvert, vab, touring, kaze, axa, mondial, prive, garage…), type (remorquage, depannage, relivraison, trajet_vide…), lieu (rue, ville, autoroute), chauffeur (prénom), statut.
Ex. « une Polo saisie le 08/02/2026 » → { modele: "polo", source: "police_saisie", du: "2026-02-08", au: "2026-02-08" }. Si rien ne sort, élargis (quelques jours autour de la date, sans la source, marque seule) et dis-le. Rends la liste avec n° de fiche, plaque, véhicule, date, lieu, source.`,
    input_schema: { type: 'object', properties: {
      texte: { type: 'string' }, marque: { type: 'string' }, modele: { type: 'string' }, du: { type: 'string' }, au: { type: 'string' },
      source: { type: 'string' }, type: { type: 'string' }, lieu: { type: 'string' }, chauffeur: { type: 'string' }, statut: { type: 'string' },
    } },
    async execute(args) {
      const v = String(args.texte || '').trim()
      let q = sb().from('incoming_missions').select('id, mission_number, dossier_number, external_id, source, status, mission_type, vehicle_plate, vehicle_brand, vehicle_model, client_name, billed_to_name, incident_address, destination_address, received_at, assigned_to, parent_mission_id')
        .eq('dossier_leg', false).order('received_at', { ascending: false }).limit(30)
      if (v) {
        if (/^\d{7,9}$/.test(v)) q = q.eq('mission_number', Number(v))
        else { const s = `%${v}%`, plate = `%${v.replace(/[^A-Za-z0-9]/g, '')}%`; q = q.or(`vehicle_plate.ilike.${plate},dossier_number.ilike.${s},external_id.ilike.${s},client_name.ilike.${s}`) }
      }
      const like = (x: unknown) => `%${String(x).trim().replace(/[%,()]/g, ' ')}%`
      if (args.marque) q = q.ilike('vehicle_brand', like(args.marque))
      if (args.modele) q = q.ilike('vehicle_model', like(args.modele))
      if (args.lieu) q = q.ilike('incident_address', like(args.lieu))
      if (args.source) q = q.eq('source', String(args.source))
      if (args.type) q = q.ilike('mission_type', like(args.type))
      if (args.statut) q = q.eq('status', String(args.statut))
      // Dates en heure de Bruxelles : le jour entier, de 00:00 à 23:59 locales.
      const day = (d: string, end: boolean) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
        // Décalage de Bruxelles ce jour-là (hiver +1 h, été +2 h).
        const noon = new Date(`${d}T12:00:00Z`)
        const off = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(noon)) - 12
        return new Date(`${d}T${end ? '23:59:59' : '00:00:00'}+0${off}:00`).toISOString()
      }
      const du = args.du ? day(String(args.du), false) : null, au = args.au ? day(String(args.au), true) : (args.du ? day(String(args.du), true) : null)
      // Date de réception OU date d'intervention (fiches reprises de l'ancien logiciel).
      if (du || au) {
        const rng = (c: string) => [du && `${c}.gte.${du}`, au && `${c}.lte.${au}`].filter(Boolean).join(',')
        q = q.or(`and(${rng('received_at')}),and(${rng('intervention_date')})`)
      }
      if (args.chauffeur) {
        const { data: us } = await sb().from('users').select('id').ilike('name', like(args.chauffeur))
        const ids = (us || []).map((u: any) => u.id)
        if (!ids.length) return { fiches: [], note: `Aucun chauffeur « ${args.chauffeur} ».` }
        q = q.in('assigned_to', ids)
      }
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const { data: us } = await sb().from('users').select('id, name')
      const nm = Object.fromEntries((us || []).map((u: any) => [u.id, u.name]))
      return { nombre: data?.length || 0, fiches: (data || []).map((m: any) => ({ ...m, chauffeur: nm[m.assigned_to] || null, assigned_to: undefined })) }
    },
  },
  {
    name: 'lire_fiche', destructive: false,
    description: 'Lit une fiche (numéro, plaque ou id) : identité, adresses, client facturé, statut, remarques, levée, Domaine.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
    async execute(args) {
      const m = await findMission(args.ref)
      if (!m) throw new Error(`Aucune fiche pour « ${args.ref} ».`)
      const { data } = await sb().from('incoming_missions').select(MISSION_COLS).eq('id', m.id).maybeSingle()
      const { data: rq } = await sb().from('mission_remarks').select('text, created_at').eq('mission_id', m.id).order('created_at', { ascending: false }).limit(15)
      return { fiche: data, remarques: rq || [] }
    },
  },
  {
    name: 'lire_dossier', destructive: false,
    description: 'Lit le DOSSIER complet d’une fiche (numéro, plaque ou id) : groupes (prise en charge, gardiennage, relivraison, sortie), montant de chaque groupe ET son calcul ou la raison s’il est inconnu, statut, circuit (facture client, état de frais Parquet, Domaine), factures, états de frais, historique. C’est LA lecture pour expliquer un dossier.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
    async execute(args) { return dossierSummary(args.ref) },
  },
  {
    name: 'chercher_mails', destructive: false,
    description: 'Cherche dans les boîtes Info, Fourrière et Administration (plaque, n° de dossier, nom…). Renvoie objet, expéditeur, date, aperçu et l’identifiant pour lire_mail.',
    input_schema: { type: 'object', properties: { texte: { type: 'string' } }, required: ['texte'] },
    async execute(args) {
      const { searchAllMailboxes } = await import('@/lib/graph-mail-search')
      const hits = await searchAllMailboxes(String(args.texte || ''), 8)
      return { mails: hits.map(h => ({ boite: h.mailboxLabel, id: h.id, objet: h.subject, de: h.from, recu: h.receivedAt, apercu: h.bodyPreview })) }
    },
  },
  {
    name: 'lire_mail', destructive: false,
    description: 'Lit le texte complet d’un mail trouvé par chercher_mails (boite = Info, Fourrière ou Administration).',
    input_schema: { type: 'object', properties: { boite: { type: 'string' }, id: { type: 'string' } }, required: ['boite', 'id'] },
    async execute(args) {
      const { SEARCH_MAILBOXES, fetchMailFull } = await import('@/lib/graph-mail-search')
      const mb = SEARCH_MAILBOXES.find(b => b.label.toLowerCase() === String(args.boite || '').toLowerCase())
      if (!mb) throw new Error('boite : Info, Fourrière ou Administration.')
      const m: any = await fetchMailFull({ mailbox: mb.email, messageId: String(args.id) })
      if (!m) throw new Error('Mail introuvable.')
      const text = String(m.bodyText || m.body || m.bodyHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000)
      return { objet: m.subject, de: m.from, recu: m.receivedAt || m.receivedDateTime, texte: text, pieces_jointes: (m.attachments || []).map((a: any) => a.name) }
    },
  },
  {
    name: 'proposer_action', destructive: false,
    description: `Dépose une action à faire CONFIRMER par la personne (rien n'est exécuté ici). À appeler APRÈS avoir lu le dossier et résumé ce que tu as compris. La conversation affiche un encadré « Confirmer / Annuler » ; VD Soft exécute à la confirmation, avec le compte de la personne.
Types :
- modifier_fiche : { mission_id, champs: { champ: valeur } } — champs : ${Object.keys(EDITABLE).join(', ')}.
- ajouter_remarque : { mission_id, texte }.
- sans_frais : { dossier_id, mission_ids: [groupes], motif } — « Ne rien facturer » sur ces groupes.
- deja_facture : { dossier_id, mission_ids, numero } — la facture DOIT exister.
- levee_saisie : { mission_id, levee_type: definitive|temporaire, date: AAAA-MM-JJ, payeur: frais_justice|client (définitive), note }.
Interdit : créer une facture, un brouillon, une note de crédit, un état de frais ; changer un statut ; supprimer.`,
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...ACTION_KINDS] },
        resume: { type: 'string', description: 'Une ou deux phrases : ce que tu as compris et ce que l’action va changer, effet sur le montant compris.' },
        mission_id: { type: 'string' }, dossier_id: { type: 'string' }, mission_ids: { type: 'array', items: { type: 'string' } },
        champs: { type: 'object' }, texte: { type: 'string' }, motif: { type: 'string' }, numero: { type: 'string' },
        levee_type: { type: 'string' }, date: { type: 'string' }, payeur: { type: 'string' }, note: { type: 'string' },
      },
      required: ['type', 'resume'],
    },
    async execute(args, ctx) {
      const resume = String(args.resume || '').trim()
      if (!resume) throw new Error('resume obligatoire.')
      const prep = await prepareAction(args)
      const { data, error } = await sb().from('assistant_actions').insert({
        conversation_id: ctx.conversationId, user_id: ctx.userId, kind: prep.kind, mission_id: prep.mission_id, resume,
        payload: { ...prep.payload, avant: prep.avant, apres: prep.apres },
      }).select('id').single()
      if (error) throw new Error(error.message)
      return { action_id: data.id, type: ACTION_LABEL[prep.kind], resume, avant: prep.avant, apres: prep.apres, etat: 'en attente de confirmation' }
    },
  },
  {
    name: 'signaler_doute', destructive: false,
    description: 'Prévient Mobi (Olivier) en privé quand tu n’es pas sûr d’une règle, qu’une consigne contredit une règle, ou qu’une action dépasse tes droits. Donne la fiche et la question.',
    input_schema: { type: 'object', properties: { question: { type: 'string' }, fiche: { type: 'string' } }, required: ['question'] },
    async execute(args, ctx) {
      const { getBusinessNumber } = await import('@/lib/settings/business')
      const { tgSend } = await import('@/lib/sam/telegram')
      const chat = await getBusinessNumber('telegram_chat_mobi')
      await tgSend(chat, `🧭 Max, assistant bureau de ${ctx.userName}${args.fiche ? ` · ${args.fiche}` : ''}\n${String(args.question).slice(0, 1500)}`)
      return { ok: true, note: 'Mobi est prévenu.' }
    },
  },
]

export const BUREAU_TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(BUREAU_TOOLS.map(t => [t.name, t]))

export function bureauToolsForClaude(): any[] {
  const tools: any[] = BUREAU_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  tools[tools.length - 1].cache_control = { type: 'ephemeral' }
  return tools
}

// ─────────────────────────────────────────────────────────────────────
// Savoir : règles métier d'Olivier utiles à la lecture et à la correction des dossiers.
// ─────────────────────────────────────────────────────────────────────
export function bureauSystemPrompt(ctx: ToolContext, memory: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const prenom = ctx.userName.split(' ')[0]
  return `Tu es Max, l'assistant bureau de ${prenom} chez Verviers Dépannage (agent dédié à ${prenom}, prénom choisi par Mobi le 14/10/2026 ; tu te présentes comme Max), dans VD Soft (app interne : dépannage, remorquage, fourrière, facturation). Date : ${today}.

## Ton rôle
1. EXPLIQUER un dossier : pourquoi il est « à facturer », d'où vient un montant, pourquoi un montant est inconnu, à qui il se facture, ce qui bloque.
2. CORRIGER un dossier sur demande de ${prenom}, par proposer_action, après confirmation.
Tu ne crées JAMAIS de facturation : pas de facture, de brouillon, de note de crédit, d'état de frais, d'envoi de mail. Une fois le dossier corrigé, ${prenom} facture lui-même avec son process habituel.

## Méthode (toujours)
- Va chercher la donnée avant de répondre : lire_dossier (c'est la lecture principale), lire_fiche, chercher_mails / lire_mail. Ne réponds jamais « regarde dans l'app » ou « demande au dispatch » si tu peux le lire toi-même.
- Pour toute modification : 1) résume ce que tu as compris de la demande et du dossier ; 2) dis précisément ce que tu vas changer (avant → après) et l'effet sur le montant ; 3) appelle proposer_action. ${prenom} confirme ou corrige dans l'encadré. S'il corrige, refais une proposition.
- N'appelle pas proposer_action pour une simple question.
- Si la demande contredit une règle ci-dessous, ou si tu n'es pas sûr : dis-le, n'exécute pas, et appelle signaler_doute.
- Réponses courtes, en français, tutoiement. Montants en € HTVA sauf mention. Cite les numéros de fiche (#10…) et les plaques.

## Règles métier (Mobi / Olivier)
Dossier et montants
- Un dossier = la fiche principale + ses groupes : A prise en charge (remorquage, dépannage, trajet vide), B gardiennage, C relivraison, D sortie. Le montant de chaque groupe et son calcul sont dans lire_dossier ; « à calculer » ou « montant inconnu » : lis la raison donnée (adresse non géocodée, type de mission manquant, tarif introuvable…) et corrige la cause, pas le montant.
- Les tarifs en base sont HTVA ; le chauffeur voit le TVAC. Un prix encaissé par le chauffeur est figé.
- Encaisser n'est pas clôturer. Le bureau encaisse dans le logiciel de facturation ; VD Soft n'encaisse que via le chauffeur.
- Une facture émise ne se corrige pas sans rejet du client (note de crédit + refacturation : décision de Mobi, pas la tienne).
Gardiennage et fourrière
- Gardiennage = nuits passées (jamais le jour d'entrée). Il s'arrête dès que l'adresse réelle de relivraison est connue.
- Saisie police (source police_saisie) : gardiennage au régime saisie (1,56 €/nuit) → état de frais au Parquet, jamais au propriétaire. Après une LEVÉE de saisie : la période suivante est au régime « autre » (20 €/nuit), à charge de celui qui récupère (ou frais de justice selon la levée).
- Saisie remise au Domaine sans levée : pas de gardiennage « autre » ; état de frais jusqu'à la remise, puis relevé Domaine.
- Un AVP ne part jamais en état de frais au Parquet. Pas de relance automatique au Parquet. Un réquisitoire est un PDF ou une photo, jamais une page web.
- Un client peut payer sans avoir l'autorisation de sortie : un paiement ne fait pas sortir le véhicule.
Assistances
- Le lien avec l'assistance (Touring COMEX, VAB Comet, IMA/Kaze, AXA, Allianz/Hexalite ; Mondial = Allianz) fait foi.
- Couvert ou non couvert se décide AVANT l'intervention ; pas de « tranchage » autoroute pour une assistance.
- Siabis non couvert (police_snc) : le client est la personne/le propriétaire ; si une assistance a confirmé « VÉHICULE PAS COUVERT », pas de prise en charge. Une mission acceptée chez VAB (contrat couvert) se facture à VAB même si la fiche a été passée en Siabis par erreur.
- VAB : trajet vide (annulé après acceptation dans Comet) = forfait départ ; supplément carburant 2,50 € par dossier pendant les périodes VAB (ajouté tout seul) ; les km de relivraison comptent après les km inclus du remorquage.
- Relivraison : la règle (forfait ou km) dépend de l'assistance, elle est dans la grille.
- Facture à un intermédiaire « pour le compte de » (ex. GIE ARGOS pour Groupama) : le bloc complet du client final et le n° de dossier vont dans une note sur la facture (à dire à ${prenom}, c'est lui qui facture).
Vocabulaire
- « Rappel » = relance client. DSP = dépannage = réparation sur place. Mobi = Olivier.
${memory ? '\n## Mémoire\n' + memory : ''}`
}
