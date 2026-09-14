// src/lib/facturation/freeze-collected.ts
//
// « UNE FOIS QUE LE CLIENT A PAYÉ PAR L'ENCAISSEMENT CHAUFFEUR, LE PRIX NE PEUT
// PLUS VARIER » (Olivier 14/09/2026).
//
// 14HKB1 : le chauffeur a annoncé et encaissé 313,97 € TVAC un dimanche (10 km
// depuis le dépôt retenu à ce moment). Rien n'a été écrit. Le lendemain, le cron
// a recalculé avec l'autre dépôt (18 km) et la facturation affichait 329,94 €.
// Même moteur, entrées différentes, aucune mémorisation.
//
// Ici, à l'encaissement, on FIGE les lignes de facturation au montant payé :
//   • Siabis : on garde le DÉTAIL (prise en charge, km, balisage) — les km sont
//     déduits du montant payé quand le calcul du moment ne le reproduit pas ;
//   • sinon : une ligne « suivant montant encaissé ».
// Le brouillon persistant (mission_invoice_drafts) a la priorité sur tout dans
// actionLines ; le montant à réclamer devient manuel (souverain) en ceinture et
// bretelles ; estimated_htva est aligné. Le journal dit ce qui a été figé.
//
// Paiement PARTIEL (acompte, solde au bureau) : on ne fige rien — le montant
// annoncé reste la référence.

import { createAdminClient } from '@/lib/supabase'
import { sncLines, linesTotal } from '@/lib/dossier/lines'

const TVA = 1.21
const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000

export interface FreezeResult { frozen: boolean; reason?: string; lines?: any[]; htva?: number }

export async function freezeCollectedPrice(missionId: string, actorId: string | null = null): Promise<FreezeResult> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('*').eq('id', missionId).maybeSingle()
  if (!m) return { frozen: false, reason: 'fiche introuvable' }
  const paid = Number((m as any).payment_amount || 0)
  if (!(paid > 0)) return { frozen: false, reason: 'aucun encaissement' }
  if ((m as any).special_tarif_htva != null && Number((m as any).special_tarif_htva) > 0) return { frozen: false, reason: 'tarif spécial déjà posé' }
  if ((m as any).invoice_odoo_id || (m as any).invoice_number) return { frozen: false, reason: 'déjà facturée' }
  const announced = Number((m as any).amount_to_collect || 0)
  if (announced > 0 && paid + 0.01 < announced) return { frozen: false, reason: `paiement partiel (${paid} € sur ${announced} €)` }

  const paidHt = r4(paid / TVA)
  const ref = (m as any).external_id || (m as any).dossier_number || `M-${missionId.slice(0, 8)}`
  let lines: any[] | null = null
  let how = ''

  // ── Siabis : conserver le détail ────────────────────────────────────────
  const isSiabis = ['police_snc', 'sia_couvert'].includes(String((m as any).source || ''))
  if (isSiabis && (m as any).snc_scenario) {
    const calc = await sncLines(m).catch(() => null)
    if (calc && calc.length) {
      const total = linesTotal(calc)
      if (Math.abs(r2(total * TVA) - r2(paid)) < 0.02) {
        lines = calc; how = 'détail Siabis du moment (identique au montant encaissé)'
      } else {
        // Le calcul du moment ne reproduit pas ce qui a été payé (autre dépôt,
        // autre itinéraire) : on déduit les km du montant payé, en gardant la
        // prise en charge et le tarif km du calcul.
        const kmIdx = calc.findIndex(l => /kilom/i.test(l.name) && Number(l.price_unit) > 0)
        if (kmIdx >= 0) {
          const km = calc[kmIdx]
          const others = calc.filter((_, i) => i !== kmIdx)
          const reste = paidHt - linesTotal(others)
          const qty = Math.round(reste / Number(km.price_unit))
          if (qty > 0 && Math.abs(r2((linesTotal(others) + qty * Number(km.price_unit)) * TVA) - r2(paid)) < 0.02) {
            lines = calc.map((l, i) => i === kmIdx ? { ...l, qty } : l)
            how = `détail Siabis avec ${qty} km déduits du montant encaissé (le calcul du jour donnait ${km.qty} km)`
          }
        }
      }
    }
  }
  if (!lines) {
    lines = [{ kind: 'SERV-DIV', name: `Intervention suivant montant encaissé — ${ref}`, qty: 1, price_unit: paidHt }]
    how = 'une ligne au montant encaissé'
  }

  const now = new Date().toISOString()
  const { error: e1 } = await sb.from('mission_invoice_drafts').upsert(
    { mission_id: missionId, lines, updated_at: now, updated_by: actorId },
    { onConflict: 'mission_id' },
  )
  if (e1) return { frozen: false, reason: `brouillon : ${e1.message}` }
  const htva = r2(linesTotal(lines))
  await sb.from('incoming_missions').update({
    amount_to_collect: r2(paid), amount_to_collect_manual: true,
    estimated_htva: htva, estimated_htva_at: now, updated_at: now,
  }).eq('id', missionId)
  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: actorId, action: 'price_frozen_on_payment',
    notes: `Prix figé à l'encaissement : ${r2(paid).toFixed(2)} € TVAC (${htva.toFixed(2)} € HTVA) — ${how}`,
    metadata: { paid, htva, lines, how },
  }).then(() => {}, () => {})
  return { frozen: true, lines, htva }
}
