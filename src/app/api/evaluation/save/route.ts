// POST /api/evaluation/save
// Sauvegarde l evaluation d une fonction par un utilisateur (upsert).
// Olivier 2026-05-28.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const body = await req.json()
  const {
    function_id,
    function_label,
    status,
    ux_rating,
    ui_rating,
    comment,
    suggestion,
  } = body

  if (!function_id || !function_label || !status) {
    return NextResponse.json({ error: 'function_id, function_label, status requis' }, { status: 400 })
  }
  if (!['success', 'partial', 'failed', 'skipped'].includes(status)) {
    return NextResponse.json({ error: 'status invalide' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Upsert via la contrainte unique (user_id, function_id)
  const { data, error } = await sb
    .from('evaluations')
    .upsert({
      user_id:        user.id,
      function_id:    String(function_id),
      function_label: String(function_label),
      status,
      ux_rating:      ux_rating != null ? Number(ux_rating) : null,
      ui_rating:      ui_rating != null ? Number(ui_rating) : null,
      comment:        comment?.trim() || null,
      suggestion:     suggestion?.trim() || null,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,function_id' })
    .select()
    .single()

  if (error) {
    console.error('[evaluation/save]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, evaluation: data })
}
