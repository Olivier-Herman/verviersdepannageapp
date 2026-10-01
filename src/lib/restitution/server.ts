// src/lib/restitution/server.ts
//
// Restitution unifiée (Olivier 28/09/2026 — maquette validée :
// https://claude.ai/artifact/F14wwMHQwPtrkR5BHRW9Zd).
//
// Un seul parcours pour TOUT véhicule au parc :
//   1. qui vient le reprendre (+ pièce d'identité → client Odoo)
//   2. peut-il sortir ? (contrôles selon la source et selon qui vient)
//   3. qui paie quoi ? (saisie / rodéo repris par le client)
//   4. montant et paiement (facture Odoo ouverte dans Odoo, ou encaissement chauffeur)
//   5. signature et photos (facultatif), puis sortie du parc.
// Chaque geste laisse une ligne « restitution_* » dans mission_logs, avec son
// auteur. Une règle bloquante ne se contourne que par une dérogation validée
// par un responsable, avec son code, sur son téléphone.
//
// Règles d'Olivier (28/09/2026) :
//   - dispatch, fourrière, admins : toutes les sources ; chauffeurs : mal garées seulement ;
//   - partir sans payer : dérogation, sauf reprise par un garage ou une assistance ;
//   - véhicule bloqué (police) : seul un responsable le débloque ;
//   - saisie et rodéo : levée obligatoire (définitive, ou levée temporaire vers un garagiste) ;
//   - saisie reprise par le client : on demande qui paie le dépannage, le gardiennage
//     jusqu'à la levée et après la levée (client, Parquet, frais de justice) ;
//   - reprise par une assistance en relivraison (REL) : pas de restitution au comptoir,
//     seul le contrôle de levée (si saisi) s'applique à la sortie.

import { buildDossier, type DossierLeg } from '@/lib/dossier/build'
import { getExitControlState, isAssistanceSource } from '@/lib/missions/exit-control'
import { sourceLabel } from '@/lib/missions/source-catalog'
import { getBusinessNumber } from '@/lib/settings/business'
import { odooRpc } from '@/lib/odoo'
import { buildInvoiceMoveUrl } from '@/lib/odoo-quote'

export type WhoKind = 'owner' | 'mandate' | 'garage' | 'assistance' | 'transport'
export type Payer = 'client' | 'parquet' | 'fdj'
export type Poste = 'dep' | 'avant' | 'apres'
export type DerogKind = 'blk' | 'levee' | 'exit_control' | 'identite' | 'montant' | 'paiement'

export const WHO_LABELS: Record<WhoKind, string> = {
  owner: 'le propriétaire', mandate: 'un mandataire', garage: 'un garage', assistance: 'une assistance', transport: 'un transporteur',
}
export const DEROG_LABELS: Record<DerogKind, string> = {
  blk: 'déblocage du véhicule (blocage police)',
  levee: 'sortie sans levée de saisie',
  exit_control: 'contrôle de sortie accident incomplet',
  identite: 'pièce d’identité manquante',
  montant: 'montant modifié',
  paiement: 'départ sans paiement',
}
export const POSTE_LABELS: Record<Poste, string> = {
  dep: 'Dépannage', avant: 'Gardiennage jusqu’à la levée', apres: 'Gardiennage après la levée',
}
export const PAYER_LABELS: Record<Payer, string> = { client: 'Client', parquet: 'Parquet', fdj: 'Frais de justice' }

const r2 = (n: number) => Math.round(n * 100) / 100

export function isSaisieLike(m: { source?: string | null; saisie_motif_code?: string | null }): boolean {
  return ['police_saisie', 'police_rodeo'].includes(String(m.source || '')) || !!m.saisie_motif_code
}

export function leveeOk(m: any): { ok: boolean; temporaire: boolean; label: string } {
  const has = !!(m.police_levee_saisie_ok || m.levee_saisie_at)
  const temporaire = m.levee_saisie_type === 'temporaire'
  if (!has) return { ok: false, temporaire: false, label: 'Pas de levée de saisie au dossier.' }
  const d = m.levee_saisie_date ? new Date(m.levee_saisie_date).toLocaleDateString('fr-BE') : null
  return { ok: true, temporaire, label: `Levée ${temporaire ? 'temporaire' : 'définitive'}${d ? ` du ${d}` : ''} au dossier.` }
}

