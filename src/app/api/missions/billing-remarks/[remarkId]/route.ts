// src/app/api/missions/billing-remarks/[remarkId]/route.ts
//
// PATCH  /api/missions/billing-remarks/[remarkId] → édite le texte (edit_history)
// DELETE /api/missions/billing-remarks/[remarkId] → supprime la remarque
//
// Même modèle que /api/missions/remarks/[remarkId], sans pièces jointes.
// Édition : auteur ou superadmin. Suppression : auteur ou superadmin.

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
  const { data: existing } = await sb
    .from('mission_billing_remarks')
    .select('id, text, edit_history, created_by, updated_by, updated_at')
    .eq('id', params.remarkId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Remarque introuvable' }, { status: 404 })

  if (existing.created_by !== actor.id && actor.role !== 'superadmin') {
    return NextResponse.json({ error: 'Seul l\'auteur de la remarque peut la modifier (ou un superadmin)' }, { status: 403 })
  }

  const history: any[] = Array.isArray(existing.edit_history) ? existing.edit_history : []
  history.push({ at: existing.updated_at || new Date().toISOString(), by: existing.updated_by || existing.created_by, old_text: existing.text })

  const { data, error } = await sb
    .from('mission_billing_remarks')
    .update({ text: newText, updated_by: actor.id, updated_at: new Date().toISOString(), edit_history: history })
    .eq('id', params.remarkId)
    .select(`
      id, text, created_at, updated_at, edit_history,
      author:users!created_by(id, name, email),
      editor:users!updated_by(id, name, email)
    `)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, remark: data })
}

export async function DELETE(_req: Request, { params }: { params: { remarkId: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: existing } = await sb
    .from('mission_billing_remarks')
    .select('id, created_by')
    .eq('id', params.remarkId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Remarque introuvable' }, { status: 404 })

  if (existing.created_by !== actor.id && actor.role !== 'superadmin') {
    return NextResponse.json({ error: 'Seul l\'auteur de la remarque peut la supprimer (ou un superadmin)' }, { status: 403 })
  }

  const { error } = await sb.from('mission_billing_remarks').delete().eq('id', params.remarkId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
