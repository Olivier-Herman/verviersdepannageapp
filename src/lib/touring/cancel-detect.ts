// src/lib/touring/cancel-detect.ts
//
// Surveillance ANNULATION Touring COMEX. Une mission Touring non validée à temps
// est annulée + réattribuée par Touring → elle DISPARAÎT de listComexMissions
// (dispatch ET user) alors que notre fiche reste active. On détecte, on confirme
// (fenêtre), puis on tranche selon la règle « Mondial » :
//   • chauffeur PAS parti (pas de touring_onroad_at) → annulée SANS FRAIS.
//   • chauffeur PARTI                                → DÉPLACEMENT (trajet à vide facturable).
// Olivier 2026-08-09. Cf [[project_touring_annulation_non_validation]].

import { loginComex, listComexMissions } from './comex'
import { sendNotificationToRoles } from '@/lib/notifications/send'

// 'new' et 'dispatching' aussi (30/09/2026, 2FNN308) : une mission refusée ou
// retirée dans COMEX AVANT d'être acceptée restait « Nouvelle » dans le dispatch
// pour toujours. Aucun chauffeur n'est parti → elle passe annulée sans frais.
const ACTIVE_STATUSES  = ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering']
const CONFIRM_MIN      = 14   // fenêtre de confirmation (≈7 poll cycles) avant de trancher

export interface CancelDetectSummary {
  checked: number; missingNew: number; recovered: number
  confirmed: number; deplacement: number; sansFrais: number
  actions: { plate: string; kind: string }[]
}

// Union des dossiers vivants sur les 2 comptes COMEX. null = échec (on n'agit pas).
async function liveDossiers(): Promise<Set<string> | null> {
  const set = new Set<string>()
  let anyOk = false
  for (const acc of ['dispatch', 'user'] as const) {
    try {
      const session = await loginComex(acc)
      const list = await listComexMissions(session)
      for (const m of (list || [])) set.add(String(m.CID_DOS || '').toUpperCase())
      anyOk = true
    } catch { /* compte indispo → on ne le compte pas comme vivant, mais on ne bloque pas */ }
  }
  return anyOk ? set : null   // si AUCUN compte n'a répondu, on ne tranche pas (évite faux positifs)
}

