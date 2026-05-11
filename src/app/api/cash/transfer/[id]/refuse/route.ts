// POST /api/cash/transfer/[id]/refuse
// Refus par le RECEIVER, uniquement si pending. Notif push au sender.

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
  if (!transfer)                       return NextResponse.json({ error: 'Transfert introuvable' }, { status: 404 })
  if (transfer.receiver_id !== me.id)  return NextResponse.json({ error: 'Réservé au receveur' }, { status: 403 })
  if (transfer.status !== 'pending')   return NextResponse.json({ error: `Transfert déjà ${transfer.status}` }, { status: 409 })

  const { error } = await supabase
    .from('cash_transfers')
    .update({ status: 'refused', resolved_at: new Date().toISOString() })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notif au sender
  try {
    await sendPushToUser(transfer.sender_id, {
      title: 'Transfert refusé',
      body:  `${me.name || 'Le receveur'} a refusé votre transfert de ${formatEur(Number(transfer.amount))}`,
      url:   '/caisse',
      tag:   `cash-transfer-${transfer.id}`,
    })
  } catch (e: any) {
    console.error('[cash/transfer/refuse] push sender échec:', e.message)
  }

  return NextResponse.json({ ok: true })
}
