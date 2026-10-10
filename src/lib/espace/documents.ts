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

/** Factures envoyées, par mission (un seul aller-retour par lot). */
export async function facturesEnvoyees(missions: any[]): Promise<Map<string, FactureClient>> {
  const out = new Map<string, FactureClient>()
  const docs = await resolveMissionDocsBatch(missions.map(m => ({ id: m.id, odoo_quote_id: m.odoo_quote_id, invoice_odoo_id: m.invoice_odoo_id })))
  const ids = [...new Set([...docs.values()].map(d => d.invoice?.id).filter((x): x is number => !!x))]
  if (!ids.length) return out
  let moves: any[] = []
  try { moves = await odooRpc<any[]>('account.move', 'read', [ids], { fields: ['id', 'name', 'state', 'is_move_sent', 'peppol_move_state', 'payment_state'] }) } catch { return out }
  const ok = new Map(moves.filter(v => v.state === 'posted' && (v.is_move_sent || ['processing', 'done'].includes(String(v.peppol_move_state || '')))).map(v => [v.id, v]))
  for (const m of missions) {
    const inv = docs.get(m.id)?.invoice
    const v = inv && ok.get(inv.id)
    if (v) out.set(m.id, { id: v.id, numero: v.name })
  }
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
