// Cron de nuit : relève, pour chaque expéditeur, le dossier où on range d'habitude ses mails
// (classement appris de l'agent mail, Olivier 06/10/2026). Les choix d'Olivier ne sont jamais écrasés.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { TRIAGE_MAILBOXES }  from '@/lib/mail-agent'
import { learnSenderFolders } from '@/lib/mail-agent/learned'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const out: Record<string, any> = {}
  for (const mb of TRIAGE_MAILBOXES) {
    try { out[mb] = await learnSenderFolders(sb, mb) } catch (e: any) { out[mb] = { error: e?.message || String(e) } }
  }
  const failed = Object.values(out).some((r: any) => r?.error)
  return NextResponse.json({ ok: !failed, ...out }, { status: failed ? 500 : 200 })
}
