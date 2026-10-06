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
  // Consigne en clair (Olivier 29/09/2026) : gestes compris puis validés (« Faire ça »).
  if (action === 'consigne') {
    if (item.status === 'decided') return NextResponse.json({ error: 'Ce mail est déjà traité.' }, { status: 409 })
    const steps = Array.isArray(body.steps) ? body.steps : []
    if (!steps.length) return NextResponse.json({ error: 'Aucun geste à faire.' }, { status: 400 })
    const instruction = String(body.instruction || '').trim().slice(0, 1500)
    // Identifiant périmé (mail déplacé à la main) → retrouvé avant d'agir.
    try { const { getMessageText } = await import('@/lib/mail-agent/graph'); await getMessageText(item.mailbox, item.message_id) }
    catch (e: any) { if (/404|ErrorItemNotFound/.test(e?.message || '')) { const again = await relocateMessage(item.mailbox, { receivedAt: item.received_at, fromEmail: item.from_email, subject: item.subject }); if (again) { item.message_id = again; await sb.from('mail_agent_items').update({ message_id: again }).eq('id', item.id) } } }
    const { executeMailSteps } = await import('@/lib/mail-agent/consignes')
    const out = await executeMailSteps({ sb, item, actor, actorId: access.id, mode: await getMode(sb), odooBase: process.env.ODOO_URL || '' }, steps)
    const note = out.results.map(r => `${r.ok ? '✓' : '✕'} ${r.note}`).join(' · ')
    await sb.from('mail_agent_items').update({ status: 'decided', error: out.results.some(r => !r.ok) ? note : null, extracted: { ...(item.extracted || {}), decision: { ...decision, action: 'consigne', instruction, steps, result: note, links: out.links } }, updated_at: now, applied_at: now, applied_by: actor }).eq('id', item.id)
    // Retenir la consigne pour cet expéditeur (proposée d'office la prochaine fois).
    if (body.keep !== false && instruction && item.from_email) {
      const key = String(item.from_email).trim().toLowerCase()
      const { data: prev } = await sb.from('mail_agent_rules').select('used_count').eq('sender_email', key).maybeSingle()
      await sb.from('mail_agent_rules').upsert({ sender_email: key, instruction, used_count: ((prev as any)?.used_count || 0) + 1, updated_by: access.id, updated_at: now }, { onConflict: 'sender_email' })
    }
    return NextResponse.json({ ok: true, status: 'decided', results: out.results })
  }
  // Mails Riga (Olivier 05/10/2026) : annuler un classement automatique, ou trancher un cas douteux.
  if (item.handler === 'riga' && ['remettre', 'classer_riga', 'pas_riga'].includes(action)) {
    if (action === 'pas_riga') {
      await sb.from('mail_agent_items').update({ status: 'decided', extracted: { ...(item.extracted || {}), decision: { ...decision, result: 'Pas un mail Riga : laissé dans la boîte de réception' } }, updated_at: now }).eq('id', item.id)
      return NextResponse.json({ ok: true, status: 'decided' })
    }
    const { RIGA_FOLDER } = await import('@/lib/mail-agent/riga')
    const toInbox = action === 'remettre'
    const fid = toInbox ? 'inbox' : await findOrCreateFolder(item.mailbox, RIGA_FOLDER)
    if (!fid) return NextResponse.json({ error: `Dossier « ${RIGA_FOLDER} » introuvable dans ${item.mailbox}` }, { status: 400 })
    let mv = await moveMessage(item.mailbox, item.message_id, fid)
    if (!mv.ok && /404|ErrorItemNotFound/.test(mv.error || '')) {
      const again = await relocateMessage(item.mailbox, { receivedAt: item.received_at, fromEmail: item.from_email, subject: item.subject })
      if (again) mv = await moveMessage(item.mailbox, again, fid)
    }
    if (!mv.ok) return NextResponse.json({ error: /404|ErrorItemNotFound/.test(mv.error || '') ? 'Ce mail n’est plus à cet endroit (déplacé ou supprimé à la main).' : (mv.error || 'Déplacement refusé') }, { status: 502 })
    const folder = toInbox ? 'Boîte de réception' : RIGA_FOLDER
    const result = toInbox ? 'Remis dans la boîte de réception' : `Classé dans « ${RIGA_FOLDER} »`
    await sb.from('mail_agent_items').update({ status: 'decided', mail_moved: !toInbox, ...(mv.newId ? { message_id: mv.newId } : {}), folder, extracted: { ...(item.extracted || {}), decision: { ...decision, result } }, updated_at: now }).eq('id', item.id)
    return NextResponse.json({ ok: true, status: 'decided', moved: true })
  }
  if (action === 'laisser' || action === 'fait_ailleurs') {
    await sb.from('mail_agent_items').update({ status: 'decided', extracted: { ...(item.extracted || {}), decision }, updated_at: now }).eq('id', item.id)
    return NextResponse.json({ ok: true, status: 'decided' })
  }
  if (action === 'classer') {
    const folder = String(body.folder || '')
    // Dossiers usuels (créés au besoin), ou n'importe quel dossier existant de la boîte, par son chemin :
    // classement appris, le choix est retenu pour cet expéditeur (Olivier 06/10/2026).
    const { folderIdByPath, rememberChoice } = await import('@/lib/mail-agent/learned')
    const fid = FILE_FOLDERS.includes(folder) ? await findOrCreateFolder(item.mailbox, folder) : await folderIdByPath(item.mailbox, folder)
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
    if (folder !== 'Mail auto-géré') await rememberChoice(sb, item.mailbox, item.from_email, folder).catch(() => {})
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