/** Accès au bouton « Restituer » : dispatch / fourrière / admins partout ; chauffeurs sur les mal garées. */
export function restitutionAccess(session: any, source: string | null | undefined): { ok: boolean; driverOnly: boolean } {
  const u = session?.user || {}
  const roles: string[] = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])].filter(Boolean)
  const modules: string[] = Array.isArray(u.modules) ? u.modules : []
  if (roles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r)) || modules.includes('fourriere')) return { ok: true, driverOnly: false }
  if (roles.some(r => ['driver', 'chauffeur'].includes(r)) && source === 'police_mg') return { ok: true, driverOnly: true }
  return { ok: false, driverOnly: false }
}

/** Reprise par une assistance en relivraison : REL d'assisteur rattachée à la fiche. */
export async function findAssistanceRel(sb: any, m: any): Promise<{ id: string | null; label: string } | null> {
  if (m.rel_kaze_job_id) return { id: null, label: `relivraison Kaze (job ${m.rel_kaze_job_id})` }
  const { data: kids } = await sb.from('incoming_missions')
    .select('id, source, mission_number, mission_type, status, dossier_leg')
    .or(`parent_mission_id.eq.${m.id},merged_into_mission_id.eq.${m.id}`)
    .eq('dossier_leg', false)
  const rel = (kids || []).find((k: any) => isAssistanceSource(k.source) && !['cancelled', 'ignored'].includes(String(k.status)))
  if (!rel) return null
  return { id: rel.id, label: `${await sourceLabel(rel.source)} · fiche ${rel.mission_number ?? ''}`.trim() }
}

export interface Check { id: string; title: string; detail: string; state: 'ok' | 'ko' | 'warn'; derog?: DerogKind; derogBy?: string | null; actions?: string[] }

const MISSION_COLS = 'id, mission_number, status, source, saisie_motif_code, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, parc_zone_key, parked_at, received_at, police_blocked, police_levee_saisie_ok, levee_saisie_at, levee_saisie_date, levee_saisie_type, levee_saisie_payer, temp_garage_out_at, temp_returned_at, snc_scenario, rel_kaze_job_id, billed_to_id, billed_to_name, client_name, client_phone, client_email, client_address, invoice_odoo_id, dossier_leg, driver_photos'

export async function loadMission(sb: any, id: string) {
  const { data } = await sb.from('incoming_missions').select(MISSION_COLS).eq('id', id).maybeSingle()
  return data
}

export async function approvedDerogations(sb: any, missionId: string, restitutionId: string | null) {
  let q = sb.from('derogation_requests').select('id, kind, reason, status, responsable_id, requested_by, created_at, decided_at, amount_tvac, restitution_id').eq('mission_id', missionId).order('created_at', { ascending: false })
  // Une dérogation vaut pour SA restitution ; seul le déblocage (blk) reste acquis.
  q = restitutionId ? q.or(`restitution_id.eq.${restitutionId},kind.eq.blk`) : q.eq('kind', 'blk')
  const { data } = await q
  return (data || []) as any[]
}

/** Contrôles « peut-il sortir ? » selon la source et qui vient. */
export async function computeChecks(sb: any, m: any, derogs: any[], names: Record<string, string>): Promise<Check[]> {
  const ok = (k: DerogKind) => derogs.find(d => d.kind === k && d.status === 'approved')
  const checks: Check[] = []

  // Blocage police : seul un responsable débloque (la dérogation « blk » lève le blocage).
  if (m.police_blocked) {
    const d = ok('blk')
    checks.push({ id: 'blk', title: 'Blocage police', state: d ? 'ok' : 'ko', derog: 'blk', derogBy: d ? names[d.responsable_id] || null : null,
      detail: d ? `Débloqué par ${names[d.responsable_id] || 'un responsable'} : ${d.reason}` : 'Véhicule bloqué par la police. Seul un responsable peut le débloquer.' })
  } else checks.push({ id: 'blk', title: 'Blocage police', state: 'ok', detail: 'Aucun blocage.' })

  // Saisie / rodéo : levée obligatoire.
  if (isSaisieLike(m)) {
    const l = leveeOk(m), d = ok('levee')
    checks.push({ id: 'levee', title: 'Levée de saisie', state: l.ok || d ? 'ok' : 'ko', derog: 'levee', derogBy: d ? names[d.responsable_id] || null : null,
      detail: l.ok ? l.label + (l.temporaire ? ' Le véhicule part chez un garagiste et revient au parc.' : '') : d ? `Sortie sans levée autorisée par ${names[d.responsable_id] || 'un responsable'} : ${d.reason}` : 'Pas de levée au dossier. Photographiez ou scannez la levée, ou demandez une levée temporaire.',
      actions: l.ok ? [] : ['levee_capture', 'levee_temporaire'] })
  }

  // Accident : contrôle de sortie (expert / Informex / identité / attestation).
  const ec = await getExitControlState(sb, m.id).catch(() => null)
  if (ec?.armed) {
    const d = ok('exit_control')
    checks.push({ id: 'exit_control', title: 'Contrôle de sortie (bureau d’expertise)', state: ec.allowed || d ? 'ok' : 'ko', derog: 'exit_control', derogBy: d ? names[d.responsable_id] || null : null,
      detail: ec.allowed ? (ec.forced ? 'Sortie autorisée par dérogation.' : 'Procédure de sortie complète.') : (ec.reason || 'Procédure de sortie incomplète.'),
      actions: ec.allowed ? [] : ['exit_control'] })
  }

  // SNC : scénario requis avant toute sortie.
  if (['police_snc', 'sia_couvert'].includes(String(m.source || '')) && !m.snc_scenario) {
    checks.push({ id: 'snc', title: 'Scénario SNC', state: 'ko', detail: 'Choisissez le scénario sur la fiche avant la sortie.', actions: ['open_fiche'] })
  }
  return checks
}

