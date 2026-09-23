// src/app/api/cron/mail-agent-digest/route.ts
//
// Chaque matin ouvrable à 8 h 30 (Bruxelles) : « N mails attendent une
// décision » aux décideurs (admin / superadmin). Olivier 23/09/2026, jour 3.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const [{ count: toDecide }, { count: ready }, { count: toVerify }] = await Promise.all([
    sb.from('mail_agent_items').select('id', { count: 'exact', head: true }).eq('status', 'to_decide'),
    sb.from('mail_agent_items').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
    sb.from('mail_agent_items').select('id', { count: 'exact', head: true }).eq('status', 'to_verify'),
  ])
  const total = (toDecide || 0) + (ready || 0)
  if (!total) return NextResponse.json({ ok: true, sent: 0, toDecide, ready, toVerify })
  const parts = [toDecide ? `${toDecide} à décider` : null, ready ? `${ready} rejet${ready > 1 ? 's' : ''} à valider` : null, toVerify ? `${toVerify} à vérifier` : null].filter(Boolean).join(' · ')
  const res = await sendNotificationToRoles(['admin', 'superadmin'], 'mail_agent_digest', {
    title:      `📬 Courrier : ${total} décision${total > 1 ? 's' : ''} en attente`,
    body:       parts,
    action_url: '/mail-agent',
  })
  return NextResponse.json({ ok: true, ...res, toDecide, ready, toVerify })
}
