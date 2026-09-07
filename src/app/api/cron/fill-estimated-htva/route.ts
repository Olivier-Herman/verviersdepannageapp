// src/app/api/cron/fill-estimated-htva/route.ts
//
// Calcule + fige le CA HTVA (tarif source : forfait + km) sur les missions
// clôturées SANS facture Odoo (auto-facturées Touring/Mondial…), pour que les
// stats « CA par chauffeur » les comptent. Petits lots (ORS = rate-limité).
// Idempotent : ne traite que estimated_htva IS NULL. Olivier 2026-07-27.

import { NextResponse }          from 'next/server'
import { createAdminClient }     from '@/lib/supabase'
import { actionLines, linesTotal } from '@/lib/dossier/lines'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const BATCH = 15   // borné : ORS ~40 req/min, chaque estimate = quelques routes

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()

  // Missions clôturées, sans facture Odoo, sans CA figé → à calculer.
  const { data: missions } = await sb.from('incoming_missions')
    .select('*')   // les constructeurs de lignes lisent la fiche complète (forcés, Siabis, brouillons)
    .in('status', ['to_invoice', 'invoiced', 'completed'])
    .is('estimated_htva', null)
    .is('odoo_quote_id', null)
    .is('invoice_odoo_id', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(BATCH)

  let computed = 0, zero = 0, skipped = 0
  const now = new Date().toISOString()
  for (const m of (missions || [])) {
    // Mêmes lignes que la facturation (brouillon > montants forcés > moteur
    // Siabis > estimation) : avant, le moteur général seul figeait 0 sur les
    // Siabis et une tranche 0 km sur les destinations non géocodées (2ESG097,
    // 57 € figés pour 310 €). Olivier 07/09/2026.
    let htva = 0, unknown = false
    try {
      const built = await actionLines(m as any, undefined, false)
      if (built.has_tariff && built.lines.length) htva = linesTotal(built.lines)
      else unknown = /kilom|géocod/i.test(String(built.reason || ''))
    } catch { htva = 0 }
    if (unknown) { skipped++; continue }   // km inconnus : on réessaiera quand la fiche aura ses coordonnées
    // On fige même 0 (estimated_htva_at) pour ne pas re-tenter en boucle.
    await sb.from('incoming_missions')
      .update({ estimated_htva: htva, estimated_htva_at: now })
      .eq('id', m.id).then(() => {}, () => {})
    if (htva > 0) computed++; else zero++
  }

  return NextResponse.json({ ok: true, processed: (missions || []).length, computed, zero, skipped, more: (missions || []).length >= BATCH })
}
