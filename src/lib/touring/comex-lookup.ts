// src/lib/touring/comex-lookup.ts
//
// « COMEX d'abord » à la réception d'un mail Touring : on cherche la mission sur
// COMEX (par n° dossier 2026BE… ou n° commande …MA). Si elle y est, on crée/lie
// la fiche depuis les données COMEX STRUCTURÉES (0 appel Claude). Sinon, le
// processor retombe sur le parsing du mail (roue de secours).
//
// Gaté en amont par TOURING_COMEX_MODE=import (l'appelant vérifie).

import { loginComex, listComexMissions, getComexMissionDetail } from './comex'
import { mapComexToMission } from './map-mission'

// Champs de CONTENU que COMEX (maître) écrase sur une fiche mail déjà « à valider ».
// Exclut tout l'opérationnel (id, status, mission_number, assigned_*, dates, parc…).
const COMEX_OVERWRITE_FIELDS = [
  'dossier_number', 'mission_type', 'incident_type', 'incident_description',
  'client_name', 'client_phone', 'client_email', 'assisted_name',
  'vehicle_plate', 'vehicle_brand', 'vehicle_model', 'vehicle_vin', 'vehicle_fuel', 'vehicle_gearbox',
  'incident_address', 'incident_city', 'incident_lat', 'incident_lng',
  'destination_name', 'destination_address', 'destination_lat', 'destination_lng',
  'billed_to_id', 'billed_to_name', 'parse_confidence',
]

export interface ComexLookupResult {
  matched:     boolean
  missionId?:  string
  externalId?: string
  action?:     'created' | 'linked'
}

/**
 * Cherche la mission sur COMEX et matérialise la fiche depuis COMEX (0 IA).
 * - fiche existante (même external_id) → adoption (lien + contenu si à valider)
 * - sinon, si placeholderId fourni → on réutilise le placeholder comme fiche
 * - sinon → insertion
 * Retourne { matched:false } si la mission n'est pas (encore) sur COMEX → le
 * processor doit alors parser le mail.
 */
