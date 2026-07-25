// src/app/api/francofolies/set-payment/route.ts
//
// Correction du MODE DE PAIEMENT d'un enlèvement Francofolies (superadmin).
//
// Le mode est stocké à deux endroits qu'on garde synchronisés :
//   - incoming_missions.payment_method  (la fiche, source du registre)
//   - interventions.payment_mode        (l'encaissement chauffeur lié)
//
// Le libellé « Payé / Pas payé / À vérifier » du registre DÉRIVE de
// payment_method (cf /api/francofolies/picked) → rien d'autre à toucher.
// Passer en 'unpaid' remet amount_collected à 0 (cohérent avec l'enlèvement).
//
// Olivier 2026-07-25.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

// Modes proposés à la correction (mêmes valeurs que l'encodage d'enlèvement).
const MODES = new Set(['cash', 'bancontact', 'sumup', 'qr_transfer', 'unpaid'])

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const missionId = String(body?.mission_id || '')
  const mode      = String(body?.payment_mode || '')
  if (!missionId || !MODES.has(mode)) {
    return NextResponse.json({ error: 'mission_id + payment_mode valide requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Fiche : mode + (si non payé) montant encaissé remis à 0.
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, amount_to_collect, payment_method')
    .eq('id', missionId)
    .maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

  const before = (mission as any).payment_method || null
  const upd: Record<string, any> = { payment_method: mode }
  upd.amount_collected = mode === 'unpaid' ? 0 : ((mission as any).amount_to_collect ?? 0)

  const { error: e1 } = await sb.from('incoming_missions').update(upd).eq('id', missionId)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // Encaissement(s) chauffeur lié(s) : même mode.
  await sb.from('interventions')
    .update({ payment_mode: mode })
    .eq('mission_id', missionId)
    .eq('service_type', 'encaissement')
    .then(() => {}, () => {})

  // Traçabilité.
  await sb.from('mission_logs').insert({
    mission_id: missionId,
    action:     'francofolies_payment_mode_changed',
    metadata:   { from: before, to: mode, by: (session.user as any)?.email || null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, payment_method: mode })
}
