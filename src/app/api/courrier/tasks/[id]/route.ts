// POST /api/courrier/tasks/[id] { done: boolean } — cocher / décocher une tâche du courrier.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { courrierAccess } from '@/lib/courrier/access'
export const dynamic = 'force-dynamic'
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await courrierAccess(); if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const { done } = await req.json().catch(() => ({ done: true }))
  const sb = createAdminClient()
  await sb.from('courrier_tasks').update(done === false ? { done_at: null, done_by: null } : { done_at: new Date().toISOString(), done_by: a.userId }).eq('id', params.id)
  return NextResponse.json({ ok: true })
}
