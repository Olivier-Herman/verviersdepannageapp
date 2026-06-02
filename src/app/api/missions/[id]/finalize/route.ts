// POST /api/missions/[id]/finalize
//
// Bascule une mission de awaiting_payment=true vers awaiting_payment=false
// + declenche les hooks externes (queue TowSoft, Helpdesk Odoo, email,
// GitHub dispatch) en relisant les draft_params snapshotes a la creation.
//
// Cette route est appelee quand le chauffeur a fini d encaisser le solde
// complet d une mission en mode draft (cf /api/missions/police/draft).
//
// Olivier 2026-06-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const missionId = params.id
  if (!missionId) return NextResponse.json({ error: 'missionId requis' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: mission, error: getErr } = await supabase
    .from('incoming_missions')
    .select('id, awaiting_payment, amount_to_collect, payment_amount, draft_params, status')
    .eq('id', missionId)
    .maybeSingle()

  if (getErr || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  if (!mission.awaiting_payment) {
    return NextResponse.json({ error: 'Mission deja finalisee' }, { status: 400 })
  }

  const required = Number(mission.amount_to_collect || 0)
  const paid     = Number(mission.payment_amount    || 0)

  // Tolerance 1 centime (arrondi flottant possible)
  if (required > 0 && paid + 0.01 < required) {
    return NextResponse.json({
      error: 'Solde restant a encaisser',
      required,
      paid,
      remaining: Math.max(0, required - paid),
    }, { status: 400 })
  }

  // Update awaiting_payment=false. Les hooks externes (queue TowSoft, Helpdesk
  // Odoo, email, GH dispatch) ne sont PAS encore declenches automatiquement
  // ici — voir TODO ci-dessous. Pour cette iteration, la mission devient
  // simplement visible cote dispatch qui peut l envoyer manuellement.
  //
  // TODO Olivier (iteration suivante) : factoriser la logique de hooks de
  // /api/towsoft/create en un helper reutilisable + l appeler ici en relisant
  // draft_params pour reconstruire les params POST.
  const { error: updErr } = await supabase
    .from('incoming_missions')
    .update({
      awaiting_payment: false,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', missionId)

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok:        true,
    missionId,
    finalized: true,
  })
}
