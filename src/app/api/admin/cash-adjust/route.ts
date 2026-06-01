// POST /api/admin/cash-adjust
// Body : { user_id: string; amount: number; notes: string }
//
// Permet a un superadmin d ajuster manuellement la caisse d un user
// (correction d ecart, remise a zero, transfert exceptionnel, etc.).
//
// Insert un mouvement dans cash_register :
//   - amount > 0  -> type 'encaissement' (credit caisse)
//   - amount < 0  -> type 'remise' (debit caisse)
//   - amount = 0  -> refus
//
// Le motif est obligatoire (min 4 caracteres) et apparait dans l historique
// de la caisse de l user, tracable.
//
// Olivier 2026-06-01. Reserve superadmin (action sensible sur shared state).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MIN_NOTES_LENGTH = 4

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = session.user as any
  if (actor.role !== 'superadmin') {
    return NextResponse.json({ error: 'Reserve superadmin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as {
    user_id?: string
    amount?:  number
    notes?:   string
  }

  const userId = (body.user_id || '').trim()
  const amount = Number(body.amount)
  const notes  = (body.notes || '').trim()

  if (!userId) return NextResponse.json({ error: 'user_id requis' }, { status: 400 })
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: 'Montant requis (positif ou negatif, non nul)' }, { status: 400 })
  }
  if (notes.length < MIN_NOTES_LENGTH) {
    return NextResponse.json({ error: `Motif obligatoire (min ${MIN_NOTES_LENGTH} caracteres)` }, { status: 400 })
  }

  const sb = createAdminClient()

  // Verifie que l user cible existe
  const { data: targetUser, error: uErr } = await sb
    .from('users')
    .select('id, name, email')
    .eq('id', userId)
    .maybeSingle()
  if (uErr || !targetUser) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
  }

  const type = amount > 0 ? 'encaissement' : 'remise'
  const absAmount = Math.abs(amount)

  // Olivier 2026-06-01 : motif prefixe explicitement "Ajustement superadmin"
  // pour que la ligne soit visible et identifiable dans l historique de l user
  // (transparence totale, pas confondu avec un encaissement / transfert normal).
  const prefixedNotes = `⚙ Ajustement superadmin — ${notes}`

  // Insert mouvement
  const { data: entry, error: insErr } = await sb
    .from('cash_register')
    .insert({
      driver_id:       userId,
      amount:          absAmount,
      type,
      intervention_id: null,
      notes:           prefixedNotes,
    })
    .select()
    .single()

  if (insErr) {
    console.error('[cash-adjust]', insErr.message)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // Log activite : tracabilite (qui a ajuste la caisse de qui, pourquoi)
  try {
    await sb.from('activity_logs').insert({
      user_id:     actor.id,
      action:      'cash_adjusted_by_superadmin',
      entity_type: 'cash_register',
      entity_id:   entry.id,
      details: {
        target_user_id:    userId,
        target_user_name:  targetUser.name,
        target_user_email: targetUser.email,
        amount_signed:     amount,
        amount_abs:        absAmount,
        type,
        notes,
      },
    })
  } catch (logErr: any) {
    console.error('[cash-adjust] activity_logs:', logErr?.message)
  }

  return NextResponse.json({
    ok: true,
    entry: {
      id: entry.id,
      type,
      amount: absAmount,
      signed_amount: amount,
      notes,
    },
  })
}
