// POST /api/cash/transfer/[id]/cancel
// Annulation par le SENDER, uniquement si pending. Notif push info au receiver.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendPushToUser }            from '@/lib/push'
import { formatEur }                 from '@/lib/format'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: me } = await supabase
    .from('users').select('id, name').eq('email', session.user.email).single()
  if (!me?.id) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const { data: transfer } = await supabase
    .from('cash_transfers')
    .select('id, sender_id, receiver_id, amount, status')
    .eq('id', params.id)
    .single()
  if (!transfer)                          return NextResponse.json({ error: 'Transfert introuvable' }, { status: 404 })
  if (transfer.sender_id !== me.id)       return NextResponse.json({ error: 'Réservé au demandeur' }, { status: 403 })
  if (transfer.status !== 'pending')      return NextResponse.json({ error: `Transfert déjà ${transfer.status}` }, { status: 409 })

  const { error } = await supabase
    .from('cash_transfers')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notif info au receveur
  try {
    await sendPushToUser(transfer.receiver_id, {
      title: 'Transfert annulé',
      body:  `${me.name || 'Le demandeur'} a annulé sa demande de transfert de ${formatEur(Number(transfer.amount))}`,
      url:   '/caisse',
      tag:   `cash-transfer-${transfer.id}`,
    })
  } catch (e: any) {
    console.error('[cash/transfer/cancel] push receveur échec:', e.message)
  }

  return NextResponse.json({ ok: true })
}