export async function runTouringCancelDetect(sb: any): Promise<CancelDetectSummary> {
  const out: CancelDetectSummary = { checked: 0, missingNew: 0, recovered: 0, confirmed: 0, deplacement: 0, sansFrais: 0, actions: [] }

  const { data: fiches } = await sb.from('incoming_missions')
    .select('id, mission_number, dossier_number, vehicle_plate, status, mission_type, loaded_at, completed_at, touring_onroad_at, touring_missing_since, parent_mission_id')
    .eq('source_format', 'comex')
    .in('status', ACTIVE_STATUSES)
    .eq('dossier_leg', false)
    .not('dossier_number', 'is', null)
    .limit(500)
  if (!fiches || !fiches.length) return out

  const live = await liveDossiers()
  if (!live) return out   // les 2 comptes COMEX sont KO → on ne fait rien ce tour

  // ── UNE RELIVRAISON VIT SUR LE DOSSIER DE SON REMORQUAGE ─────────────────
  // 2GLN102, 27/09/2026 : la relivraison reprenait la commande TGR que Touring
  // avait ouverte à part (2026BE372690), déjà passée en BKO ; le remorquage
  // d'origine (2026BE369131) gardait, lui, une action ouverte chez eux. Vingt
  // minutes après l'assignation, cette règle a « annulé » la relivraison en
  // trajet à vide — Franck et le dispatch ne la voyaient plus. Le lien qui fait
  // foi pour une REL, c'est le dossier du parc dont elle sort : tant qu'il est
  // vivant chez Touring, la relivraison l'est aussi.
  const parentIds = [...new Set((fiches as any[]).map(f => f.parent_mission_id).filter(Boolean))]
  const parentCid = new Map<string, string>()
  if (parentIds.length) {
    const { data: parents } = await sb.from('incoming_missions').select('id, dossier_number').in('id', parentIds)
    for (const p of (parents || []) as any[]) if (p.dossier_number) parentCid.set(p.id, String(p.dossier_number).toUpperCase().replace(/-REL$/, ''))
  }

  const now = Date.now()
  for (const f of fiches) {
    out.checked++
    // La REL d'un dossier Touring porte « …-REL » (create-relivraison) mais vit
    // sur la même commande COMEX : on compare sur la commande. 24/09/2026.
    const cid = String(f.dossier_number || '').toUpperCase().replace(/-REL$/, '')
    if (!cid) continue
    const viaParent = f.parent_mission_id ? parentCid.get(f.parent_mission_id) : undefined

    if (live.has(cid) || (viaParent && live.has(viaParent))) {   // toujours vivante (elle-même, ou le dossier du parc dont elle sort)
      if (f.touring_missing_since) { await sb.from('incoming_missions').update({ touring_missing_since: null }).eq('id', f.id); out.recovered++ }
      continue
    }

    // Absente des listes COMEX.
    if (!f.touring_missing_since) {                         // 1re détection → on démarre le chrono
      await sb.from('incoming_missions').update({ touring_missing_since: new Date().toISOString() }).eq('id', f.id)
      out.missingNew++
      continue
    }
    if (now - Date.parse(f.touring_missing_since) < CONFIRM_MIN * 60000) continue   // fenêtre pas écoulée

    // ── UNE MISSION FAITE NE DEVIENT PAS UN TRAJET À VIDE ───────────────────
    // « On ne peut pas arriver à un trajet à vide si le chauffeur a déjà déposé
    // le véhicule à destination » (Olivier 2026-08-31). Sur 2HDS859, Fred Palm
    // avait chargé à 13h19 et clôturé « livré à destination » à 13h20 ; à 22h15
    // cette règle a requalifié la mission en trajet à vide parce que Touring
    // avait retiré le dossier de ses listes. Le travail était fait, et la fiche
    // s'est retrouvée sans tarif possible — un trajet à vide n'a pas de scénario
    // Siabis.
    //
    // Le dossier disparaît de chez eux pour des raisons qui les regardent
    // (réattribution administrative, refacturation). Ça ne peut pas effacer ce
    // que le chauffeur a fait. On note l'annulation, on ne retouche pas la fiche.
    const véhiculeEmporté = !!f.loaded_at || ['delivering', 'parked', 'completed', 'to_invoice'].includes(String(f.status))
    if (véhiculeEmporté) {
      await sb.from('incoming_missions').update({ touring_missing_since: null, updated_at: new Date().toISOString() }).eq('id', f.id)
      await sb.from('mission_logs').insert({
        mission_id: f.id, action: 'touring_cancelled_ignored',
        notes: `Touring a retiré le dossier ${f.dossier_number} de ses listes, mais le véhicule a été pris en charge `
             + `(${f.loaded_at ? 'chargé' : 'statut ' + f.status}) — la mission est conservée telle quelle, à vérifier chez eux.`,
      }).then(() => {}, () => {})
      out.checked += 0
      continue
    }

    // Confirmé annulé → règle « Mondial ».
    const departed = !!f.touring_onroad_at
    const patch: any = { touring_missing_since: null, updated_at: new Date().toISOString() }
    if (departed) {
      patch.mission_type = 'trajet_vide'
      patch.status = 'to_invoice'
      patch.completed_at = new Date().toISOString()
      out.deplacement++
    } else {
      patch.status = 'cancelled'
      out.sansFrais++
    }
    await sb.from('incoming_missions').update(patch).eq('id', f.id)
    out.confirmed++
    out.actions.push({ plate: f.vehicle_plate || '—', kind: departed ? 'déplacement' : 'sans frais' })
    await sb.from('mission_logs').insert({
      mission_id: f.id, action: 'touring_cancelled_detected',
      notes: ['new', 'dispatching'].includes(String(f.status))
        ? `Mission refusée ou retirée dans COMEX avant acceptation (dossier ${f.dossier_number} absent des listes) → annulée sans frais.`
        : `Touring a annulé/réattribué (dossier ${f.dossier_number} absent des listes COMEX). Règle Mondial : ${departed ? 'DÉPLACEMENT — chauffeur parti → trajet à vide à facturer' : 'annulée SANS FRAIS — chauffeur non parti'}.`,
    }).then(() => {}, () => {})
  }

  if (out.confirmed > 0) {
    await sendNotificationToRoles(['admin', 'superadmin', 'dispatcher'], 'touring_cancelled', {
      title: `Touring : ${out.confirmed} annulation(s) détectée(s)`,
      body: `${out.deplacement} déplacement(s) à facturer · ${out.sansFrais} sans frais — ${out.actions.map(a => a.plate).slice(0, 6).join(', ')}`,
      action_url: '/dispatch',
    }).catch(() => {})
  }
  return out
}