/** Volets du dossier encore à payer, classés en postes pour une saisie. */
export async function openLegs(missionId: string, m: any): Promise<{ legs: any[]; dossierRoot: string | null }> {
  const d = await buildDossier(missionId).catch(() => null)
  if (!d) return { legs: [], dossierRoot: null }
  const levee = m.levee_saisie_date ? new Date(m.levee_saisie_date).getTime() : null
  const legs = d.legs.filter((l: DossierLeg) => l.kind === 'rem' || l.kind === 'gard').map((l: DossierLeg) => {
    let poste: Poste = l.kind === 'rem' ? 'dep' : 'avant'
    if (l.kind === 'gard' && levee && l.started_at && new Date(l.started_at).getTime() > levee) poste = 'apres'
    const due = r2(Math.max(0, (l.amount_htva || 0) - (l.billed_htva || 0)))
    return {
      mission_id: l.mission_id, letter: l.letter, kind: l.kind, title: l.title, subtitle: l.subtitle,
      amount_htva: r2(l.amount_htva || 0), billed_htva: r2(l.billed_htva || 0), billed_refs: l.billed_refs,
      due_htva: l.nothing_to_bill ? 0 : due, nothing: l.nothing_to_bill, unknown: !!l.amount_unknown, amount_note: l.amount_note,
      billed_to_id: l.billed_to_id, billed_to_name: l.billed_to_name, channel: l.channel || 'odoo', poste,
    }
  })
  return { legs, dossierRoot: d.root_id }
}

/** Qui paie chaque volet, selon qui vient et la répartition choisie.
 *  assistancePartners : partenaires Odoo des assistances (catalogue des sources) —
 *  un volet déjà facturable à une assistance ne se paie pas au comptoir. */
export function defaultSplit(m: any): Record<Poste, Payer> {
  // Par défaut on suit la levée : « frais de justice » → FdJ jusqu'à la levée ; sinon le client.
  const before: Payer = m?.levee_saisie_payer === 'frais_justice' ? 'fdj' : 'client'
  return { dep: before, avant: before, apres: 'client' }
}

export function payerFor(leg: any, who: WhoKind | null, saisie: boolean, split: Partial<Record<Poste, Payer>> | null, assistancePartners: Set<number>, m?: any): Payer | 'other' {
  if (saisie && (who === 'owner' || who === 'mandate')) return (split && split[leg.poste as Poste]) || defaultSplit(m)[leg.poste as Poste]
  if (leg.channel === 'parquet') return saisie ? 'parquet' : 'other'
  if (leg.billed_to_id && assistancePartners.has(Number(leg.billed_to_id))) return 'other'
  return 'client'
}

/** Payeur d'un groupe à la restitution (Olivier 29/09/2026) : par défaut le client
 *  de la fiche, modifiable groupe par groupe (client présent ou un autre client).
 *  - client : le client présent, payé au comptoir ;
 *  - third  : facturé ici à un autre client (brouillon, paiement à terme) ;
 *  - other  : assistance du dossier, facturée par son circuit habituel ;
 *  - parquet / fdj : saisie. */
