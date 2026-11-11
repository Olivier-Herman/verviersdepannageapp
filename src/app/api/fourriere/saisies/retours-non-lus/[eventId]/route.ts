// src/app/api/fourriere/saisies/retours-non-lus/[eventId]/route.ts
//
// GET ?i=N        → le N-ième PDF du mail (lecture dans le navigateur).
// POST { action: 'attribuer', i, dossier_id, ef_id, refus? }
//                 → enregistre ce PDF comme retour signé de cet état de frais
//                   (même traitement que le dépôt manuel) et marque le mail revu.
// POST { action: 'ecarter' } → marque le mail revu sans rien enregistrer.
// P2, préversion ma_journee, Olivier 11/11/2026. Accès : admin / superadmin / module fourrière.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { getPdfAttachments } from '@/lib/requisitoire/graph'
import { FOURRIERE_MAILBOX } from '@/lib/requisitoire/intake'
import { enregistrerRetourSigne } from '@/lib/saisies/retour-signe'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

async function charger(eventId: string) {
  const sb = createAdminClient()
  const { data: ev } = await sb.from('saisie_mail_events').select('id, source_email_id, mailbox, kind, revu_at').eq('id', eventId).maybeSingle()
  return { sb, ev }
}

export async function GET(req: Request, { params }: { params: { eventId: string } }) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { ev } = await charger(params.eventId)
  if (!ev || ev.kind !== 'retour_signe') return NextResponse.json({ error: 'Mail introuvable' }, { status: 404 })
  const i = Math.max(0, Number(new URL(req.url).searchParams.get('i') || 0))
  const pdfs = await getPdfAttachments(ev.mailbox || FOURRIERE_MAILBOX, ev.source_email_id).catch(() => [])
  if (new URL(req.url).searchParams.get('liste') === '1') return NextResponse.json({ ok: true, pdfs: pdfs.map((p, k) => ({ i: k, name: p.name })) })
  const p = pdfs[i]
  if (!p) return NextResponse.json({ error: 'Pièce introuvable (mail déplacé ou supprimé ?)' }, { status: 404 })
  return new NextResponse(Buffer.from(p.contentBytes, 'base64'), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${(p.name || 'retour.pdf').replace(/"/g, '')}"`, 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request, { params }: { params: { eventId: string } }) {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { sb, ev } = await charger(params.eventId)
  if (!ev || ev.kind !== 'retour_signe') return NextResponse.json({ error: 'Mail introuvable' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const now = new Date().toISOString()

  if (body.action === 'ecarter') {
    await sb.from('saisie_mail_events').update({ revu_at: now, revu_par: acc.id }).eq('id', ev.id)
    return NextResponse.json({ ok: true })
  }
  if (body.action !== 'attribuer') return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  if (!body.dossier_id || !body.ef_id) return NextResponse.json({ error: 'État de frais à choisir' }, { status: 400 })

  const pdfs = await getPdfAttachments(ev.mailbox || FOURRIERE_MAILBOX, ev.source_email_id).catch(() => [])
  const p = pdfs[Math.max(0, Number(body.i || 0))]
  if (!p) return NextResponse.json({ error: 'Pièce introuvable (mail déplacé ou supprimé ?)' }, { status: 404 })
  const r = await enregistrerRetourSigne(sb, {
    dossierId: String(body.dossier_id), efId: String(body.ef_id), contenu: new Uint8Array(Buffer.from(p.contentBytes, 'base64')),
    nom: p.name || 'retour.pdf', refus: body.refus === true, userId: acc.id, origine: 'retour par mail attribué à la main',
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  // Le mail peut contenir d'autres pages : il reste dans la file tant qu'on ne l'écarte pas.
  if (body.dernier === true) await sb.from('saisie_mail_events').update({ revu_at: now, revu_par: acc.id }).eq('id', ev.id)
  return NextResponse.json({ ok: true, numero: r.numero, deposit: r.deposit })
}
