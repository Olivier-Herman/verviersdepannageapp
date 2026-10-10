// src/lib/espace/documents.ts
//
// Documents téléchargeables dans l'espace client (Olivier 10/10/2026) :
//   - le rapport d'intervention, dès que la mission est terminée (même PDF que celui joint à la facture) ;
//   - la facture, seulement une fois validée ET envoyée (Peppol ou mail) — jamais un brouillon.

import { createAdminClient } from '@/lib/supabase'
import { odooRpc } from '@/lib/odoo'
import { resolveMissionDocsBatch } from '@/lib/garage/mission-documents'
import { isRelivraison } from '@/lib/missions/mission-types'

export interface FactureClient { id: number; numero: string }
export interface DocsClient { facture: FactureClient | null; avoir: FactureClient | null }

/** Facture et note de crédit validées ET envoyées, par mission (un seul aller-retour par lot). */
export async function documentsEnvoyes(missions: any[]): Promise<Map<string, DocsClient>> {
  const out = new Map<string, DocsClient>()
  const docs = await resolveMissionDocsBatch(missions.map(m => ({ id: m.id, odoo_quote_id: m.odoo_quote_id, invoice_odoo_id: m.invoice_odoo_id })))
  const ids = [...new Set([...docs.values()].flatMap(d => [d.invoice?.id, d.creditNote?.id]).filter((x): x is number => !!x))]
  if (!ids.length) return out
  let moves: any[] = []
  try { moves = await odooRpc<any[]>('account.move', 'read', [ids], { fields: ['id', 'name', 'state', 'is_move_sent', 'peppol_move_state'] }) } catch { return out }
  const ok = new Map(moves.filter(v => v.state === 'posted' && (v.is_move_sent || ['processing', 'done'].includes(String(v.peppol_move_state || '')))).map(v => [v.id, v]))
  for (const m of missions) {
    const d = docs.get(m.id)
    const f = d?.invoice && ok.get(d.invoice.id), a = d?.creditNote && ok.get(d.creditNote.id)
    if (f || a) out.set(m.id, { facture: f ? { id: f.id, numero: f.name } : null, avoir: a ? { id: a.id, numero: a.name } : null })
  }
  return out
}

/** Compatibilité : factures seules. */
export async function facturesEnvoyees(missions: any[]): Promise<Map<string, FactureClient>> {
  const out = new Map<string, FactureClient>()
  for (const [k, v] of await documentsEnvoyes(missions)) if (v.facture) out.set(k, v.facture)
  return out
}

/** Missions couvertes par le rapport : la mission et sa relivraison éventuelle. */
export async function idsRapport(m: { id: string; mission_type: string | null; parent_mission_id: string | null }): Promise<string[]> {
  const ids = [m.id]
  if (isRelivraison(m.mission_type) && m.parent_mission_id) ids.push(m.parent_mission_id)
  else {
    const { data: rel } = await createAdminClient().from('incoming_missions').select('id').eq('parent_mission_id', m.id).ilike('mission_type', 'relivraison').neq('status', 'cancelled').limit(1)
    if (rel?.[0]) ids.push(rel[0].id)
  }
  return ids
}
