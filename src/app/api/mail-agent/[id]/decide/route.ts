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
import { findOrCreateFolder, moveMessage, relocateMessage } from '@/lib/mail-agent/graph'
import { FILE_FOLDERS } from '@/lib/mail-agent/triage'
import { executeDecision } from '@/lib/mail-agent/actions'
import { getMode } from '@/lib/mail-agent'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const access = sessionAccess(session, { roles: ['admin', 'superadmin', 'mail_agent'] })
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const actor = (session!.user as any)?.name || (session!.user as any)?.email || 'inconnu'
  const sb = createAdminClient()
  const { data: item } = await sb.from('mail_agent_items').select('*').eq('id', params.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Item introuvable' }, { status: 404 })
  const now = new Date().toISOString()
  const decision = { action, by: actor, at: now, folder: body.folder || null, instruction: typeof body.instruction === 'string' && body.instruction.trim() ? body.instruction.trim().slice(0, 1000) : null }
  if (action === 'laisser' || action === 'fait_ailleurs') {
    await sb.from('mail_agent_items').update({ status: 'decided', extracted: { ...(item.extracted || {}), decision }, updated_at: now }).eq('id', item.id)
    return NextResponse.json({ ok: true, status: 'decided' })
  }
  if (action === 'classer') {
    const folder = String(body.folder || '')
    if (!FILE_FOLDERS.includes(folder)) return NextResponse.json({ error: 'Dossier de classement inconnu' }, { status: 400 })
    const fid = await findOrCreateFolder(item.mailbox, folder)
    if (!fid) return NextResponse.json({ error: `Impossible de trouver ou créer le dossier « ${folder} » dans ${item.mailbox}` }, { status: 400 })
    let mv = await moveMessage(item.mailbox, item.message_id, fid)
    // Mail déplacé à la main dans Outlook depuis la lecture : son identifiant a
    // changé. On le retrouve (expéditeur + heure + sujet) et on réessaie.
    if (!mv.ok && /404|ErrorItemNotFound/.test(mv.error || '')) {
      const again = await relocateMessage(item.mailbox, { receivedAt: item.received_at, fromEmail: item.from_email, subject: item.subject })
      if (again) mv = await moveMessage(item.mailbox, again, fid)
    }
    if (!mv.ok) return NextResponse.json({ error: /404|ErrorItemNotFound/.test(mv.error || '') ? 'Ce mail n’est plus dans la boîte (supprimé ?) : utilisez « Fait ailleurs » pour retirer la carte.' : (mv.error || 'Déplacement refusé') }, { status: 502 })
    // Nouvel identifiant après déplacement : on le garde, sinon le scan
    // suivant reprend le mail pour une nouvelle carte.
    await sb.from('mail_agent_items').update({ status: 'decided', mail_moved: true, ...(mv.newId ? { message_id: mv.newId, folder } : {}), extracted: { ...(item.extracted || {}), decision }, updated_at: now }).eq('id', item.id)
    return NextResponse.json({ ok: true, status: 'decided', moved: true })
  }
  // Jour 2 : les actions métier. Résultat tracé sur l'item ; le mail est classé
  // dans « Mail auto-géré » quand le geste a abouti.
  const mode = await getMode(sb)
  // Mail déplacé à la main depuis la lecture : identifiant périmé → on le retrouve
  // avant d'agir (brouillon de réponse, pièces jointes…). 29/09/2026.
  try {
    const { getMessageText } = await import('@/lib/mail-agent/graph')
    await getMessageText(item.mailbox, item.message_id)
  } catch (e: any) {
    if (/404|ErrorItemNotFound/.test(e?.message || '')) {
      const again = await relocateMessage(item.mailbox, { receivedAt: item.received_at, fromEmail: item.from_email, subject: item.subject })
      if (again) { item.message_id = again; await sb.from('mail_agent_items').update({ message_id: again, updated_at: now }).eq('id', item.id) }
    }
  }
  const res = await executeDecision({ sb, item, actor, mode, odooBase: process.env.ODOO_URL || '' }, action, { invoice: body.invoice || null, company: body.company || null, instruction: typeof body.instruction === 'string' ? body.instruction.slice(0, 1000) : null })
  if (!res.ok) {
    await sb.from('mail_agent_items').update({ error: res.error || 'échec', updated_at: now }).eq('id', item.id)
    return NextResponse.json({ error: res.error || 'échec' }, { status: 400 })
  }
  let moved = false
  let newId: string | undefined
  if (action !== 'encoder') { try { const fid = await findOrCreateFolder(item.mailbox, 'Mail auto-géré'); if (fid) {
    let mv = await moveMessage(item.mailbox, item.message_id, fid)
    if (!mv.ok && /404|ErrorItemNotFound/.test(mv.error || '')) { const again = await relocateMessage(item.mailbox, { receivedAt: item.received_at, fromEmail: item.from_email, subject: item.subject }); if (again) mv = await moveMessage(item.mailbox, again, fid) }
    moved = mv.ok; newId = mv.newId } } catch {} }
  await sb.from('mail_agent_items').update({ status: 'decided', mail_moved: moved || action === 'encoder', ...(newId ? { message_id: newId, folder: 'Mail auto-géré' } : {}), error: null, extracted: { ...(item.extracted || {}), decision: { ...decision, result: res.note, links: res.links || [] } }, updated_at: now, applied_at: now, applied_by: actor }).eq('id', item.id)
  return NextResponse.json({ ok: true, status: 'decided', note: res.note, links: res.links || [] })
}
