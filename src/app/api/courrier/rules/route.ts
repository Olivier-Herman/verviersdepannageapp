// DELETE /api/courrier/rules?key=… — oublier la procédure retenue pour un expéditeur.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { courrierAccess } from '@/lib/courrier/access'
export const dynamic = 'force-dynamic'
export async function DELETE(req: Request) {
  const a = await courrierAccess(); if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const key = new URL(req.url).searchParams.get('key'); if (!key) return NextResponse.json({ error: 'Expéditeur manquant' }, { status: 400 })
  await createAdminClient().from('courrier_rules').delete().eq('sender_key', key)
  return NextResponse.json({ ok: true })
}
