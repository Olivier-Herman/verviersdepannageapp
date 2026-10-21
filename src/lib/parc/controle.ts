// src/lib/parc/controle.ts
//
// Contrôle du parc (Olivier 21/10/2026) — remplace l'ancien inventaire.
//  1. lancer : on fige la liste des voitures attendues au parc, zone par zone
//     (véhicules du Domaine compris) ;
//  2. scanner à plusieurs (Jona, Mobi…) : chaque téléphone choisit sa zone, la
//     caméra lit les étiquettes en continu. Une voiture trouvée dans une autre
//     zone que celle de sa fiche y est transférée tout de suite (position réelle,
//     zone seulement : pas de rangées ni de places) ;
//  3. la ZONE TAMPON (J, relivraison K/K1 et Transit, au même endroit sur le
//     parking : déchargement des chauffeurs) se scanne en dernier ; une voiture
//     de ces zones y garde sa zone ; une voiture d'une autre zone trouvée là
//     passe en Transit ;
//  4. « Tout est scanné » : analyse des voitures non retrouvées (paiement, levée,
//     état de frais, Domaine, restitution) avec une proposition ; Mobi décide,
//     puis « Appliquer ». Les véhicules du Domaine scannés partent en zone Domaine
//     sur un bouton dédié (présence certaine puisqu'ils ont été scannés).

import { createAdminClient } from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'
import { exitPaidVehicle } from '@/lib/parc/verification'
import { parseScanInput } from '@/lib/towsoft-migration/parse-scan'
import { normalizePlate } from '@/lib/plate'

type Sb = ReturnType<typeof createAdminClient>

/** Zone tampon physique : séparées seulement dans VD Soft. */
export const TAMPON = ['J', 'K', 'K1', 'Transit']
/** Clé utilisée par le téléphone pour « je suis dans la zone tampon ». */
export const TAMPON_KEY = 'TAMPON'
/** Zones scannées en dernier (tampon puis LABO). */
export const LAST_ZONES = [...TAMPON, 'LABO']
/** Une voiture attendue au parc (les relivraisons en route ne sont pas sur le parking). */
export const EXPECTED_STATUSES = ['parked', 'unlocated', 'awaiting_payment']

const M_FIELDS = 'id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, parc_zone_key, source, status, domaine_remise_date, domaine_vente_date, dossier_leg, archived_at'

export interface Scanner { id: string; name: string }

export type ScanKind = 'ok' | 'transfere' | 'domaine' | 'en_trop' | 'deja' | 'inconnu'

export interface ScanResult {
  kind:     ScanKind
  message:  string
  detail?:  string
  item?:    any
}

