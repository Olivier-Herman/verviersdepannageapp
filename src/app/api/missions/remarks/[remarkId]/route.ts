// src/app/api/missions/remarks/[remarkId]/route.ts
//
// PATCH  /api/missions/remarks/[remarkId] → edite le texte d une remarque
//                                             (push dans edit_history)
// DELETE /api/missions/remarks/[remarkId] → supprime remarque + fichiers Storage

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email, role').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function PATCH(req: Request, { params }: { params: { remarkId: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { text?: string }
  const newText = String(body.text || '').trim()
  if (!newText) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })

  const sb = createAdminClient()

  const { data: existing, error: getErr } = await sb
    .from('mission_remarks')
    .select('id, text, edit_history, created_by, updated_by, updated_at')
    .eq('id', params.remarkId)
    .maybeSingle()
  if (getErr || !existing) return NextResponse.json({ error: 'Remarque introuvable' }, { status: 404 })

  // Olivier 2026-06-03 (audit J-2 W9) : ownership. Seul l auteur peut
  // editer sa propre remarque (sauf superadmin qui peut tout).
  if (existing.created_by !== actor.id && actor.role !== 'superadmin') {
    return NextResponse.json({
      error: 'Seul l auteur de la remarque peut la modifier (ou un superadmin)',
    }, { status: 403 })
  }

  // Push l ancien texte dans edit_history
  const history: any[] = Array.isArray(existing.edit_history) ? existing.edit_history : []
  history.push({
    at:        existing.updated_at || new Date().toISOString(),
    by:        existing.updated_by || existing.created_by,
    old_text:  existing.text,
  })

  const { data, error } = await sb
    .from('mission_remarks')
    .update({
      text:         newText,
      updated_by:   actor.id,
      updated_at:   new Date().toISOString(),
      edit_history: history,
    })
    .eq('id', params.remarkId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, remark: data })
}

export async function DELETE(_req: Request, { params }: { params: { remarkId: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Olivier 2026-06-03 (audit J-2 W9) : seul superadmin peut supprimer
  // une remarque (regle metier : auteur peut editer, superadmin peut
  // supprimer pour cas exceptionnels). Audit trail preserved.
  if (actor.role !== 'superadmin') {
    return NextResponse.json({
      error: 'Suppression remarque reservee aux superadmin',
    }, { status: 403 })
  }

  const sb = createAdminClient()

  // Suppr fichiers Storage d abord
  const { data: atts } = await sb
    .from('mission_remark_attachments')
    .select('file_path')
    .eq('remark_id', params.remarkId)

  const paths = (atts || []).map(a => a.file_path).filter(Boolean)
  if (paths.length > 0) {
    await sb.storage.from('mission-remarks').remove(paths)
  }

  const { error } = await sb.from('mission_remarks').delete().eq('id', params.remarkId)
  if (error) {
    console.error('[remarks/delete]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
