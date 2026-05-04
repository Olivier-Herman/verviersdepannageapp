// POST /api/cash/transfer/[id]/validate
// Validation par le RECEIVER, uniquement si pending.
//   1. Appel RPC atomique transfer_cash_atomic (débit + crédit en transaction).
//   2. Notif push au sender (validation OK).
//   3. Si solde sender négatif APRÈS transfert → alerte mail (info@olivierherman.be) + push (mobi@verviersdepannage.be).

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendPushToUser }            from '@/lib/push'
import { sendEmail }                 from '@/lib/emails'

const NOTIFY_EMAIL    = (process.env.TOWSOFT_ERROR_NOTIFY_EMAIL    || 'info@olivierherman.be').trim()
const PUSH_USER_EMAIL = (process.env.TOWSOFT_ERROR_PUSH_USER_EMAIL || NOTIFY_EMAIL).trim()
const APP_URL         = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'

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

  // ── Appel RPC atomique ──────────────────────────────────────
  const { data: rpcResult, error: rpcError } = await supabase.rpc('transfer_cash_atomic', {
    p_transfer_id: transfer.id,
  })
  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 })
  if (!rpcResult?.ok) return NextResponse.json({ error: rpcResult?.error || 'RPC failed', rpcResult }, { status: 500 })

  const balanceBefore   = Number(rpcResult.sender_balance_before)
  const balanceAfter    = Number(rpcResult.sender_balance_after)
  const alertNegative   = !!rpcResult.alert_negative_balance

  // Récupérer noms pour notifs / mail
  const { data: senderRow } = await supabase
    .from('users').select('id, name, email').eq('id', transfer.sender_id).single()

  // Notif push au sender (best effort)
  try {
    await sendPushToUser(transfer.sender_id, {
      title: 'Transfert validé',
      body:  `${me.name || 'Le receveur'} a accepté votre transfert de ${Number(transfer.amount).toFixed(2)} €`,
      url:   '/caisse',
      tag:   `cash-transfer-${transfer.id}`,
    })
  } catch (e: any) {
    console.error('[cash/transfer/validate] push sender échec:', e.message)
  }

  // ── Alerte écart de caisse si solde négatif ─────────────────
  if (alertNegative) {
    const ecart = Math.abs(balanceAfter)  // = montant non encodé Odoo

    // Mail (best effort)
    sendEmail(
      NOTIFY_EMAIL,
      '[VD Caisse] Solde négatif après transfert',
      `
        <div style="font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;max-width:600px;padding:20px">
          <h2 style="color:#cc2222;margin:0 0 16px">⚠️ Écart de caisse détecté</h2>
          <p>Un transfert vient d'être validé et le solde du donneur est devenu négatif.</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 12px;color:#666"><b>Donneur :</b></td><td style="padding:6px 12px">${senderRow?.name || '?'} (${senderRow?.email || '?'})</td></tr>
            <tr><td style="padding:6px 12px;color:#666"><b>Receveur :</b></td><td style="padding:6px 12px">${me.name || '?'} (${session.user.email})</td></tr>
            <tr><td style="padding:6px 12px;color:#666"><b>Montant transféré :</b></td><td style="padding:6px 12px">${Number(transfer.amount).toFixed(2)} €</td></tr>
            <tr><td style="padding:6px 12px;color:#666"><b>Solde avant :</b></td><td style="padding:6px 12px">${balanceBefore.toFixed(2)} €</td></tr>
            <tr><td style="padding:6px 12px;color:#666"><b>Solde après :</b></td><td style="padding:6px 12px;color:#cc2222"><b>${balanceAfter.toFixed(2)} €</b></td></tr>
            <tr><td style="padding:6px 12px;color:#666"><b>Écart probable :</b></td><td style="padding:6px 12px;color:#cc2222"><b>${ecart.toFixed(2)} €</b> non encodés en Odoo</td></tr>
          </table>
          <p style="font-size:13px;color:#666">Cause typique : un encaissement physique a été effectué par le donneur sans avoir été encodé en paiement Odoo (donc pas remonté par le cron sync).</p>
          <p><a href="${APP_URL}/admin/cash" style="color:#cc2222;font-weight:600">→ Vérifier dans l'admin Caisse</a></p>
        </div>
      `
    ).catch(e => console.error('[cash/transfer/validate] alert mail échec:', e.message))

    // Push web vers le superadmin
    ;(async () => {
      try {
        const { data: pushUser } = await supabase
          .from('users').select('id').ilike('email', PUSH_USER_EMAIL).maybeSingle()
        if (pushUser?.id) {
          await sendPushToUser(pushUser.id, {
            title: '⚠️ Solde négatif détecté',
            body:  `${senderRow?.name || 'Un user'} a transféré ${Number(transfer.amount).toFixed(2)}€ → solde ${balanceAfter.toFixed(2)}€. À investiguer.`,
            url:   '/admin/cash',
            tag:   'cash-negative-balance',
          })
        }
      } catch (e: any) {
        console.error('[cash/transfer/validate] alert push échec:', e.message)
      }
    })()
  }

  return NextResponse.json({
    ok:                     true,
    sender_movement_id:     rpcResult.sender_movement_id,
    receiver_movement_id:   rpcResult.receiver_movement_id,
    sender_balance_before:  balanceBefore,
    sender_balance_after:   balanceAfter,
    alert_negative_balance: alertNegative,
  })
}