export type LegPayerChoice = { kind: 'present' | 'fiche' | 'third' | 'parquet' | 'fdj'; partner_id?: number; name?: string }
export type PayerCtx = { assist: Set<number>; notFiche: Set<number>; presentId: number | null; overrides: Record<string, LegPayerChoice> | null }
export type ResolvedPayer = { payer: Payer | 'other' | 'third'; partner_id: number | null; partner_name: string | null; chosen: boolean }

/** Clients de fiche qui ne sont jamais un payeur par défaut : Client divers, Frais de
 *  Justice, zones de police (le client présent paie alors, comme avant). */
export async function payerContext(sb: any, rest: any): Promise<PayerCtx> {
  const [assist, cat, zones, fdj] = await Promise.all([
    assistancePartnerIds(sb),
    sb.from('mission_source_catalog').select('key, default_billed_to_id').eq('key', 'prive').maybeSingle(),
    sb.from('police_zones').select('odoo_company_id'),
    getBusinessNumber('odoo_partner_frais_justice').catch(() => null),
  ])
  const notFiche = new Set<number>()
  if (cat.data?.default_billed_to_id) notFiche.add(Number(cat.data.default_billed_to_id))
  for (const z of zones.data || []) if (z.odoo_company_id) notFiche.add(Number(z.odoo_company_id))
  if (fdj) notFiche.add(Number(fdj))
  return { assist, notFiche, presentId: rest?.odoo_partner_id ? Number(rest.odoo_partner_id) : null, overrides: rest?.leg_payers || null }
}

export function resolvePayer(leg: any, who: WhoKind | null, saisie: boolean, split: Partial<Record<Poste, Payer>> | null, ctx: PayerCtx, m?: any): ResolvedPayer {
  const r = (payer: ResolvedPayer['payer'], partner_id: number | null = null, partner_name: string | null = null, chosen = false): ResolvedPayer => ({ payer, partner_id, partner_name, chosen })
  if (leg.channel === 'parquet') return r(saisie ? 'parquet' : 'other')
  const ov = ctx.overrides?.[leg.mission_id]
  if (ov) {
    if (ov.kind === 'present') return r('client', ctx.presentId, null, true)
    if (ov.kind === 'parquet' || ov.kind === 'fdj') return r(ov.kind, null, null, true)
    if (ov.kind === 'third' && ov.partner_id) {
      if (Number(ov.partner_id) === ctx.presentId) return r('client', ctx.presentId, null, true)
      return r(ctx.assist.has(Number(ov.partner_id)) ? 'other' : 'third', Number(ov.partner_id), ov.name || null, true)
    }
  }
  if (!ov && saisie && (who === 'owner' || who === 'mandate')) return r((split && split[leg.poste as Poste]) || defaultSplit(m)[leg.poste as Poste])
  const bt = leg.billed_to_id ? Number(leg.billed_to_id) : null
  const chosen = !!ov
  if (!bt || ctx.notFiche.has(bt) || bt === ctx.presentId) return r('client', ctx.presentId, null, chosen)
  if (ctx.assist.has(bt)) return r('other', bt, leg.billed_to_name || null, chosen)
  return r('third', bt, leg.billed_to_name || null, chosen)
}

/** Partenaires Odoo des assistances / assureurs (catalogue des sources, hors police, privé, garage, gardiennage). */
export async function assistancePartnerIds(sb: any): Promise<Set<number>> {
  const { data } = await sb.from('mission_source_catalog').select('key, default_billed_to_id, accident_billed_to_id').eq('active', true)
  const ids = new Set<number>()
  for (const c of data || []) {
    if (/^(police|prive|garage|gardiennage|sia_couvert)/.test(String(c.key))) continue
    if (c.default_billed_to_id) ids.add(Number(c.default_billed_to_id))
    if (c.accident_billed_to_id) ids.add(Number(c.accident_billed_to_id))
  }
  return ids
}

export async function userNames(sb: any, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const u = Array.from(new Set(ids.filter(Boolean))) as string[]
  if (!u.length) return {}
  const { data } = await sb.from('users').select('id, name').in('id', u)
  return Object.fromEntries((data || []).map((x: any) => [x.id, x.name]))
}

export async function logRestitution(sb: any, missionId: string, actorId: string | null, action: string, notes: string, metadata: any = {}) {
  await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: actorId, action: `restitution_${action}`, notes, metadata }).then(() => {}, () => {})
}