function vehicleLabel(m: any): string {
  return [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ').trim()
}

export async function currentControle(sb: Sb) {
  const { data } = await sb.from('parc_controles').select('*').eq('status', 'en_cours').order('started_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

/** Lance un contrôle (ou renvoie celui en cours) et fige la liste des voitures attendues. */
export async function startControle(sb: Sb, by: Scanner): Promise<{ id: string; created: boolean; count: number }> {
  const cur = await currentControle(sb)
  if (cur) return { id: cur.id, created: false, count: 0 }
  const { data: c, error } = await sb.from('parc_controles').insert({ started_by: by.id }).select('id').single()
  if (error || !c) throw new Error(error?.message || 'création du contrôle impossible')
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('incoming_missions').select(M_FIELDS)
      .in('status', EXPECTED_STATUSES).eq('dossier_leg', false).is('archived_at', null)
      .order('id').range(from, from + 999)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const items = rows.map(m => ({
    controle_id: c.id, mission_id: m.id, expected: true, expected_zone: m.parc_zone_key || null,
    plate: m.vehicle_plate || null, vehicle: vehicleLabel(m) || null, mission_number: m.mission_number ?? null,
    source: m.source || null, status_at_start: m.status, is_domaine: !!(m.domaine_remise_date || m.domaine_vente_date),
  }))
  for (let i = 0; i < items.length; i += 500) {
    const { error: e } = await sb.from('parc_controle_items').insert(items.slice(i, i + 500))
    if (e) throw new Error(e.message)
  }
  return { id: c.id, created: true, count: items.length }
}

/** Retrouve la fiche correspondant à une étiquette, une plaque ou un châssis. */
export async function resolveScan(sb: Sb, raw: string): Promise<any | null> {
  const p = parseScanInput(String(raw || ''))
  const pick = async (col: string, val: string | number) => {
    const { data } = await sb.from('incoming_missions').select(M_FIELDS).eq(col, val).eq('dossier_leg', false).order('updated_at', { ascending: false }).limit(5)
    const list = data || []
    return list.find(m => EXPECTED_STATUSES.includes(m.status)) || list[0] || null
  }
  if (p.format === 'qr_mission' && p.missionNum) {
    return /^\d{6,10}$/.test(p.missionNum) ? pick('mission_number', Number(p.missionNum)) : pick('id', p.missionNum)
  }
  if (p.format === 'v_legacy' && p.ticketId) return pick('odoo_helpdesk_id', Number(p.ticketId))
  if (p.format === 'towsoft_num' || p.format === 'towsoft_url') {
    const n = String(p.towsoftNum)
    if (/^\d{8}$/.test(n)) { const m = await pick('mission_number', Number(n)); if (m) return m }
    return (await pick('external_id', n)) || (await pick('odoo_helpdesk_id', Number(n)))
  }
  if (p.format === 'vin' && p.vin) return (await pick('vehicle_vin', p.vin)) || (await pick('vehicle_plate', p.vin))
  if (p.format === 'plate' && p.plate) {
    if (/^\d{8}$/.test(p.plate)) { const m = await pick('mission_number', Number(p.plate)); if (m) return m }
    return pick('vehicle_plate', normalizePlate(p.plate))
  }
  return null
}

async function moveZone(sb: Sb, m: any, to: string, by: Scanner, why: string) {
  const patch: Record<string, any> = { parc_zone_key: to, parc_row_number: null, parc_slot_index: null, updated_at: new Date().toISOString() }
  // Retrouvée au parc : une fiche « introuvable » redevient « au parc ».
  if (m.status === 'unlocated') patch.status = 'parked'
  await sb.from('incoming_missions').update(patch).eq('id', m.id)
  await sb.from('mission_logs').insert({
    mission_id: m.id, action: 'parc_transfer', actor_id: by.id,
    notes: `Contrôle du parc : ${why} — zone ${m.parc_zone_key || 'aucune'} → ${to} (par ${by.name})`,
    metadata: { from_zone_key: m.parc_zone_key, to_zone_key: to, reason: 'controle_parc' },
  }).then(() => {}, () => {})
}

/** Un scan depuis un téléphone. `zone` = zone choisie (ou TAMPON). */
export async function scanControle(sb: Sb, controleId: string, by: Scanner, zone: string, input: { raw?: string; missionId?: string; via?: string; photoPath?: string }): Promise<ScanResult> {
  const { data: ctrl } = await sb.from('parc_controles').select('id, status, scanners').eq('id', controleId).maybeSingle()
  if (!ctrl || ctrl.status !== 'en_cours') return { kind: 'inconnu', message: 'Ce contrôle est clôturé.' }
  await touchScanner(sb, controleId, by, zone, ctrl.scanners)

  const m = input.missionId
    ? (await sb.from('incoming_missions').select(M_FIELDS).eq('id', input.missionId).maybeSingle()).data
    : await resolveScan(sb, input.raw || '')
  if (!m) return { kind: 'inconnu', message: 'Étiquette non reconnue', detail: 'Aucune fiche trouvée. Utilisez « Pas d’étiquette » pour photographier la plaque ou le châssis.' }

  const now = new Date().toISOString()
  const label = `${m.vehicle_plate || 'sans plaque'}${vehicleLabel(m) ? ' · ' + vehicleLabel(m) : ''}`
  let { data: item } = await sb.from('parc_controle_items').select('*').eq('controle_id', controleId).eq('mission_id', m.id).maybeSingle()
  if (item?.scanned_at) {
    return { kind: 'deja', message: `${label} — déjà scannée`, detail: `Par ${item.scanned_by_name || '?'} en ${item.scanned_zone === TAMPON_KEY ? 'zone tampon' : item.scanned_zone}`, item }
  }

  const inParc = EXPECTED_STATUSES.includes(m.status) && !m.archived_at && !m.dossier_leg
  if (!inParc) {
    const row = {
      controle_id: controleId, mission_id: m.id, expected: false, expected_zone: m.parc_zone_key || null,
      plate: m.vehicle_plate || null, vehicle: vehicleLabel(m) || null, mission_number: m.mission_number ?? null, source: m.source || null,
      status_at_start: m.status, is_domaine: !!(m.domaine_remise_date || m.domaine_vente_date),
      scanned_at: now, scanned_by: by.id, scanned_by_name: by.name, scanned_zone: zone, result: 'en_trop', via: input.via || 'etiquette', photo_path: input.photoPath || null,
    }
    const { data: ins } = item
      ? await sb.from('parc_controle_items').update(row).eq('id', item.id).select('*').single()
      : await sb.from('parc_controle_items').insert(row).select('*').single()
    return { kind: 'en_trop', message: `${label} — pas attendue au parc`, detail: `Fiche « ${m.status} » : mise à part pour décision`, item: ins }
  }

  // Zone réelle d'après le téléphone.
  const cur = m.parc_zone_key || null
  let target: string | null = null
  if (zone === TAMPON_KEY) target = cur && TAMPON.includes(cur) ? null : 'Transit'
  else target = cur === zone ? null : zone
  if (target) await moveZone(sb, m, target, by, zone === TAMPON_KEY ? 'trouvée dans la zone tampon' : `trouvée en zone ${zone}`)
  else if (m.status === 'unlocated') await sb.from('incoming_missions').update({ status: 'parked', updated_at: now }).eq('id', m.id)

  const isDom = !!(m.domaine_remise_date || m.domaine_vente_date)
  const finalZone = target || cur
  const kind: ScanKind = isDom && finalZone !== 'Domaine' ? 'domaine' : target ? 'transfere' : 'ok'
  const patch = {
    scanned_at: now, scanned_by: by.id, scanned_by_name: by.name, scanned_zone: zone, result: kind,
    moved_from: target ? cur : null, moved_to: target, via: input.via || 'etiquette', photo_path: input.photoPath || null, is_domaine: isDom,
  }
  if (item) ({ data: item } = await sb.from('parc_controle_items').update(patch).eq('id', item.id).select('*').single())
  else ({ data: item } = await sb.from('parc_controle_items').insert({
    controle_id: controleId, mission_id: m.id, expected: false, expected_zone: cur, plate: m.vehicle_plate || null,
    vehicle: vehicleLabel(m) || null, mission_number: m.mission_number ?? null, source: m.source || null, status_at_start: m.status, ...patch,
    analysis: { category: 'entree_pendant', label: 'Entrée au parc pendant le contrôle' },
  }).select('*').single())

  if (kind === 'domaine') return { kind, message: `${label} — remise au Domaine`, detail: `À transférer en zone Domaine en fin de contrôle${target ? ` · rangée en ${target}` : ''}`, item }
  if (kind === 'transfere') return { kind, message: label, detail: `Était en ${cur || 'aucune zone'} → passée en ${target}`, item }
  return { kind, message: label, detail: zone === TAMPON_KEY ? `À sa place (${cur}) dans la zone tampon` : `À sa place en ${cur}`, item }
}

export async function touchScanner(sb: Sb, controleId: string, by: Scanner, zone: string, prev?: any) {
  let scanners = prev
  if (scanners === undefined) scanners = (await sb.from('parc_controles').select('scanners').eq('id', controleId).maybeSingle()).data?.scanners
  const next = { ...(scanners || {}), [by.id]: { name: by.name, zone, at: new Date().toISOString() } }
  await sb.from('parc_controles').update({ scanners: next }).eq('id', controleId)
}

export async function zoneDone(sb: Sb, controleId: string, by: Scanner, zone: string) {
  const { data: c } = await sb.from('parc_controles').select('zones_done').eq('id', controleId).maybeSingle()
  const keys = zone === TAMPON_KEY ? TAMPON : [zone]
  const next = { ...(c?.zones_done || {}) }
  for (const k of keys) next[k] = { at: new Date().toISOString(), by: by.name }
  await sb.from('parc_controles').update({ zones_done: next }).eq('id', controleId)
}

const PAID_STATES = ['paid', 'in_payment']
const fmt = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''

interface Ctx { m: any; sd: any; log: any }

/** Analyse d'une voiture non retrouvée : ce que VD Soft sait + une proposition. */
function analyse({ m, sd, log }: Ctx) {
  if (!m) return { category: 'aucune', label: 'Fiche introuvable', facts: [] as string[], proposal: 'laisser' }
  const facts: string[] = []
  const paid = m.paid_at || (m.payment_state_odoo && PAID_STATES.includes(m.payment_state_odoo)) || m.payment_collected_at
  if (m.invoice_number) facts.push(`Facture ${m.invoice_number}${paid ? ` payée${m.paid_at ? ' le ' + fmt(m.paid_at) : ''}` : ' non payée'}`)
  else if (m.payment_collected_at) facts.push(`Encaissé par le chauffeur le ${fmt(m.payment_collected_at)}`)
  if (m.levee_saisie_at) facts.push(`Levée de saisie du ${fmt(m.levee_saisie_at)}`)
  if (m.domaine_remise_date) facts.push(`Remise au Domaine le ${fmt(m.domaine_remise_date)}`)
  if (m.domaine_vente_date) facts.push(`Vendue par le Domaine le ${fmt(m.domaine_vente_date)}`)
  if (m.domaine_enlevement_date) facts.push(`Enlevée par l’acheteur le ${fmt(m.domaine_enlevement_date)}`)
  if (sd) facts.push(`État de frais : ${sd.ef_number || '—'} (${String(sd.state).replace(/_/g, ' ')})`)
  if (log) facts.push(`Dernière action : ${String(log.notes || log.action).slice(0, 90)} (${fmt(log.created_at)})`)

  if (!EXPECTED_STATUSES.includes(m.status) || m.archived_at) return { category: 'sortie_pendant', label: 'Sortie du parc pendant le contrôle', facts, proposal: 'laisser' }
  if (m.domaine_vente_date || m.domaine_enlevement_date) return { category: 'domaine', label: 'Vendue ou enlevée par le Domaine', facts, proposal: 'sortir', exit_date: m.domaine_enlevement_date || m.domaine_vente_date }
  const saisie = !!sd || /saisie/.test(m.source || '')
  if (paid && (!saisie || m.levee_saisie_at)) {
    const d = [m.paid_at, m.payment_collected_at, m.levee_saisie_at].filter(Boolean).sort().pop()
    return { category: 'paye', label: 'Payée (et levée reçue) : sortie oubliée', facts, proposal: 'sortir', exit_date: d || null }
  }
  if (paid) return { category: 'paye_sans_levee', label: 'Payée, mais pas de levée de saisie', facts, proposal: 'rechercher' }
  if (m.levee_saisie_at) return { category: 'levee', label: 'Levée reçue, pas de paiement', facts, proposal: 'rechercher' }
  return { category: 'aucune', label: 'Aucune trace de sortie', facts, proposal: 'rechercher' }
}

/** « Tout est scanné » : clôture et analyse des voitures non retrouvées (lectures par lots). */
export async function closeControle(sb: Sb, controleId: string, by: Scanner) {
  const { data: c } = await sb.from('parc_controles').select('status').eq('id', controleId).maybeSingle()
  if (!c) throw new Error('Contrôle introuvable')
  if (c.status !== 'en_cours') return
  await sb.from('parc_controles').update({ status: 'cloture', closed_at: new Date().toISOString(), closed_by: by.id }).eq('id', controleId)
  const { data: miss } = await sb.from('parc_controle_items').select('id, mission_id').eq('controle_id', controleId).eq('expected', true).is('scanned_at', null)
  const list = (miss || []).filter(i => i.mission_id)
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100)
    const ids = chunk.map(x => x.mission_id as string)
    const [{ data: ms }, { data: sds }, { data: logs }] = await Promise.all([
      sb.from('incoming_missions').select('id, status, source, archived_at, paid_at, payment_state_odoo, payment_collected_at, invoice_number, levee_saisie_at, domaine_remise_date, domaine_vente_date, domaine_enlevement_date').in('id', ids),
      sb.from('saisie_dossiers').select('mission_id, state, ef_number').in('mission_id', ids),
      sb.from('mission_logs').select('mission_id, action, notes, created_at').in('mission_id', ids)
        .not('action', 'in', '(touring_synced,touring_sync_error,kaze_synced,vab_synced,odoo_synced,save_photos,mark_photo_category,geocoded_server)')
        .order('created_at', { ascending: false }).limit(3000),
    ])
    const mm = new Map((ms || []).map(x => [x.id, x]))
    const sm = new Map((sds || []).map(x => [x.mission_id, x]))
    const lm = new Map<string, any>(); for (const l of logs || []) if (!lm.has(l.mission_id)) lm.set(l.mission_id, l)
    await Promise.all(chunk.map(it => {
      const a = analyse({ m: mm.get(it.mission_id), sd: sm.get(it.mission_id), log: lm.get(it.mission_id) })
      return sb.from('parc_controle_items').update({ analysis: a, decision: a.proposal === 'laisser' ? 'laisser' : null }).eq('id', it.id)
    }))
  }
}

export const DECISIONS = ['sortir', 'rechercher', 'laisser', 'remettre', 'enquete'] as const

/** Applique les décisions prises sur l'analyse. */
export async function applyDecisions(sb: Sb, controleId: string, by: Scanner) {
  const { data: items } = await sb.from('parc_controle_items').select('*').eq('controle_id', controleId).not('decision', 'is', null).is('applied_at', null)
  const out: { plate: string | null; result: string }[] = []
  const now = new Date().toISOString()
  for (const it of items || []) {
    let res = 'rien à faire'
    const { data: m } = await sb.from('incoming_missions').select('id, status, parc_zone_key').eq('id', it.mission_id).maybeSingle()
    if (!m) res = 'fiche introuvable'
    else if (it.decision === 'sortir') {
      const exitIso = it.analysis?.exit_date ? `${String(it.analysis.exit_date).slice(0, 10)}T12:00:00+02:00` : now
      const why = `contrôle du parc du ${fmt(now)} : non retrouvée — ${it.analysis?.label || 'sortie décidée par Mobi'}`
      if (m.status === 'parked') res = await exitPaidVehicle(sb, m.id, exitIso, why)
      else {
        await sb.from('incoming_missions').update({ status: 'completed', completed_at: exitIso, updated_at: now }).eq('id', m.id)
        try { await releaseParcAndShift(sb as any, m.id) } catch { /* non bloquant */ }
        await sb.from('mission_logs').insert({ mission_id: m.id, action: 'parc_exit_verified', notes: `Sortie du parc — ${why}` })
        res = `sortie du parc au ${fmt(exitIso)}`
      }
    } else if (it.decision === 'rechercher') {
      if (m.status === 'parked') await sb.from('incoming_missions').update({ status: 'unlocated', parc_row_number: null, parc_slot_index: null, updated_at: now }).eq('id', m.id)
      await sb.from('mission_logs').insert({ mission_id: m.id, action: 'parc_controle_absent', notes: `Contrôle du parc du ${fmt(now)} : non retrouvée, à rechercher (décision de ${by.name})` })
      res = 'mise dans « Non localisés » pour recherche'
    } else if (it.decision === 'remettre') {
      const zone = it.scanned_zone === TAMPON_KEY ? 'Transit' : it.scanned_zone
      await sb.from('incoming_missions').update({ status: 'parked', parc_zone_key: zone, parc_row_number: null, parc_slot_index: null, parc_exit_at: null, updated_at: now }).eq('id', m.id)
      await sb.from('mission_logs').insert({ mission_id: m.id, action: 'parc_controle_retrouvee', notes: `Contrôle du parc du ${fmt(now)} : retrouvée au parc (fiche « ${m.status} »), remise au parc en zone ${zone} (décision de ${by.name})` })
      res = `remise au parc en zone ${zone}`
    } else if (it.decision === 'enquete') {
      await sb.from('mission_logs').insert({ mission_id: m.id, action: 'parc_controle_retrouvee', notes: `Contrôle du parc du ${fmt(now)} : retrouvée au parc alors que la fiche est « ${m.status} » — à éclaircir (${by.name})` })
      res = 'signalée sur la fiche, fiche inchangée'
    } else if (it.decision === 'laisser') {
      res = 'laissée telle quelle'
    }
    await sb.from('parc_controle_items').update({ applied_at: now, applied_result: res }).eq('id', it.id)
    out.push({ plate: it.plate, result: res })
  }
  const { count } = await sb.from('parc_controle_items').select('*', { count: 'exact', head: true }).eq('controle_id', controleId).eq('expected', true).is('scanned_at', null).is('applied_at', null)
  if (!count) await sb.from('parc_controles').update({ status: 'applique', applied_at: now, applied_by: by.id }).eq('id', controleId)
  return out
}

/** Transfère en zone Domaine les véhicules du Domaine scannés pendant le contrôle. */
export async function transferDomaine(sb: Sb, controleId: string, by: Scanner) {
  const { data: items } = await sb.from('parc_controle_items').select('id, mission_id, plate').eq('controle_id', controleId).eq('result', 'domaine')
  let n = 0
  for (const it of items || []) {
    const { data: m } = await sb.from('incoming_missions').select(M_FIELDS).eq('id', it.mission_id).maybeSingle()
    if (!m || m.parc_zone_key === 'Domaine' || !EXPECTED_STATUSES.includes(m.status)) continue
    await moveZone(sb, m, 'Domaine', by, 'véhicule remis au Domaine, scanné au parc')
    await sb.from('parc_controle_items').update({ moved_to: 'Domaine', applied_at: new Date().toISOString(), applied_result: 'transférée en zone Domaine' }).eq('id', it.id)
    n++
  }
  return n
}
