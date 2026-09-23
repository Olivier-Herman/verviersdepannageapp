// POST /api/mail-agent/[id]/decide { action, folder? }
// Décision humaine sur une carte de triage (Olivier 23/09/2026, jour 1) :
//   laisser        → l'item reste visible, marqué « laissé » ;
//   fait_ailleurs  → traité hors de l'app ;
//   classer        → le mail est déplacé dans le dossier choisi ;
// Les autres propositions (avoir, réponse, document…) arrivent au jour 2 : la
// route les refuse proprement plutôt que de faire semblant.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { findFolderIdByName, moveMessage } from '@/lib/mail-agent/graph'
import { FILE_FOLDERS } from '@/lib/mail-agent/triage'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const access = sessionAccess(session, { roles: ['admin', 'superadmin'] })
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const actor = (session!.user as any)?.name || (session!.user as any)?.email || 'inconnu'
  const sb = createAdminClient()
  const { data: item } = await sb.from('mail_agent_items').select('*').eq('id', params.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Item introuvable' }, { status: 404 })
  const now = new Date().toISOString()
  const decision = { action, by: actor, at: now, folder: body.folder || null }
  if (action === 'laisser' || action === 'fait_ailleurs') {
    await sb.from('mail_agent_items').update({ status: 'decided', extracted: { ...(item.extracted || {}), decision }, updated_at: now }).eq('id', item.id)
    return NextResponse.json({ ok: true, status: 'decided' })
  }
  if (action === 'classer') {
    const folder = String(body.folder || '')
    if (!FILE_FOLDERS.includes(folder)) return NextResponse.json({ error: 'Dossier de classement inconnu' }, { status: 400 })
    const fid = await findFolderIdByName(item.mailbox, folder)
    if (!fid) return NextResponse.json({ error: `Dossier « ${folder} » introuvable dans ${item.mailbox}` }, { status: 400 })
    const mv = await moveMessage(item.mailbox, item.message_id, fid)
    if (!mv.ok) return NextResponse.json({ error: mv.error || 'Déplacement refusé' }, { status: 502 })
    await sb.from('mail_agent_items').update({ status: 'decided', mail_moved: true, extracted: { ...(item.extracted || {}), decision }, updated_at: now }).eq('id', item.id)
    return NextResponse.json({ ok: true, status: 'decided', moved: true })
  }
  return NextResponse.json({ error: `Action « ${action} » pas encore exécutable — elle arrive au jour 2. Choisis Laisser, Fait ailleurs ou Classer.` }, { status: 400 })
}
