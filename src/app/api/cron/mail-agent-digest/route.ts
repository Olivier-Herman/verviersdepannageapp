// src/app/api/cron/mail-agent-digest/route.ts
//
// Chaque matin ouvrable à 8 h 30 (Bruxelles) : « N mails attendent une
// décision » aux décideurs (admin / superadmin). Olivier 23/09/2026, jour 3.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { withAiContext } from '@/lib/ai/usage'
export const dynamic = 'force-dynamic'
async function handleGET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const [{ count: toDecide }, { count: ready }, { count: toVerify }] = await Promise.all([
    sb.from('mail_agent_items').select('id', { count: 'exact', head: true }).eq('status', 'to_decide'),
    sb.from('mail_agent_items').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
    sb.from('mail_agent_items').select('id', { count: 'exact', head: true }).eq('status', 'to_verify'),
  ])
  // Mails qu'aucun module ne prend (aiguillage du 08/10/2026) : reçus depuis le dernier résumé.
  const since = new Date(Date.now() - 3 * 86400_000).toISOString()
  const { data: orphans } = await sb.from('mail_agent_items').select('subject, from_email').eq('status', 'skipped').like('blocked_reason', '→ Aucun module%').gte('created_at', since).order('created_at', { ascending: false }).limit(20)
  const nOrphans = (orphans || []).length
  const total = (toDecide || 0) + (ready || 0)
  if (!total && !nOrphans) return NextResponse.json({ ok: true, sent: 0, toDecide, ready, toVerify })
  const parts = [toDecide ? `${toDecide} à décider` : null, ready ? `${ready} rejet${ready > 1 ? 's' : ''} à valider` : null, toVerify ? `${toVerify} à vérifier` : null,
    nOrphans ? `${nOrphans} non pris en charge (restés dans la boîte) : ${(orphans || []).slice(0, 3).map((o: any) => `« ${String(o.subject || '').slice(0, 40)} »`).join(', ')}${nOrphans > 3 ? '…' : ''}` : null].filter(Boolean).join(' · ')
  const res = await sendNotificationToRoles(['admin', 'superadmin'], 'mail_agent_digest', {
    title:      total ? `📬 Courrier : ${total} décision${total > 1 ? 's' : ''} en attente` : `📬 Courrier : ${nOrphans} mail${nOrphans > 1 ? 's' : ''} non pris en charge`,
    body:       parts,
    action_url: '/mail-agent',
  })
  return NextResponse.json({ ok: true, ...res, toDecide, ready, toVerify })
}


// Les appels d'IA de ce passage sont comptés sous « cron:mail-agent-digest » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:mail-agent-digest' }, () => handleGET(...args))
}