/** Dérogation « ne pas facturer ce groupe » (chauffeur sans accès facturation, Olivier
 *  01/10/2026) : kind = `sans_frais:<id de la fiche du groupe>`. */
export const SANS_FRAIS_PREFIX = 'sans_frais:'
export const isSansFraisKind = (kind: string) => /^sans_frais:[0-9a-f-]{36}$/.test(kind)
export function derogLabel(kind: string): string {
  return (DEROG_LABELS as Record<string, string>)[kind] || (kind.startsWith(SANS_FRAIS_PREFIX) ? 'ne pas facturer un groupe' : kind)
}

/**
 * Groupe du dossier non facturé (Olivier 01/10/2026) : mêmes champs que « Ne rien
 * facturer » du dossier (no_charge_* ; gardiennage : storage_waived). Le véhicule est
 * encore au parc : ni statut ni place touchés (la sortie le fera). Tracé sur la fiche du
 * groupe (annulable pendant cette restitution) et au journal de la restitution.
 */
export async function markLegNoCharge(sb: any, o: { legId: string; rootMissionId: string; restitutionId: string | null; reason: string; actorId: string; decidedBy: string; letter?: string | null }): Promise<boolean> {
  const { data: row } = await sb.from('incoming_missions').select('id, mission_number, mission_type, dossier_leg, storage_waived, no_charge_at').eq('id', o.legId).maybeSingle()
  if (!row || row.no_charge_at) return false
  const now = new Date().toISOString()
  await sb.from('incoming_missions').update({ ...(row.dossier_leg ? { storage_waived: true } : {}), no_charge_at: now, no_charge_reason: o.reason, no_charge_by: o.actorId, updated_at: now }).eq('id', o.legId)
  const ref = `${o.letter ? `${o.letter} ` : ''}(${row.mission_number || row.mission_type || 'fiche'})`
  await sb.from('mission_logs').insert({ mission_id: o.legId, actor_id: o.actorId, action: 'no_charge', notes: `Intervention sans frais : ${o.reason} (restitution, groupe ${ref})`, metadata: { reason: o.reason, dossier_letter: o.letter || null, restitution_id: o.restitutionId, prev_storage_waived: !!row.storage_waived } })
  await logRestitution(sb, o.rootMissionId, o.actorId, 'leg_no_charge', `Groupe ${ref} non facturé, décidé par ${o.decidedBy} : ${o.reason}.`, { mission_id: o.legId, reason: o.reason })
  return true
}

/**
 * Factures du dossier déjà émises et encore ouvertes (reste dû > 0), hors la facture
 * de la restitution elle-même. Elles doivent être vues et tranchées avant la sortie
 * (Olivier 30/09/2026). Les factures créées pendant la restitution pour d'autres
 * clients (transporteur…) sont marquées `third` : affichées pour information.
 */
export async function dossierOpenInvoices(sb: any, missionIds: string[], excludeId: number | null, third: any[]): Promise<any[]> {
  const [ms, bi] = await Promise.all([
    sb.from('incoming_missions').select('invoice_odoo_id').in('id', missionIds).not('invoice_odoo_id', 'is', null),
    sb.from('mission_billed_items').select('invoice_odoo_id').in('mission_id', missionIds).not('invoice_odoo_id', 'is', null),
  ])
  const thirdIds = new Set((third || []).map((t: any) => Number(t.odoo_id)).filter(Boolean))
  const ids = [...new Set([...(ms.data || []), ...(bi.data || [])].map((r: any) => Number(r.invoice_odoo_id)).concat([...thirdIds]))]
    .filter(id => id && id !== excludeId)
  if (!ids.length) return []
  const mv = await odooRpc<any[]>('account.move', 'read', [ids], { fields: ['name', 'partner_id', 'amount_total', 'amount_residual', 'state', 'payment_state', 'invoice_date', 'move_type'] }).catch(() => [] as any[])
  return mv
    .filter(x => x.move_type === 'out_invoice' && x.state !== 'cancel' && Number(x.amount_residual) > 0.01)
    .map(x => ({ id: x.id, name: x.state === 'draft' ? 'Brouillon' : x.name, partner: x.partner_id?.[1] || '', partner_id: x.partner_id?.[0] || null, date: x.invoice_date || null,
      total: Number(x.amount_total), residual: Number(x.amount_residual), state: x.state, third: thirdIds.has(x.id), url: buildInvoiceMoveUrl(x.id) }))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
}
