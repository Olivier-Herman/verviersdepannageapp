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

export async function settleRootIfDone(sb: any, anyMissionId: string, actorId?: string | null): Promise<{ settled: boolean; reason?: string }> {
  const d = await buildDossier(anyMissionId, { cache: false })
  if (!d) return { settled: false, reason: 'dossier introuvable' }
  const { data: root } = await sb.from('incoming_missions').select('id, status, invoice_number, invoice_method, invoiced_at').eq('id', d.root_id).maybeSingle()
  if (!root || root.status !== 'to_invoice') return { settled: false, reason: `racine ${root?.status || '?'}` }
  if (d.state.open) return { settled: false, reason: 'dossier encore en cours' }
  const legDone = (l: any) => (l.billed_refs?.length > 0 && l.billed_htva >= l.amount_htva - 0.01)
    || !!l.nothing_to_bill
    || (l.amount_htva === 0 && !l.amount_unknown && !l.open)
  const pending = d.legs.filter(l => l.kind !== 'out' && !legDone(l))
  if (pending.length) return { settled: false, reason: `groupes ouverts : ${pending.map(l => l.letter).join(', ')}` }
  // Un brouillon Odoo non confirmé n'est pas une facture : on attend « Facturation OK ».
  const refs = d.legs.flatMap(l => l.billed_refs || [])
  if (refs.some(r => /brouillon/i.test(String(r)))) return { settled: false, reason: 'brouillon Odoo à confirmer' }
  const number = refs.find(r => /^\d{4}\/\d{2}\/\d+/.test(String(r))) || root.invoice_number || null
  const now = new Date().toISOString()
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
  return { settled: true }
}
