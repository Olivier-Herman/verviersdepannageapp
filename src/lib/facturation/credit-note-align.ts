// src/lib/facturation/credit-note-align.ts
//
// La référence d'une note de crédit CONTIENT en entier celle de la facture qu'elle crédite (la
// référence du dossier de l'assistance), et elle porte le même véhicule (Olivier 07/10/2026).
// « Extourne de : <facture>, <motif> » peut rester ; si la référence de la facture n'y est pas,
// elle est ajoutée à la suite.
import { odooRpcCompany } from '@/lib/odoo'

export async function alignCreditNotes(company: number, originalId: number, creditNoteIds?: number[]): Promise<void> {
  const [o] = await odooRpcCompany<any[]>(company, 'account.move', 'read', [[originalId]], { fields: ['ref', 'x_studio_plaque_1', 'reversal_move_ids'] })
  const ids = creditNoteIds?.length ? creditNoteIds : (o?.reversal_move_ids || [])
  if (!o || !ids.length) return
  const ncs = await odooRpcCompany<any[]>(company, 'account.move', 'read', [ids], { fields: ['id', 'move_type', 'ref', 'x_studio_plaque_1'] })
  for (const n of ncs.filter(n => n.move_type === 'out_refund' || n.move_type === 'in_refund')) {
    const patch: Record<string, any> = {}
    const ref = String(o.ref || '').trim()
    if (ref && !String(n.ref || '').includes(ref)) patch.ref = n.ref ? `${n.ref} · ${ref}` : ref
    if (o.x_studio_plaque_1 && n.x_studio_plaque_1?.[0] !== o.x_studio_plaque_1[0]) patch.x_studio_plaque_1 = o.x_studio_plaque_1[0]
    if (Object.keys(patch).length) await odooRpcCompany(company, 'account.move', 'write', [[n.id], patch])
  }
}
