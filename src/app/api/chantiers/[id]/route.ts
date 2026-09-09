// src/app/api/chantiers/[id]/route.ts
//
// PATCH  → modifier un chantier (statut, intitulé, étiquette, note). Chaque
//          changement laisse une phrase lisible dans chantier_logs.
// DELETE → supprimer (le journal du chantier part avec, cascade).
// Superadmin. Olivier 09/09/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { CHANTIER_STATUSES, chantierStatusLabel, isSuperadminSession } from '@/lib/chantiers'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!isSuperadminSession(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const actor = (session!.user as any)?.name || (session!.user as any)?.email || null

  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const { data: before } = await sb.from('chantiers').select('id, title, tag, status, note').eq('id', params.id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })

  const upd: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: actor }
  const said: string[] = []
  if ('title' in body) { const t = String(body.title || '').trim(); if (!t) return NextResponse.json({ error: 'Intitulé requis' }, { status: 400 }); if (t !== before.title) { upd.title = t; said.push(`renommé « ${t} »`) } }
  if ('tag' in body)   { const t = String(body.tag || '').trim() || null; if (t !== before.tag) { upd.tag = t; said.push(t ? `étiquette ${t}` : 'étiquette retirée') } }
  if ('note' in body)  { const n = String(body.note || '').trim() || null; if (n !== before.note) { upd.note = n; said.push('note mise à jour') } }
  if ('status' in body) {
    const s = String(body.status || '')
    if (!(CHANTIER_STATUSES as readonly string[]).includes(s)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    if (s !== before.status) {
      upd.status = s
      // En bas de la colonne d'arrivée.
      const { data: last } = await sb.from('chantiers').select('position').eq('status', s).order('position', { ascending: false }).limit(1).maybeSingle()
      upd.position = ((last as any)?.position ?? 0) + 10
      said.push(`${chantierStatusLabel(before.status)} → ${chantierStatusLabel(s)}`)
    }
  }
  if (!said.length) return NextResponse.json({ ok: true, unchanged: true })

  const { data, error } = await sb.from('chantiers').update(upd).eq('id', params.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from('chantier_logs').insert({ chantier_id: params.id, actor, text: `${upd.title || before.title} : ${said.join(', ')}` }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, chantier: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!isSuperadminSession(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const actor = (session!.user as any)?.name || (session!.user as any)?.email || null

  const sb = createAdminClient()
  const { data: before } = await sb.from('chantiers').select('title').eq('id', params.id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })
  const { error } = await sb.from('chantiers').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Le journal du chantier est parti en cascade : on garde une trace globale.
  await sb.from('chantier_logs').insert({ chantier_id: null, actor, text: `Supprimé : ${before.title}` }).then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}
