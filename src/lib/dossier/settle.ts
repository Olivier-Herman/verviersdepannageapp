// src/lib/dossier/settle.ts
//
// Solde la fiche RACINE d'un dossier quand plus rien n'est dû : tous les
// groupes facturés (ou sans frais, ou à 0 €) et le véhicule sorti du parc →
// status 'completed' + n° de facture repris des postes. Sans ça, une fiche
// facturée partiellement depuis la Vue dossier puis restituée restait
// « à facturer » à vie (HSAV6087 / #10133715, Olivier 09/09/2026).
// Appelé après : sortie du parc (exit-parc), « déjà facturé » / « sans frais »
// (mark), « Facturation OK » (verify-invoices).

import { buildDossier } from './build'
import { isLegBilled } from './billed'

export async function settleRootIfDone(sb: any, anyMissionId: string, actorId?: string | null): Promise<{ settled: boolean; reason?: string }> {
  const d = await buildDossier(anyMissionId, { cache: false })
  if (!d) return { settled: false, reason: 'dossier introuvable' }
  const { data: root } = await sb.from('incoming_missions').select('id, status, invoice_number, invoice_method, invoiced_at, levee_saisie_type, levee_saisie_note').eq('id', d.root_id).maybeSingle()
  if (root?.status === 'completed' || root?.status === 'cancelled') await completeBilledChildren(sb, d.root_id, actorId)
  if (!root || root.status !== 'to_invoice') return { settled: false, reason: `racine ${root?.status || '?'}` }
  if (d.state.open) return { settled: false, reason: 'dossier encore en cours' }
  const legDone = (l: any) => isLegBilled(l)
    || !!l.nothing_to_bill
    || (l.amount_htva === 0 && !l.amount_unknown && !l.open)
  const pending = d.legs.filter(l => l.kind !== 'out' && !legDone(l))
  if (pending.length) return { settled: false, reason: `groupes ouverts : ${pending.map(l => l.letter).join(', ')}` }
  // Un brouillon Odoo non confirmé n'est pas une facture : on attend « Facturation OK ».
  const refs = d.legs.flatMap(l => l.billed_refs || [])
  if (refs.some(r => /brouillon/i.test(String(r)))) return { settled: false, reason: 'brouillon Odoo à confirmer' }
  const number = refs.find(r => /^\d{4}\/\d{2}\/\d+/.test(String(r))) || root.invoice_number || null
  const now = new Date().toISOString()
  // Levée de saisie TEMPORAIRE : le garagiste a emmené le véhicule, qui reste saisi et reviendra.
  // Facture validée → zone T (chez le garagiste), jamais « terminé » (1RCN112, Olivier 22/10/2026).
  if (root.levee_saisie_type === 'temporaire') return toZoneT(sb, d.root_id, root, number, refs, actorId)
  const upd: Record<string, any> = { status: 'completed', completed_at: undefined, updated_at: now }
  delete upd.completed_at
  if (number && !root.invoice_number) { upd.invoice_number = number; upd.invoice_method = root.invoice_method || 'manual'; upd.invoiced_at = root.invoiced_at || now }
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', d.root_id).eq('status', 'to_invoice')
  if (error) return { settled: false, reason: error.message }
  await sb.from('mission_logs').insert({
    mission_id: d.root_id, actor_id: actorId || null, action: 'auto_completed',
    notes: `Dossier soldé : tous les groupes facturés ou sans frais (${refs.filter(Boolean).join(', ') || 'sans facture'}), véhicule sorti — fiche terminée.`,
    metadata: { via: 'settle_root', refs },
  }).then(() => {}, () => {})
  await completeBilledChildren(sb, d.root_id, actorId, true)
  return { settled: true }
}

async function toZoneT(sb: any, rootId: string, root: any, number: string | null, refs: any[], actorId?: string | null): Promise<{ settled: boolean; reason?: string }> {
  const { data: doc } = await sb.from('requisitoire_intake').select('extracted').eq('matched_mission_id', rootId).eq('doc_type', 'levee_saisie')
    .order('received_at', { ascending: false }).limit(1).maybeSingle()
  const garage = (doc?.extracted as any)?.garagiste || null
  const now = new Date().toISOString()
  const upd: Record<string, any> = { status: 'parked', parc_zone_key: 'T', zone_t_at: now, zone_t_garage: garage, updated_at: now }
  if (number && !root.invoice_number) { upd.invoice_number = number; upd.invoice_method = root.invoice_method || 'manual'; upd.invoiced_at = root.invoiced_at || now }
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', rootId).eq('status', 'to_invoice')
  if (error) return { settled: false, reason: error.message }
  await sb.from('mission_logs').insert({
    mission_id: rootId, actor_id: actorId || null, action: 'zone_t',
    notes: `Levée temporaire, facture validée (${refs.filter(Boolean).join(', ') || 'sans facture'}) : véhicule en zone T, chez le garagiste${garage ? ` (${garage})` : ''}. Le gardiennage reprendra à son retour ; sortie automatique après 2 mois sans retour.`,
    metadata: { via: 'settle_root', refs },
  }).then(() => {}, () => {})
  return { settled: true, reason: 'zone_t' }
}

/**
 * Fiches rattachées au dossier (relivraison AXA, Kaze…) facturées depuis le dossier : elles attendaient que
 * le dossier soit couvert. Une fois la racine terminée ou annulée, elles restaient « à facturer » à vie
 * et le dossier réapparaissait en facturation (#10175143 / relivraison #10177258, Jona 09/10/2026).
 */
export async function completeBilledChildren(sb: any, rootId: string, actorId?: string | null, dossierCovered = false): Promise<number> {
  // Toute la descendance (relivraison d'une relivraison : #10139488 → #10142682 → #10145207).
  const kids: any[] = []
  let parents = [rootId]
  for (let depth = 0; depth < 5 && parents.length; depth++) {
    const { data } = await sb.from('incoming_missions').select('id, status, invoice_number').in('parent_mission_id', parents).eq('dossier_leg', false)
    kids.push(...(data || []))
    parents = (data || []).map((k: any) => k.id)
  }
  let n = 0
  for (const k of kids) {
    if (k.status !== 'to_invoice') continue
    const numbered = /^\d{4}\/\d{2}\/\d+/.test(String(k.invoice_number || ''))
    // Racine soldée par settleRootIfDone = tous les groupes du dossier vérifiés facturés ou sans frais.
    if (!numbered && !dossierCovered) continue
    const { error } = await sb.from('incoming_missions').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', k.id).eq('status', 'to_invoice')
    if (error) continue
    n++
    await sb.from('mission_logs').insert({
      mission_id: k.id, actor_id: actorId || null, action: 'auto_completed',
      notes: numbered ? `Facturée n° ${k.invoice_number} avec le dossier, dossier principal soldé — fiche terminée.` : 'Dossier principal soldé (tous les groupes facturés ou sans frais) — fiche terminée.',
      metadata: { via: 'settle_children', root_id: rootId },
    }).then(() => {}, () => {})
  }
  return n
}