export async function importComexByRefs(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:      any
  dossiers:      string[]
  commandes:     string[]
  placeholderId?: string | null
}): Promise<ComexLookupResult> {
  const { supabase, dossiers, commandes, placeholderId } = opts
  const wantDossier  = new Set(dossiers.map(s => s.toUpperCase()))
  const wantCommande = new Set(commandes.map(s => s.toUpperCase()))
  if (wantDossier.size === 0 && wantCommande.size === 0) return { matched: false }

  const session  = await loginComex('dispatch')
  const missions = await listComexMissions(session)
  const match = missions.find(m =>
    String(m.COD_STATUT_MTR) !== '07' && (
      wantDossier.has(String(m.CID_DOS || '').toUpperCase()) ||
      wantCommande.has(String((m as any).NUM_COMMANDE || '').toUpperCase())
    ))
  if (!match) return { matched: false }

  const detailRes = await getComexMissionDetail(session, { CID_DOS: match.CID_DOS, CID_SEQ_ACTION: match.CID_SEQ_ACTION })
  const detail = (detailRes?.content || detailRes || {}) as Record<string, any>
  const comexRaw = JSON.stringify({ ...detail, CID_DOS: match.CID_DOS, CID_SEQ_ACTION: match.CID_SEQ_ACTION })
  const externalId = String(detail.NUM_COMMANDE || '').trim() || `${match.CID_DOS}/${match.CID_SEQ_ACTION}`

  const { data: cat } = await supabase.from('mission_source_catalog')
    .select('default_billed_to_id, default_billed_to_name').eq('key', 'touring').maybeSingle()
  const payload = mapComexToMission({
    detail, status: 'new',
    billedToId:   cat?.default_billed_to_id   || null,
    billedToName: cat?.default_billed_to_name || null,
  })
  payload.external_id   = externalId
  payload.raw_content   = comexRaw
  payload.dispatch_mode = 'manual'

  // ── CHAÎNAGE PAR COMMANDE, avant tout le reste ──────────────────────────
  // `external_id` est le n° d'ACTION (…MA) : il CHANGE à chaque étape du cycle
  // (dépannage → remorquage → transfert). Chercher par lui seul ne pouvait donc
  // jamais reconnaître la jambe suivante — d'où une 2e fiche créée à côté de
  // celle du chauffeur. Vu en réel le 13/08 sur ACRX747 : Franck transforme en
  // remorquage à 13:20, Touring ouvre la séquence 201, elle arrive par mail à
  // 13:21 comme une fiche neuve « en dispatching », et la livraison de 13:41
  // part sur la séquence 200 déjà clôturée (COMEX 07→07) pendant que la vraie
  // jambe remorquage attend un chauffeur.
  //
  // Le poll COMEX (src/lib/touring/import.ts) savait déjà chaîner sur le n° de
  // COMMANDE (2026BE…, constant tout le cycle) ; ce chemin-ci, déclenché par le
  // MAIL, ne le savait pas. Même règle des deux côtés, garde anti-recul comprise.
  // Olivier 2026-08-13.
  if (match.CID_DOS) {
    const { data: lineage } = await supabase.from('incoming_missions')
      .select('id, status, mission_number, raw_content')
      .eq('dossier_number', String(match.CID_DOS))
      .not('status', 'in', '(cancelled,completed,to_invoice,invoiced,ignored,deleted)')
      .order('updated_at', { ascending: false })
      .limit(1).maybeSingle()
    if (lineage && (lineage as any).id !== placeholderId) {
      const lin: any = lineage
      let curSeq = -1
      try { curSeq = parseInt(String(JSON.parse(lin.raw_content || '{}').CID_SEQ_ACTION || ''), 10) } catch { /* raw non-JSON */ }
      const newSeq = parseInt(String(match.CID_SEQ_ACTION), 10)
      // On n'avance QUE vers une action plus récente — jamais de retour en arrière.
      if (Number.isFinite(newSeq) && (curSeq < 0 || newSeq > curSeq)) {
        await supabase.from('incoming_missions').update({
          source_format: 'comex', raw_content: comexRaw, external_id: externalId,
          updated_at: new Date().toISOString(),
        }).eq('id', lin.id)
        await supabase.from('mission_logs').insert({
          mission_id: lin.id, action: 'touring_synced',
          notes: `Touring : action ${match.CID_SEQ_ACTION} rattachée à cette fiche (séquence ${curSeq} → ${newSeq}) — pas de 2e fiche.`,
          metadata: { cid_dos: match.CID_DOS, seq_from: curSeq, seq_to: newSeq, external_id: externalId, via: 'mail' },
        }).then(() => {}, () => {})
        if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
        return { matched: true, missionId: lin.id, externalId, action: 'linked' }
      }
    }
  }

  // Fiche déjà présente avec ce ref (import COMEX précédent ou 1er mail) ?
  const { data: existing } = await supabase.from('incoming_missions')
    .select('id, status, source_format').eq('external_id', externalId).maybeSingle()

  if (existing && existing.id !== placeholderId) {
    // ADOPTION : lien COMEX essentiel (persiste toujours) + contenu si à valider.
    await supabase.from('incoming_missions')
      .update({ source_format: 'comex', raw_content: comexRaw, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (['new', 'dispatching'].includes(String(existing.status))) {
      const upd: Record<string, any> = {}
      for (const f of COMEX_OVERWRITE_FIELDS) {
        const v = (payload as any)[f]
        if (v !== undefined && v !== null && v !== '') upd[f] = v
      }
      if (Object.keys(upd).length > 0) {
        await supabase.from('incoming_missions').update(upd).eq('id', existing.id)
      }
    }
    return { matched: true, missionId: existing.id, externalId, action: 'linked' }
  }

  if (placeholderId) {
    // Réutilise le placeholder du mail → devient la fiche COMEX complète.
    await supabase.from('incoming_missions')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', placeholderId)
    return { matched: true, missionId: placeholderId, externalId, action: 'created' }
  }

  const { data: ins } = await supabase.from('incoming_missions').insert(payload).select('id').single()
  return { matched: true, missionId: ins?.id, externalId, action: 'created' }
}
