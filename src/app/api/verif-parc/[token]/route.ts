// POST /api/verif-parc/<jeton> { itemId, answer: 'present' | 'absent', note? } — réponse de la fourrière.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyVerificationToken, answerItem } from '@/lib/parc/verification'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const id = verifyVerificationToken(params.token)
  if (!id) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  if (!['present', 'absent'].includes(body?.answer)) return NextResponse.json({ error: 'Réponse inconnue' }, { status: 400 })
  const r = await answerItem(createAdminClient(), id, String(body.itemId || ''), body.answer, body.note)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, item: r.item })
}
