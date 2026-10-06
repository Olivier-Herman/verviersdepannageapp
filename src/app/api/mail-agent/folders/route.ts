// GET /api/mail-agent/folders?mailbox=… — dossiers de rangement d'une boîte, pour « Classer dans… »
// (classement appris, Olivier 06/10/2026).
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { TRIAGE_MAILBOXES }  from '@/lib/mail-agent'
import { filingFolders }     from '@/lib/mail-agent/learned'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['admin', 'superadmin', 'mail_agent'] }).ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const mailbox = new URL(req.url).searchParams.get('mailbox') || ''
  if (!TRIAGE_MAILBOXES.map(m => m.toLowerCase()).includes(mailbox.toLowerCase())) return NextResponse.json({ error: 'Boîte inconnue' }, { status: 400 })
  try { return NextResponse.json({ folders: await filingFolders(mailbox) }) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Lecture des dossiers impossible' }, { status: 502 }) }
}
