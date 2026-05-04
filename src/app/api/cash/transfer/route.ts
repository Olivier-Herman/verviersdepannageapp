// src/app/api/cash/transfer/route.ts
//
// POST /api/cash/transfer { receiver_id, amount, notes? }
//   Crée une demande de transfert en pending, envoie une notif push au receveur.
//
// GET /api/cash/transfer
//   Retourne les transferts pending impliquant le user courant (sender ou receiver).

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendPushToUser }            from '@/lib/push'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { receiver_id, amount, notes } = body
  const amt = parseFloat(amount)

  if (!receiver_id)                              return NextResponse.json({ error: 'Receveur requis' }, { status: 400 })
  if (!Number.isFinite(amt) || amt <= 0)         return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
  if (notes && notes.length > 500)               return NextResponse.json({ error: 'Notes trop longues (500 max)' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: sender } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', session.user.email)
    .single()
  if (!sender?.id) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
  if (sender.id === receiver_id) return NextResponse.json({ error: 'Impossible de se transférer à soi-même' }, { status: 400 })

  const { data: receiver } = await supabase
    .from('users')
    .select('id, name, active')
    .eq('id', receiver_id)
    .single()
  if (!receiver?.id || !receiver.active) {
    return NextResponse.json({ error: 'Receveur introuvable ou inactif' }, { status: 404 })
  }

  // Insertion de la demande
  const { data: transfer, error } = await supabase
    .from('cash_transfers')
    .insert({
      sender_id:   sender.id,
      receiver_id: receiver.id,
      amount:      amt,
      status:      'pending',
      notes:       (notes && notes.trim()) || null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notif push au receveur (best effort, ne bloque pas la création)
  try {
    await sendPushToUser(receiver.id, {
      title: 'Demande de transfert',
      body:  `${sender.name || 'Un collègue'} souhaite vous remettre ${amt.toFixed(2)} €`,
      url:   '/caisse',
      tag:   `cash-transfer-${transfer.id}`,
    })
  } catch (e: any) {
    console.error('[cash/transfer] push receveur échec:', e.message)
  }

  return NextResponse.json({ ok: true, transfer })
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: me } = await supabase
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()
  if (!me?.id) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // Pending impliquant le user (sender OU receiver), avec les noms joints
  const { data: transfers } = await supabase
    .from('cash_transfers')
    .select('id, sender_id, receiver_id, amount, status, notes, created_at, sender:users!cash_transfers_sender_id_fkey(name), receiver:users!cash_transfers_receiver_id_fkey(name)')
    .or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  return NextResponse.json({ ok: true, transfers: transfers || [], me_id: me.id })
}
